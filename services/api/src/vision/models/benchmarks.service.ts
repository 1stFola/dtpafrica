import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import {
  DETECTION_CLASSES,
  visionKeys,
  type BenchmarkJobParams,
  type BenchmarkMetric,
  type BenchmarkSummary,
} from "@dtp/vision-contracts";
import type { AdminAuthContext } from "../../admin/auth/admin-auth.types";
import { PrismaService } from "../../prisma/prisma.service";
import { VisionAuditService } from "../audit/vision-audit.service";
import { goldReadiness } from "../datasets/gold-benchmark";
import { VisionJobsService } from "../jobs/vision-jobs.service";
import { OBJECT_STORE, type ObjectStore } from "../storage/object-store";
import { BENCHMARK_THRESHOLDS, judge, type BenchmarkThresholds } from "./benchmark-thresholds";

/**
 * The benchmark ledger.
 *
 * A run is the unit of evidence a promotion rests on: which model version, which
 * frozen gold version, which thresholds it was judged under, the verdict, and the
 * metrics per class and per slice. This service refuses to start a run that could
 * not mean anything, turns a worker's completion into rows, and moves a version
 * from `candidate` to `benchmarked` -- and no further. Promotion is a second
 * person's act and is not here.
 *
 * See docs/vision/10-EVALUATION-AND-GATES.md and docs/vision/30-PHASE-3-INCREMENT-3.md.
 */

type StageArtifact = { key: string; bucket: string; role: string };

/** DI token for a thresholds override. Nothing registers it in production. */
export const BENCHMARK_THRESHOLDS_TOKEN = Symbol("BENCHMARK_THRESHOLDS");

@Injectable()
export class VisionBenchmarksService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(VisionAuditService) private readonly audit: VisionAuditService,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    @Inject(VisionJobsService) private readonly jobs: VisionJobsService,
    // Injected only by tests; the container leaves it undefined and the default stands.
    @Optional() @Inject(BENCHMARK_THRESHOLDS_TOKEN) thresholds?: BenchmarkThresholds
  ) {
    this.thresholds = thresholds ?? BENCHMARK_THRESHOLDS;
  }

  private readonly thresholds: BenchmarkThresholds;

  // ── Reads ────────────────────────────────────────────────────────────────

  async get(runId: string) {
    const run = await this.prisma.visionBenchmarkRun.findUnique({
      where: { id: runId },
      include: {
        metrics: { orderBy: [{ slice: "asc" }, { metric: "asc" }] },
        modelVersion: { select: { id: true, version: true, stage: true, model: { select: { key: true } } } },
        datasetVersion: { select: { id: true, label: true } },
      },
    });
    if (!run) throw new NotFoundException(`Unknown benchmark run ${runId}`);
    return { run };
  }

  async listForVersion(modelVersionId: string) {
    const runs = await this.prisma.visionBenchmarkRun.findMany({
      where: { modelVersionId },
      orderBy: { createdAt: "desc" },
      include: { datasetVersion: { select: { id: true, label: true } }, _count: { select: { metrics: true } } },
    });
    return { runs };
  }

  // ── Request ──────────────────────────────────────────────────────────────

  /**
   * Start a run, or refuse.
   *
   * Four things must be true before a number can mean anything: the gold version
   * is frozen and rights-clean, every gold member was reviewed by two people, the
   * export the worker will read exists, and every gold member has a succeeded
   * `detect` job by this exact model version. The last is the one people forget:
   * a benchmark over the gold members that happened to have detections is a
   * benchmark of a different, undeclared dataset.
   */
  async request(modelVersionId: string, datasetVersionId: string, actor?: AdminAuthContext) {
    const version = await this.prisma.visionModelVersion.findUnique({
      where: { id: modelVersionId },
      include: { model: { select: { key: true, task: true } } },
    });
    if (!version) throw new NotFoundException(`Unknown model version ${modelVersionId}`);
    if (version.model.task !== "detect") {
      throw new BadRequestException({
        statusCode: 400,
        error: "ModelTaskUnsupported",
        message: `${version.model.key} is a ${version.model.task} model; only detection is benchmarked yet.`,
      });
    }
    if (version.stage === "archived") {
      throw new ConflictException({
        statusCode: 409,
        error: "ModelVersionArchived",
        message: `${version.model.key}@${version.version} is archived.`,
      });
    }

    const dataset = await this.prisma.visionDatasetVersion.findUnique({
      where: { id: datasetVersionId },
      select: { id: true, label: true, frozenAt: true, containsRevokedMembers: true },
    });
    if (!dataset) throw new NotFoundException(`Unknown dataset version ${datasetVersionId}`);
    if (!dataset.frozenAt) {
      throw new ConflictException({
        statusCode: 409,
        error: "DatasetNotFrozen",
        message: "Only a frozen version can be benchmarked against.",
        detail: "A draft's gold set still changes; a number taken against it means nothing later.",
        remediation: "Freeze the version first.",
      });
    }
    if (dataset.containsRevokedMembers) {
      throw new ForbiddenException({
        statusCode: 403,
        error: "DatasetContainsRevokedMembers",
        message: "This version holds footage whose rights were withdrawn.",
        remediation: "Benchmark against a version without the revoked members.",
      });
    }

    const gold = await this.prisma.visionDatasetMember.findMany({
      where: { datasetVersionId: dataset.id, split: "gold" },
      select: { videoAssetId: true },
    });
    if (!gold.length) {
      throw new ConflictException({
        statusCode: 409,
        error: "NoGoldMembers",
        message: `${dataset.label} has no gold split.`,
        remediation: "A benchmark is measured against gold. Build a version with a gold split.",
      });
    }

    const readiness = await goldReadiness(this.prisma, dataset.id);
    if (readiness.shortOfTwo.length) {
      throw new ConflictException({
        statusCode: 409,
        error: "GoldNotDoubleReviewed",
        message: `${readiness.shortOfTwo.length} gold member(s) were not reviewed by two people.`,
        members: readiness.shortOfTwo.slice(0, 20).map((m) => m.videoAssetId),
        remediation: "A benchmark against one person's opinion is one person's opinion.",
      });
    }

    const exportRef = visionKeys.datasetExport(dataset.id, "samples.json");
    if (!(await this.store.head(exportRef.bucket, exportRef.key))) {
      throw new ConflictException({
        statusCode: 409,
        error: "DatasetNotExported",
        message: `${dataset.label} has not been exported, so there are no gold boxes to score against.`,
        remediation: `POST /vision/datasets/${dataset.id}/export, then request the benchmark again.`,
      });
    }

    const detections = await this.detectArtifactsFor(version.id, gold.map((g) => g.videoAssetId));
    if (detections.missing.length) {
      throw new ConflictException({
        statusCode: 409,
        error: "DetectionsMissing",
        message: `${detections.missing.length} gold member(s) have no succeeded detect job by this model version.`,
        members: detections.missing.slice(0, 20),
        remediation: `Queue detect for each with modelVersionId=${version.id}, then request the benchmark again.`,
      });
    }

    const run = await this.prisma.visionBenchmarkRun.create({
      data: {
        modelVersionId: version.id,
        datasetVersionId: dataset.id,
        thresholdsVersion: this.thresholds.version,
        iouThreshold: this.thresholds.iou,
        requestedBy: actor?.userId ?? null,
      },
    });

    const params: BenchmarkJobParams = {
      benchmarkRunId: run.id,
      goldLabelsKey: exportRef.key,
      detections: detections.found,
      readKeys: [
        { bucket: "derived", key: exportRef.key },
        ...detections.found.map((d) => ({ bucket: "derived" as const, key: d.key })),
      ],
      iou: this.thresholds.iou,
      classes: DETECTION_CLASSES,
    };
    const job = await this.jobs.enqueueDetached(
      {
        type: "benchmark",
        datasetVersionId: dataset.id,
        modelVersionId: version.id,
        params: params as unknown as Record<string, unknown>,
      },
      actor
    );
    await this.prisma.visionBenchmarkRun.update({ where: { id: run.id }, data: { jobId: job.id } });

    await this.audit.record(
      {
        action: "model.benchmark.requested",
        targetKind: "vision_benchmark_run",
        targetId: run.id,
        data: {
          modelVersionId: version.id,
          datasetVersionId: dataset.id,
          goldMembers: gold.length,
          thresholdsVersion: this.thresholds.version,
          jobId: job.id,
        },
      },
      actor
    );

    return { ...run, jobId: job.id, goldMembers: gold.length };
  }

  /** The latest succeeded detect artifact per gold member, by this model version, or who lacks one. */
  private async detectArtifactsFor(modelVersionId: string, videoAssetIds: string[]) {
    const jobs = await this.prisma.visionJob.findMany({
      where: { type: "detect", state: "succeeded", modelVersionId, videoAssetId: { in: videoAssetIds } },
      orderBy: { finishedAt: "desc" },
      select: { videoAssetId: true, progress: true },
    });

    const found: { videoAssetId: string; key: string }[] = [];
    const seen = new Set<string>();
    for (const job of jobs) {
      if (!job.videoAssetId || seen.has(job.videoAssetId)) continue;
      const artifacts = ((job.progress as { artifacts?: StageArtifact[] } | null)?.artifacts ?? []).filter(
        (a) => a && a.role === "detections" && a.bucket === "derived" && typeof a.key === "string"
      );
      const artifact = artifacts[0];
      if (!artifact) continue;
      seen.add(job.videoAssetId);
      found.push({ videoAssetId: job.videoAssetId, key: artifact.key });
    }
    const missing = videoAssetIds.filter((id) => !seen.has(id));
    return { found, missing };
  }

  // ── Completion ───────────────────────────────────────────────────────────

  /**
   * Turn a worker's summary into metric rows and a verdict.
   *
   * Idempotent: a retried completion re-inserts nothing (`skipDuplicates` on the
   * run's unique key) and re-judges to the same verdict. The version moves to
   * `benchmarked` only from `candidate`: a version already in staging or production
   * being re-measured does not step backwards.
   */
  async complete(
    runId: string,
    summary: Record<string, unknown>,
    artifacts: StageArtifact[]
  ): Promise<{ applied: boolean; detail: string }> {
    const run = await this.prisma.visionBenchmarkRun.findUnique({
      where: { id: runId },
      select: { id: true, modelVersionId: true, datasetVersionId: true, thresholdsVersion: true },
    });
    if (!run) return { applied: false, detail: `benchmark run ${runId} does not exist` };

    const parsed = parseSummary(summary);
    if (!parsed) return { applied: false, detail: "benchmark summary carried no metrics" };
    if (parsed.benchmarkRunId !== run.id) {
      return { applied: false, detail: `summary names run ${parsed.benchmarkRunId}; the job carries ${run.id}` };
    }
    if (parsed.modelVersionId !== run.modelVersionId || parsed.datasetVersionId !== run.datasetVersionId) {
      return {
        applied: false,
        detail: `summary names model ${parsed.modelVersionId} on dataset ${parsed.datasetVersionId}; the run is ${run.modelVersionId} on ${run.datasetVersionId}`,
      };
    }

    const verdict = judge(parsed.metrics, this.thresholds);
    const report = artifacts.find((a) => a.role === "benchmark");

    await this.prisma.$transaction([
      this.prisma.visionMetricResult.createMany({
        data: parsed.metrics.map((m) => ({
          benchmarkRunId: run.id,
          metric: m.metric,
          slice: m.slice,
          value: m.value,
          support: m.support,
        })),
        skipDuplicates: true,
      }),
      this.prisma.visionBenchmarkRun.update({
        where: { id: run.id },
        data: {
          state: "completed",
          verdict: verdict.verdict,
          verdictDetail: verdict as never,
          summary: {
            iou: parsed.iou,
            classes: parsed.classes,
            assets: parsed.assets,
            framesLabelled: parsed.framesLabelled,
            framesScored: parsed.framesScored,
            metrics: parsed.metrics.length,
          } as never,
          reportKey: report?.key ?? null,
          completedAt: new Date(),
        },
      }),
      this.prisma.visionModelVersion.updateMany({
        where: { id: run.modelVersionId, stage: "candidate" },
        data: { stage: "benchmarked" },
      }),
    ]);

    await this.audit.record({
      action: "model.benchmarked",
      targetKind: "vision_benchmark_run",
      targetId: run.id,
      data: {
        modelVersionId: run.modelVersionId,
        datasetVersionId: run.datasetVersionId,
        verdict: verdict.verdict,
        judgedUnder: verdict.judgedUnder,
        failures: verdict.failures.length,
        framesScored: parsed.framesScored,
        framesLabelled: parsed.framesLabelled,
      },
    });

    const headline = parsed.metrics.find((m) => m.metric === "ap:all" && m.slice === "all");
    const ball = parsed.metrics.find((m) => m.metric === "recall:ball" && m.slice === "all");
    return {
      applied: true,
      detail: `${parsed.metrics.length} metric(s) over ${parsed.framesScored}/${parsed.framesLabelled} labelled frame(s); mAP@${parsed.iou} ${
        headline?.value === null || headline?.value === undefined ? "n/a" : headline.value.toFixed(3)
      }, ball recall ${ball?.value === null || ball?.value === undefined ? "n/a" : ball.value.toFixed(3)}; verdict ${verdict.verdict} under ${verdict.judgedUnder}`,
    };
  }

  async fail(runId: string, reason: string) {
    await this.prisma.visionBenchmarkRun
      .updateMany({
        where: { id: runId, state: { in: ["queued", "running"] } },
        data: { state: "failed", failureReason: reason.slice(0, 2000) },
      })
      .catch(() => undefined);
  }
}

function parseSummary(summary: Record<string, unknown>): BenchmarkSummary | null {
  const metrics = summary.metrics;
  if (!Array.isArray(metrics)) return null;
  const rows: BenchmarkMetric[] = [];
  for (const entry of metrics) {
    if (!entry || typeof entry !== "object") return null;
    const m = entry as Record<string, unknown>;
    if (typeof m.metric !== "string" || typeof m.slice !== "string") return null;
    const value = m.value;
    if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) return null;
    rows.push({
      metric: m.metric,
      slice: m.slice,
      value: value as number | null,
      support: typeof m.support === "number" ? Math.trunc(m.support) : 0,
    });
  }
  const str = (key: string) => (typeof summary[key] === "string" ? (summary[key] as string) : "");
  const num = (key: string) => (typeof summary[key] === "number" ? (summary[key] as number) : 0);
  return {
    benchmarkRunId: str("benchmarkRunId"),
    modelVersionId: str("modelVersionId"),
    datasetVersionId: str("datasetVersionId"),
    iou: num("iou"),
    classes: Array.isArray(summary.classes) ? summary.classes.map(String) : [],
    assets: num("assets"),
    framesLabelled: num("framesLabelled"),
    framesScored: num("framesScored"),
    metrics: rows,
  };
}
