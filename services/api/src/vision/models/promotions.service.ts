import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { ALL_SLICE, visionKeys, type VisionModelStage } from "@dtp/vision-contracts";
import type { AdminAuthContext } from "../../admin/auth/admin-auth.types";
import { PrismaService } from "../../prisma/prisma.service";
import { VisionAuditService } from "../audit/vision-audit.service";
import { VisionDatasetsService } from "../datasets/datasets.service";
import { RightsPolicyService } from "../rights/rights-policy.service";
import { OBJECT_STORE, type ObjectStore } from "../storage/object-store";
import { BENCHMARK_THRESHOLDS, type BenchmarkThresholds } from "./benchmark-thresholds";
import { BENCHMARK_THRESHOLDS_TOKEN } from "./benchmarks.service";

/**
 * Promotion: the two-person act that moves a model version towards production.
 *
 * docs/vision/10-EVALUATION-AND-GATES.md lists eight things that must hold before
 * a version reaches staging. Seven are checked here, every one of them at request
 * time and again at approval time, and the findings are stored on the request so
 * "why was this allowed?" is answerable from the row. The eighth is the rule that
 * makes the other seven mean anything: the person who approves is not the person
 * who asked.
 *
 * Which is why the shared operator API key can do neither. It has no user id, so
 * a request and an approval made with it are indistinguishable, and a control that
 * cannot tell two people apart is not a control. Promotion needs a signed-in person
 * at both ends.
 *
 * Rollback is one operation: the request that put a version into production
 * recorded what it replaced, and rolling back restores exactly that.
 *
 * See docs/vision/31-PHASE-3-INCREMENT-4.md.
 */

export type PromotionCheck = { name: string; ok: boolean; detail: string };

export type PromotionGate = {
  passed: PromotionCheck[];
  warnings: PromotionCheck[];
  failures: PromotionCheck[];
  benchmarkRunId: string | null;
  /** The production version the candidate was compared against, if any. */
  comparedWith: string | null;
};

/** Where a stage can be promoted to. Anything else is not promotable. */
const NEXT_STAGE: Partial<Record<VisionModelStage, VisionModelStage>> = {
  benchmarked: "staging",
  staging: "production",
};

@Injectable()
export class VisionPromotionsService {
  private readonly thresholds: BenchmarkThresholds;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(VisionAuditService) private readonly audit: VisionAuditService,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    @Inject(RightsPolicyService) private readonly rights: RightsPolicyService,
    @Inject(VisionDatasetsService) private readonly datasets: VisionDatasetsService,
    @Optional() @Inject(BENCHMARK_THRESHOLDS_TOKEN) thresholds?: BenchmarkThresholds
  ) {
    this.thresholds = thresholds ?? BENCHMARK_THRESHOLDS;
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  async listForVersion(modelVersionId: string) {
    const requests = await this.prisma.visionPromotionRequest.findMany({
      where: { modelVersionId },
      orderBy: { createdAt: "desc" },
    });
    return { requests };
  }

  async get(id: string) {
    const request = await this.prisma.visionPromotionRequest.findUnique({
      where: { id },
      include: {
        modelVersion: { select: { id: true, version: true, stage: true, model: { select: { key: true, task: true } } } },
      },
    });
    if (!request) throw new NotFoundException(`Unknown promotion request ${id}`);
    return { request };
  }

  // ── Request ──────────────────────────────────────────────────────────────

  async request(modelVersionId: string, actor?: AdminAuthContext) {
    const person = requirePerson(actor, "request a promotion");
    const version = await this.loadVersion(modelVersionId);

    const toStage = NEXT_STAGE[version.stage as VisionModelStage];
    if (!toStage) {
      throw new ConflictException({
        statusCode: 409,
        error: "StageNotPromotable",
        message: `${version.model.key}@${version.version} is ${version.stage}.`,
        remediation:
          version.stage === "candidate"
            ? "Benchmark it first; a version is promotable from benchmarked."
            : version.stage === "production"
              ? "It is already in production."
              : "An archived version is not promotable. Register a new one.",
      });
    }

    const pending = await this.prisma.visionPromotionRequest.findFirst({
      where: { modelVersionId: version.id, state: "pending" },
      select: { id: true, requestedBy: true },
    });
    if (pending) {
      throw new ConflictException({
        statusCode: 409,
        error: "PromotionPending",
        message: `A promotion request for ${version.model.key}@${version.version} is already waiting for a decision.`,
        requestId: pending.id,
        remediation: "Ask a holder of vision.models.promote to approve or reject it.",
      });
    }

    const gate = await this.evaluateGate(version);
    if (gate.failures.length) throw gateFailed(gate);

    const request = await this.prisma.visionPromotionRequest.create({
      data: {
        modelVersionId: version.id,
        benchmarkRunId: gate.benchmarkRunId,
        fromStage: version.stage,
        toStage,
        checks: gate as never,
        requestedBy: person.userId,
        requestedByEmail: person.email ?? null,
      },
    });

    await this.audit.record(
      {
        action: "model.promotion.requested",
        targetKind: "vision_promotion_request",
        targetId: request.id,
        data: {
          modelVersionId: version.id,
          fromStage: version.stage,
          toStage,
          benchmarkRunId: gate.benchmarkRunId,
          warnings: gate.warnings.map((w) => w.name),
        },
      },
      actor
    );
    return request;
  }

  // ── Decision ─────────────────────────────────────────────────────────────

  /**
   * Approve the pending request for a version. The gate runs again: what was true
   * at request time may not be now, and a version is promoted on today's facts.
   */
  async approve(modelVersionId: string, actor: AdminAuthContext | undefined, note?: string) {
    const person = requirePerson(actor, "approve a promotion");
    const version = await this.loadVersion(modelVersionId);

    const request = await this.prisma.visionPromotionRequest.findFirst({
      where: { modelVersionId: version.id, state: "pending" },
    });
    if (!request) {
      throw new NotFoundException({
        statusCode: 404,
        error: "NoPendingPromotion",
        message: `${version.model.key}@${version.version} has no promotion request waiting.`,
        remediation: "The trainer requests with POST /vision/models/versions/:id/promotion-request.",
      });
    }
    if (request.requestedBy === person.userId) {
      throw new ForbiddenException({
        statusCode: 403,
        error: "SelfPromotionRefused",
        message: "You cannot approve your own promotion request.",
        remediation: "A second person with vision.models.promote decides. That is the whole control.",
      });
    }
    if (version.stage !== request.fromStage) {
      throw new ConflictException({
        statusCode: 409,
        error: "StageChanged",
        message: `The request was made from ${request.fromStage}; the version is now ${version.stage}.`,
        remediation: "Reject this request and ask for a new one.",
      });
    }

    const gate = await this.evaluateGate(version);
    if (gate.failures.length) throw gateFailed(gate, "The request stays pending; fix the failures or reject it.");

    const toStage = request.toStage as VisionModelStage;
    const replaced =
      toStage === "production"
        ? await this.prisma.visionModelVersion.findMany({
            where: { stage: "production", model: { task: version.model.task }, id: { not: version.id } },
            select: { id: true },
          })
        : [];
    const replacedIds = replaced.map((r) => r.id);
    const now = new Date();

    await this.prisma.$transaction([
      ...(replacedIds.length
        ? [this.prisma.visionModelVersion.updateMany({ where: { id: { in: replacedIds } }, data: { stage: "staging" } })]
        : []),
      this.prisma.visionModelVersion.update({
        where: { id: version.id },
        data: { stage: toStage, promotedBy: person.userId, promotedAt: now },
      }),
      this.prisma.visionPromotionRequest.update({
        where: { id: request.id },
        data: {
          state: "approved",
          decidedBy: person.userId,
          decidedByEmail: person.email ?? null,
          decidedAt: now,
          decisionReason: note?.trim() || null,
          replacedVersionIds: replacedIds as never,
          checks: gate as never,
        },
      }),
    ]);

    await this.audit.record(
      {
        action: "model.promoted",
        targetKind: "vision_model_version",
        targetId: version.id,
        data: {
          requestId: request.id,
          fromStage: request.fromStage,
          toStage,
          requestedBy: request.requestedBy,
          replacedVersionIds: replacedIds,
          warnings: gate.warnings.map((w) => w.name),
        },
      },
      actor
    );

    return { requestId: request.id, modelVersionId: version.id, fromStage: request.fromStage, toStage, replacedVersionIds: replacedIds };
  }

  async reject(requestId: string, reason: string, actor?: AdminAuthContext) {
    const person = requirePerson(actor, "reject a promotion");
    const request = await this.prisma.visionPromotionRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException(`Unknown promotion request ${requestId}`);
    if (request.state !== "pending") {
      throw new ConflictException({
        statusCode: 409,
        error: "PromotionDecided",
        message: `This request is already ${request.state}.`,
      });
    }
    const updated = await this.prisma.visionPromotionRequest.update({
      where: { id: request.id },
      data: {
        state: "rejected",
        decidedBy: person.userId,
        decidedByEmail: person.email ?? null,
        decidedAt: new Date(),
        decisionReason: reason.trim(),
      },
    });
    await this.audit.record(
      {
        action: "model.promotion.rejected",
        targetKind: "vision_promotion_request",
        targetId: request.id,
        data: { modelVersionId: request.modelVersionId, reason: reason.trim() },
      },
      actor
    );
    return updated;
  }

  // ── Rollback ─────────────────────────────────────────────────────────────

  /**
   * Restore what this version replaced. One operation, from the record the
   * promotion left: no searching for "the previous production model" during an
   * incident.
   */
  async rollback(modelVersionId: string, actor?: AdminAuthContext) {
    const person = requirePerson(actor, "roll back a promotion");
    const version = await this.loadVersion(modelVersionId);
    if (version.stage !== "production") {
      throw new ConflictException({
        statusCode: 409,
        error: "NotInProduction",
        message: `${version.model.key}@${version.version} is ${version.stage}; only a production version can be rolled back.`,
      });
    }

    const promotion = await this.prisma.visionPromotionRequest.findFirst({
      where: { modelVersionId: version.id, state: "approved", toStage: "production", rolledBackAt: null },
      orderBy: { decidedAt: "desc" },
    });
    const restore = Array.isArray(promotion?.replacedVersionIds)
      ? (promotion!.replacedVersionIds as unknown[]).filter((v): v is string => typeof v === "string")
      : [];
    if (!promotion || !restore.length) {
      throw new ConflictException({
        statusCode: 409,
        error: "NothingToRollBackTo",
        message: `${version.model.key}@${version.version} replaced no production version when it was promoted.`,
        remediation: "There is no previous production model to restore. Promote another version instead.",
      });
    }

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.visionModelVersion.update({ where: { id: version.id }, data: { stage: "staging" } }),
      this.prisma.visionModelVersion.updateMany({ where: { id: { in: restore } }, data: { stage: "production" } }),
      this.prisma.visionPromotionRequest.update({
        where: { id: promotion.id },
        data: { rolledBackAt: now, rolledBackBy: person.userId },
      }),
    ]);

    await this.audit.record(
      {
        action: "model.rolled_back",
        targetKind: "vision_model_version",
        targetId: version.id,
        data: { promotionRequestId: promotion.id, restoredVersionIds: restore },
      },
      actor
    );
    return { rolledBack: version.id, restored: restore, promotionRequestId: promotion.id };
  }

  // ── The gate ─────────────────────────────────────────────────────────────

  /**
   * The seven checkable conditions from docs/vision/10 § Promotion gate, each
   * reported by name, all of them rather than the first. The eighth, the second
   * person, is enforced by `approve`.
   */
  async evaluateGate(version: LoadedVersion): Promise<PromotionGate> {
    const gate: PromotionGate = { passed: [], warnings: [], failures: [], benchmarkRunId: null, comparedWith: null };
    const add = (bucket: keyof Pick<PromotionGate, "passed" | "warnings" | "failures">, name: string, detail: string) =>
      gate[bucket].push({ name, ok: bucket !== "failures", detail });

    // 1. A completed benchmark run against a frozen gold version.
    const run = await this.prisma.visionBenchmarkRun.findFirst({
      where: { modelVersionId: version.id, state: "completed", datasetVersion: { frozenAt: { not: null } } },
      orderBy: { completedAt: "desc" },
      include: { datasetVersion: { select: { id: true, label: true } } },
    });
    if (!run) {
      add("failures", "benchmark", "No completed benchmark run against a frozen gold version.");
    } else {
      gate.benchmarkRunId = run.id;
      if (run.verdict === "fail") {
        add("failures", "benchmark", `The latest run on ${run.datasetVersion.label} failed its thresholds (${run.thresholdsVersion}).`);
      } else if (run.verdict === "unthresholded") {
        add("warnings", "benchmark", `The latest run on ${run.datasetVersion.label} was judged under ${run.thresholdsVersion}, which sets no bar yet.`);
      } else {
        add("passed", "benchmark", `The latest run on ${run.datasetVersion.label} passed under ${run.thresholdsVersion}.`);
      }
    }

    // 2. No regression on a critical slice against the current production model.
    const production = await this.prisma.visionModelVersion.findMany({
      where: { stage: "production", model: { task: version.model.task }, id: { not: version.id } },
      include: { model: { select: { key: true } } },
    });
    if (!production.length) {
      add("passed", "regression", `No ${version.model.task} model is in production; nothing to regress against.`);
    } else if (!run) {
      add("failures", "regression", "Cannot compare without a benchmark run.");
    } else {
      for (const current of production) {
        const theirs = await this.prisma.visionBenchmarkRun.findFirst({
          where: { modelVersionId: current.id, state: "completed", datasetVersionId: run.datasetVersionId },
          orderBy: { completedAt: "desc" },
          select: { id: true },
        });
        const label = `${current.model.key}@${current.version}`;
        if (!theirs) {
          add("failures", "regression", `Production ${label} has no benchmark run on ${run.datasetVersion.label}; benchmark it first so the two can be compared.`);
          continue;
        }
        gate.comparedWith = current.id;
        const metrics = this.thresholds.regressionMetrics[version.model.task] ?? [];
        const regressions = await this.regressions(run.id, theirs.id, metrics);
        if (regressions.length) {
          add("failures", "regression", `Against ${label}: ${regressions.join("; ")}.`);
        } else {
          add("passed", "regression", `No regression beyond ${this.thresholds.regressionTolerance} against ${label} on ${metrics.join(", ")}.`);
        }
      }
    }

    // 3. Model card and licence metadata.
    const card = visionKeys.modelCard(version.id);
    if (!(await this.store.head(card.bucket, card.key))) {
      add("failures", "model_card", `No model card at ${card.bucket}/${card.key}.`);
    } else {
      add("passed", "model_card", `Model card present at ${card.key}.`);
    }
    if (!version.licenceNote?.trim()) {
      add("failures", "licence", "No licence note.");
    } else {
      add("passed", "licence", "Licence note recorded.");
    }

    // 4 and 5. Dataset lineage: rights re-checked now, and the leakage check.
    if (!version.datasetVersionId) {
      add("passed", "lineage", "Pretrained: trained on no DTP footage, so there is no dataset lineage to check.");
    } else {
      const dataset = await this.prisma.visionDatasetVersion.findUnique({
        where: { id: version.datasetVersionId },
        select: { id: true, label: true, frozenAt: true, containsRevokedMembers: true, members: { select: { videoAssetId: true } } },
      });
      if (!dataset) {
        add("failures", "lineage", "The training dataset version no longer exists.");
      } else {
        if (!dataset.frozenAt) add("failures", "lineage", `${dataset.label} is not frozen.`);
        if (dataset.containsRevokedMembers) add("failures", "rights", `${dataset.label} holds footage whose training right was withdrawn.`);
        const lost: string[] = [];
        for (const member of dataset.members) {
          const decision = await this.rights.canTrain({ videoAssetId: member.videoAssetId });
          if (!decision.allowed) lost.push(member.videoAssetId);
        }
        if (lost.length) {
          add("failures", "rights", `${lost.length} member(s) of ${dataset.label} no longer carry training rights: ${lost.slice(0, 5).join(", ")}.`);
        } else if (!dataset.containsRevokedMembers) {
          add("passed", "rights", `All ${dataset.members.length} member(s) of ${dataset.label} carry training rights now.`);
        }
        const leakage = await this.datasets.checkLeakage(dataset.id);
        if (!leakage.ok) {
          add("failures", "leakage", `${leakage.offendingGroups.length} group(s) of ${dataset.label} span more than one split.`);
        } else {
          add("passed", "leakage", `No group of ${dataset.label} spans two splits.`);
        }
      }
    }

    // 7. Reproducible from commit, config, image and the weights that ran.
    const missing = (
      [
        ["gitCommit", version.gitCommit],
        ["configKey", version.configKey],
        ["workerImage", version.workerImage],
        ["weightsChecksum", version.weightsChecksum],
      ] as const
    )
      .filter(([, value]) => !value)
      .map(([name]) => name);
    if (missing.length) {
      add(
        "failures",
        "reproducible",
        `Missing ${missing.join(", ")}.${missing.includes("weightsChecksum") ? " The weights checksum is pinned by the first worker run; none has run this version." : ""}`
      );
    } else {
      add("passed", "reproducible", "Commit, config, image and weights checksum are all recorded.");
    }

    // 6. Inference smoke: the built image has run this version successfully.
    const inferences = await this.prisma.visionJob.count({
      where: { type: "detect", state: "succeeded", modelVersionId: version.id },
    });
    if (!inferences) {
      add("failures", "smoke", "No succeeded detect job has run this version on the built image.");
    } else {
      add("passed", "smoke", `${inferences} succeeded detect job(s) ran this version.`);
    }

    return gate;
  }

  /** Metrics on which the candidate run falls more than the tolerance below the production run. */
  private async regressions(candidateRunId: string, productionRunId: string, metricsToCompare: readonly string[]): Promise<string[]> {
    const slices = [ALL_SLICE, ...this.thresholds.criticalSlices];
    const rows = await this.prisma.visionMetricResult.findMany({
      where: {
        benchmarkRunId: { in: [candidateRunId, productionRunId] },
        metric: { in: [...metricsToCompare] },
        slice: { in: slices },
      },
      select: { benchmarkRunId: true, metric: true, slice: true, value: true, support: true },
    });
    const key = (runId: string, metric: string, slice: string) => `${runId}|${metric}|${slice}`;
    const byKey = new Map(rows.map((r) => [key(r.benchmarkRunId, r.metric, r.slice), r]));
    const out: string[] = [];
    for (const metric of metricsToCompare) {
      for (const slice of slices) {
        const theirs = byKey.get(key(productionRunId, metric, slice));
        if (!theirs || theirs.value === null) continue;
        const mine = byKey.get(key(candidateRunId, metric, slice));
        if (!mine || mine.value === null) {
          if (slice === ALL_SLICE || (mine && mine.support > 0)) out.push(`${metric}@${slice} not measured for the candidate`);
          continue;
        }
        if (mine.value < theirs.value - this.thresholds.regressionTolerance) {
          out.push(`${metric}@${slice} ${mine.value.toFixed(3)} vs production ${theirs.value.toFixed(3)}`);
        }
      }
    }
    return out;
  }

  private async loadVersion(id: string): Promise<LoadedVersion> {
    const version = await this.prisma.visionModelVersion.findUnique({
      where: { id },
      include: { model: { select: { key: true, task: true } } },
    });
    if (!version) throw new NotFoundException(`Unknown model version ${id}`);
    return version;
  }
}

type LoadedVersion = {
  id: string;
  version: string;
  stage: string;
  datasetVersionId: string | null;
  gitCommit: string | null;
  configKey: string | null;
  workerImage: string | null;
  weightsChecksum: string | null;
  licenceNote: string | null;
  model: { key: string; task: string };
};

function requirePerson(actor: AdminAuthContext | undefined, what: string): { userId: string; email?: string } {
  if (!actor?.userId) {
    throw new ForbiddenException({
      statusCode: 403,
      error: "PromotionNeedsAPerson",
      message: `Only a signed-in person may ${what}.`,
      detail:
        "The shared operator key has no user id, so a request and an approval made with it cannot be told apart -- " +
        "and a two-person control that cannot tell two people apart is not a control.",
      remediation: "Sign in as yourself.",
    });
  }
  return { userId: actor.userId, email: actor.email };
}

function gateFailed(gate: PromotionGate, remediation = "Fix the failures, then request again."): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: "PromotionGateFailed",
    message: `${gate.failures.length} condition(s) of the promotion gate do not hold.`,
    failures: gate.failures,
    warnings: gate.warnings,
    passed: gate.passed,
    remediation,
  });
}
