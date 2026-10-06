import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  MODEL_TASK_BY_JOB_TYPE,
  type VisionJobType,
  type VisionModelStage,
  type VisionModelTask,
} from "@dtp/vision-contracts";
import type { AdminAuthContext } from "../../admin/auth/admin-auth.types";
import { PrismaService } from "../../prisma/prisma.service";
import { VisionAuditService } from "../audit/vision-audit.service";
import { goldContamination } from "../datasets/gold-benchmark";
import { notFound, refusal } from "../shared/refusals";

/**
 * The model registry.
 *
 * Phase 3's gate says every prediction carries its model version. This service is
 * the half of that promise the control plane keeps: a version cannot be registered
 * without the lineage that makes it reproducible, a model-bound job cannot be queued
 * without resolving to exactly one version, and a worker's completion cannot be
 * accepted unless it names the version the job was dispatched with and the weights
 * it loaded match the ones recorded.
 *
 * A version's `stage` moves through the benchmark ledger (`benchmarks.service.ts`)
 * and the two-person promotion gate (`promotions.service.ts`), never by hand -- see
 * docs/vision/10-EVALUATION-AND-GATES.md § Promotion gate. Canary is not built.
 *
 * See docs/vision/09-ML-PIPELINE.md § Model registry and reproducibility, and
 * docs/vision/28-PHASE-3-INCREMENT-1.md.
 */

export type ResolvedModelVersion = {
  id: string;
  modelId: string;
  modelKey: string;
  task: VisionModelTask;
  version: string;
  stage: string;
  datasetVersionId: string | null;
};

export type WeightsVerdict =
  /** The version had a checksum and the worker's matched it. */
  | { outcome: "verified"; sha256: string }
  /** The version had none; the worker's can be recorded as the first. */
  | { outcome: "recorded"; sha256: string }
  /** The worker reported none. A gap, visible as such. */
  | { outcome: "unreported"; sha256: null }
  /** The stage runs no model. */
  | { outcome: "not_applicable"; sha256: null };

export type ProvenanceVerdict =
  | { ok: true; modelVersionId: string | null; weights: WeightsVerdict }
  | {
      ok: false;
      error: "ProvenanceMismatch" | "WeightsMismatch";
      message: string;
      detail: string;
    };

const SHA256 = /^[0-9a-f]{64}$/i;

@Injectable()
export class VisionModelsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(VisionAuditService) private readonly audit: VisionAuditService
  ) {}

  // ── Reads ────────────────────────────────────────────────────────────────

  async listModels() {
    const models = await this.prisma.visionModel.findMany({
      orderBy: { key: "asc" },
      include: {
        versions: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            version: true,
            stage: true,
            datasetVersionId: true,
            gitCommit: true,
            workerImage: true,
            weightsChecksum: true,
            configKey: true,
            weightsKey: true,
            promotedAt: true,
            createdAt: true,
            _count: { select: { jobs: true } },
            // The request waiting on a second person, if any: what the registry screen
            // needs to offer Approve and Reject, and to whom.
            promotionRequests: {
              where: { state: "pending" },
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { id: true, fromStage: true, toStage: true, requestedBy: true, requestedByEmail: true, createdAt: true },
            },
          },
        },
      },
    });
    return {
      models: models.map((model) => ({
        ...model,
        versions: model.versions.map(({ promotionRequests, ...version }) => ({ ...version, pendingPromotion: promotionRequests[0] ?? null })),
      })),
    };
  }

  async getVersion(id: string) {
    const version = await this.prisma.visionModelVersion.findUnique({
      where: { id },
      include: {
        model: { select: { id: true, key: true, task: true } },
        datasetVersion: { select: { id: true, label: true, frozenAt: true } },
        _count: { select: { jobs: true } },
      },
    });
    if (!version) throw notFound("model version", id);
    return { version };
  }

  // ── Registration ─────────────────────────────────────────────────────────

  async createModel(
    dto: { key: string; task: VisionModelTask; description?: string },
    actor?: AdminAuthContext
  ) {
    let model;
    try {
      model = await this.prisma.visionModel.create({
        data: { key: dto.key, task: dto.task, description: dto.description ?? null },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException({
          statusCode: 409,
          error: "ModelKeyExists",
          message: `A model with key ${dto.key} already exists.`,
          remediation: "Register a new version under it instead of a second model.",
        });
      }
      throw error;
    }

    await this.audit.record(
      {
        action: "model.registered",
        targetKind: "vision_model",
        targetId: model.id,
        data: { key: model.key, task: model.task },
      },
      actor
    );
    return model;
  }

  /**
   * Register a version, or refuse.
   *
   * Three refusals guard the dataset lineage, and they are the same three the
   * export applies (docs/vision/26-PHASE-2-INCREMENT-5.md): a draft dataset cannot
   * back a reproducible model, a dataset holding revoked footage cannot back a new
   * one, and a dataset that trains on another version's gold would make every
   * benchmark ever taken against that version a measurement of memory. Registering
   * the version is how a training run would be *recorded*, so the door is closed
   * here as well as at the export.
   */
  async registerVersion(
    modelId: string,
    dto: {
      version: string;
      gitCommit: string;
      configKey: string;
      workerImage: string;
      licenceNote: string;
      datasetVersionId?: string;
      weightsKey?: string;
      weightsChecksum?: string;
    },
    actor?: AdminAuthContext
  ) {
    const model = await this.prisma.visionModel.findUnique({
      where: { id: modelId },
      select: { id: true, key: true, task: true },
    });
    if (!model) throw notFound("model", modelId);

    // The DTO already refuses a blank note over HTTP. Checked again here because a
    // programmatic caller gets no DTO, and the rule is the register's, not the API's.
    if (!dto.licenceNote?.trim()) {
      throw new BadRequestException({
        statusCode: 400,
        error: "LicenceNoteRequired",
        message: "A model version must record its licence position before it exists.",
        remediation: "State the code, weights and pretraining-data licences, per docs/licenses/OSS_REGISTER.md.",
      });
    }

    if (dto.datasetVersionId) await this.assertDatasetCanBackAModel(dto.datasetVersionId);

    let version;
    try {
      version = await this.prisma.visionModelVersion.create({
        data: {
          modelId: model.id,
          version: dto.version,
          datasetVersionId: dto.datasetVersionId ?? null,
          gitCommit: dto.gitCommit,
          configKey: dto.configKey,
          workerImage: dto.workerImage,
          weightsKey: dto.weightsKey ?? null,
          weightsChecksum: dto.weightsChecksum?.toLowerCase() ?? null,
          licenceNote: dto.licenceNote.trim(),
          stage: "candidate" satisfies VisionModelStage,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException({
          statusCode: 409,
          error: "ModelVersionExists",
          message: `${model.key} already has a version ${dto.version}.`,
          detail: "A version is immutable once registered; a changed model is a new version.",
          remediation: "Register under a new version string.",
        });
      }
      throw error;
    }

    await this.audit.record(
      {
        action: "model.version.registered",
        targetKind: "vision_model_version",
        targetId: version.id,
        data: {
          modelKey: model.key,
          version: version.version,
          datasetVersionId: version.datasetVersionId,
          gitCommit: version.gitCommit,
          workerImage: version.workerImage,
        },
      },
      actor
    );
    return version;
  }

  private async assertDatasetCanBackAModel(datasetVersionId: string) {
    const dataset = await this.prisma.visionDatasetVersion.findUnique({
      where: { id: datasetVersionId },
      select: { id: true, label: true, frozenAt: true, containsRevokedMembers: true },
    });
    if (!dataset) throw notFound("dataset version", datasetVersionId);

    if (!dataset.frozenAt) {
      throw new ConflictException({
        statusCode: 409,
        error: "DatasetNotFrozen",
        message: "Only a frozen dataset version can back a model version.",
        detail:
          "A draft's membership still changes, so a model recorded against it could never be " +
          "rebuilt from the same footage -- which is the reproducibility rule's whole point.",
        remediation: "Freeze the dataset version first.",
      });
    }

    if (dataset.containsRevokedMembers) {
      throw new ForbiddenException({
        statusCode: 403,
        error: "DatasetContainsRevokedMembers",
        message: "This dataset holds footage whose training right was withdrawn.",
        detail:
          "The frozen version is left intact so history is not rewritten, but registering a " +
          "model against it is how that footage would become part of a shipped model.",
        remediation: "Build a new dataset version without the revoked members.",
      });
    }

    const contaminated = await goldContamination(this.prisma, dataset.id);
    if (contaminated.length) {
      throw new ConflictException({
        statusCode: 409,
        error: "GoldContamination",
        message: `${contaminated.length} member(s) of this dataset are held out as gold by a frozen version.`,
        detail:
          "A model trained on them would make every benchmark number already taken against " +
          "that version a measurement of the model's memory rather than its ability.",
        members: contaminated.slice(0, 20),
        remediation: "Train on a dataset version that does not include that footage.",
      });
    }
  }

  // ── Dispatch ─────────────────────────────────────────────────────────────

  /**
   * The one model version a job must run, or a refusal.
   *
   * Returns null for a job type that runs no model. For a model-bound type, an
   * explicit version is checked for task and stage; otherwise the single
   * `production` version for the task is chosen. There is deliberately no fallback
   * past that: a job that quietly ran "whatever candidate was newest" would produce
   * predictions whose provenance is an accident.
   */
  async resolveForJob(
    jobType: VisionJobType,
    explicitVersionId?: string
  ): Promise<ResolvedModelVersion | null> {
    const task = MODEL_TASK_BY_JOB_TYPE[jobType];
    if (!task) {
      if (explicitVersionId) {
        throw refusal(400, "ModelNotApplicable", `${jobType} runs no model; do not pass modelVersionId for it.`, "Queue the job without a modelVersionId.");
      }
      return null;
    }

    if (explicitVersionId) {
      const version = await this.prisma.visionModelVersion.findUnique({
        where: { id: explicitVersionId },
        include: { model: { select: { id: true, key: true, task: true } } },
      });
      if (!version) throw refusal(400, "ModelVersionUnknown", `Unknown model version ${explicitVersionId}`, "Name a registered version of a model for this stage, or leave it out to use the one in production.");
      if (version.model.task !== task) {
        throw new BadRequestException({
          statusCode: 400,
          error: "ModelTaskMismatch",
          message: `${version.model.key} is a ${version.model.task} model; ${jobType} needs a ${task} model.`,
          remediation: `Name a version of a ${task} model, or leave it out to use the one in production.`,
        });
      }
      if (version.stage === "archived") {
        throw new ConflictException({
          statusCode: 409,
          error: "ModelVersionArchived",
          message: `${version.model.key}@${version.version} is archived and may not run.`,
          remediation: "Pick a live version, or register a new one.",
        });
      }
      return toResolved(version);
    }

    const production = await this.prisma.visionModelVersion.findMany({
      where: { stage: "production", model: { task } },
      include: { model: { select: { id: true, key: true, task: true } } },
    });

    if (production.length === 0) {
      throw new ConflictException({
        statusCode: 409,
        error: "NoProductionModel",
        message: `No ${task} model is in production, and ${jobType} was queued without naming one.`,
        detail:
          "A job that ran whichever version happened to exist would produce predictions " +
          "whose provenance is an accident.",
        remediation: "Pass modelVersionId explicitly, or promote a version to production.",
      });
    }
    if (production.length > 1) {
      // Promotion keeps one production version per task (it demotes the others under
      // a lock). This is for a registry whose stages were set some other way.
      throw new ConflictException({
        statusCode: 409,
        error: "AmbiguousProductionModel",
        message: `${production.length} ${task} versions are marked production.`,
        versions: production.map((v) => `${v.model.key}@${v.version}`),
        remediation: "Pass modelVersionId explicitly, or archive all but one.",
      });
    }
    return toResolved(production[0]!);
  }

  // ── Completion ───────────────────────────────────────────────────────────

  /**
   * Whether a worker's completion can be attributed to the job it was dispatched
   * for. Read-only: the caller records a newly reported checksum after the job has
   * actually succeeded, so a refused or failed completion leaves nothing behind.
   *
   * A completion naming a different model version than the job carries is refused
   * outright. The worker is either broken or lying; either way the control plane
   * must not record predictions under a version that did not produce them.
   */
  async verifyCompletion(
    job: { id: string; type: VisionJobType; modelVersionId: string | null },
    completion: { modelVersionIds: string[]; summary: Record<string, unknown> }
  ): Promise<ProvenanceVerdict> {
    const task = MODEL_TASK_BY_JOB_TYPE[job.type];
    const reported = [...new Set(completion.modelVersionIds)];

    if (!task) {
      if (reported.length) {
        return {
          ok: false,
          error: "ProvenanceMismatch",
          message: `${job.type} runs no model, yet the worker reported ${reported.join(", ")}.`,
          detail: "A stage claiming a model it does not run is a wiring fault, not a detail to log.",
        };
      }
      return { ok: true, modelVersionId: null, weights: { outcome: "not_applicable", sha256: null } };
    }

    if (!job.modelVersionId) {
      return {
        ok: false,
        error: "ProvenanceMismatch",
        message: `Job ${job.id} was dispatched without a model version; its predictions cannot be attributed.`,
        detail: "It predates contract 1.1.0, or was inserted behind the service's back.",
      };
    }

    const summaryVersion = typeof completion.summary.modelVersionId === "string"
      ? completion.summary.modelVersionId
      : null;
    if (reported.length !== 1 || reported[0] !== job.modelVersionId || (summaryVersion && summaryVersion !== job.modelVersionId)) {
      return {
        ok: false,
        error: "ProvenanceMismatch",
        message: `Job ${job.id} was dispatched with model version ${job.modelVersionId}; the worker reported ${
          reported.length ? reported.join(", ") : "none"
        }${summaryVersion && summaryVersion !== job.modelVersionId ? ` and a summary naming ${summaryVersion}` : ""}.`,
        detail: "Predictions are recorded only under the version that produced them.",
      };
    }

    const version = await this.prisma.visionModelVersion.findUnique({
      where: { id: job.modelVersionId },
      select: { id: true, weightsChecksum: true },
    });
    if (!version) {
      return {
        ok: false,
        error: "ProvenanceMismatch",
        message: `Model version ${job.modelVersionId} no longer exists.`,
        detail: "It was deleted between dispatch and completion.",
      };
    }

    const rawSha = completion.summary.weightsSha256;
    if (rawSha !== undefined && rawSha !== null && (typeof rawSha !== "string" || !SHA256.test(rawSha))) {
      return {
        ok: false,
        error: "WeightsMismatch",
        message: "The worker reported a weights checksum that is not a SHA-256 digest.",
        detail: `Got ${JSON.stringify(rawSha).slice(0, 80)}.`,
      };
    }
    const sha256 = typeof rawSha === "string" ? rawSha.toLowerCase() : null;

    if (!sha256) {
      return { ok: true, modelVersionId: version.id, weights: { outcome: "unreported", sha256: null } };
    }
    if (!version.weightsChecksum) {
      return { ok: true, modelVersionId: version.id, weights: { outcome: "recorded", sha256 } };
    }
    if (version.weightsChecksum.toLowerCase() !== sha256) {
      return {
        ok: false,
        error: "WeightsMismatch",
        message: `Model version ${version.id} is pinned to weights ${version.weightsChecksum.slice(0, 12)}…; this worker loaded ${sha256.slice(0, 12)}….`,
        detail:
          "A URL can serve different bytes on different days. Predictions from different " +
          "weights under one version would make the version meaningless.",
      };
    }
    return { ok: true, modelVersionId: version.id, weights: { outcome: "verified", sha256 } };
  }

  /**
   * Pin a version to the first checksum a worker reports. Idempotent and
   * conservative: it writes only where nothing is recorded, so a race between two
   * first runs cannot overwrite one with the other.
   */
  async recordWeightsChecksum(modelVersionId: string, sha256: string): Promise<boolean> {
    const result = await this.prisma.visionModelVersion.updateMany({
      where: { id: modelVersionId, weightsChecksum: null },
      data: { weightsChecksum: sha256.toLowerCase() },
    });
    return result.count === 1;
  }
}

function toResolved(version: {
  id: string;
  version: string;
  stage: string;
  datasetVersionId: string | null;
  model: { id: string; key: string; task: string };
}): ResolvedModelVersion {
  return {
    id: version.id,
    modelId: version.model.id,
    modelKey: version.model.key,
    task: version.model.task as VisionModelTask,
    version: version.version,
    stage: version.stage,
    datasetVersionId: version.datasetVersionId,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
