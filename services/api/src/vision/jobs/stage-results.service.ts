import { Inject, Injectable, Logger } from "@nestjs/common";
import { DETECTION_ARTIFACT_ROLE, type VisionJobType } from "@dtp/vision-contracts";
import { PrismaService } from "../../prisma/prisma.service";
import { VisionBenchmarksService } from "../models/benchmarks.service";

/**
 * Applies a completed stage's findings to the domain.
 *
 * Without this the pipeline computes the right answers and forgets them: probe
 * reads the codec and duration into a job summary that nothing reads, and the
 * proxy exists in object storage with no row pointing at it.
 *
 * Every apply is **idempotent**. A worker that completed, lost its network and
 * retried reaches here twice, and re-running a stage after a correction must not
 * duplicate variants or re-cluster an asset.
 *
 * Deliberately separate from the queue: the queue owns job state, this owns what
 * a finished job *means*. A failure here must not un-succeed the job — the
 * artifacts are written and the worker is gone — so problems are logged and
 * surfaced on the asset rather than thrown back at the worker.
 */

export type StageArtifact = {
  key: string;
  bucket: string;
  bytes?: number;
  contentType?: string;
  role: string;
};

export type StageCompletion = {
  artifacts: StageArtifact[];
  summary: Record<string, unknown>;
};

export type ApplyOutcome = {
  applied: boolean;
  detail: string;
};

/** What the job row knows that the completion payload does not. */
export type ApplyContext = {
  modelVersionId: string | null;
  datasetVersionId?: string | null;
  inputSpec?: Record<string, unknown>;
};

/** Stages whose findings land on a video asset. The rest belong to a dataset or a model. */
const ASSET_STAGES: readonly VisionJobType[] = ["probe", "fingerprint", "transcode", "detect"];

@Injectable()
export class VisionStageResultsService {
  private readonly log = new Logger(VisionStageResultsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(VisionBenchmarksService) private readonly benchmarks: VisionBenchmarksService
  ) {}

  async apply(
    jobType: VisionJobType,
    videoAssetId: string | null,
    completion: StageCompletion,
    context: ApplyContext = { modelVersionId: null }
  ): Promise<ApplyOutcome> {
    if (jobType === "benchmark") return this.applyBenchmark(completion, context);
    if (!videoAssetId || !ASSET_STAGES.includes(jobType)) {
      return { applied: false, detail: videoAssetId ? `no domain effect for ${jobType}` : "job has no video asset" };
    }

    try {
      switch (jobType) {
        case "probe":
          return await this.applyProbe(videoAssetId, completion.summary);
        case "fingerprint":
          return await this.applyFingerprint(videoAssetId, completion.summary);
        case "transcode":
          return await this.applyTranscode(videoAssetId, completion);
        case "detect":
          return this.applyDetect(completion, context);
        default:
          return { applied: false, detail: `no domain effect for ${jobType}` };
      }
    } catch (error) {
      // The job genuinely succeeded and its artifacts exist. Losing the
      // projection is a problem to fix, not a reason to call the work failed.
      const message = error instanceof Error ? error.message : String(error);
      this.log.error(`applying ${jobType} results for asset ${videoAssetId} failed: ${message}`);
      await this.prisma.visionVideoAsset
        .update({
          where: { id: videoAssetId },
          data: { ingestError: `applying ${jobType} results failed: ${message}`.slice(0, 2000) },
        })
        .catch(() => undefined);
      return { applied: false, detail: message };
    }
  }

  /** probe → container metadata onto the asset. */
  private async applyProbe(
    videoAssetId: string,
    summary: Record<string, unknown>
  ): Promise<ApplyOutcome> {
    const data = {
      container: str(summary.container),
      videoCodec: str(summary.videoCodec),
      width: int(summary.width),
      height: int(summary.height),
      fpsNumerator: int(summary.fpsNumerator),
      fpsDenominator: int(summary.fpsDenominator),
      isVariableFrameRate: bool(summary.isVariableFrameRate) ?? false,
      durationMs: int(summary.durationMs),
    };

    if (!data.videoCodec && data.durationMs === null) {
      return { applied: false, detail: "probe summary carried no usable metadata" };
    }

    // Upsert-by-update: re-running probe overwrites the same fields with the same
    // values, which is what makes this safe to retry.
    await this.prisma.visionVideoAsset.update({
      where: { id: videoAssetId },
      data: { ...data, ingestError: null },
    });

    return {
      applied: true,
      detail: `${data.videoCodec ?? "unknown codec"}, ${data.durationMs ?? "?"}ms${
        data.isVariableFrameRate ? ", variable frame rate" : ""
      }`,
    };
  }

  /**
   * fingerprint → checksum, perceptual hash, and duplicate clustering.
   *
   * Clustering here rather than in the worker because it is a question about the
   * whole corpus, not about one file: the worker cannot see the other 400 matches.
   */
  private async applyFingerprint(
    videoAssetId: string,
    summary: Record<string, unknown>
  ): Promise<ApplyOutcome> {
    const checksum = str(summary.checksumSha256);
    const perceptual = str(summary.perceptualFingerprint);

    if (!checksum) return { applied: false, detail: "fingerprint summary carried no checksum" };

    const clusterId = await this.resolveDuplicateCluster(videoAssetId, checksum, perceptual);

    await this.prisma.visionVideoAsset.update({
      where: { id: videoAssetId },
      data: {
        checksumSha256: checksum,
        perceptualFingerprint: perceptual,
        ...(clusterId ? { duplicateClusterId: clusterId } : {}),
        ingestError: null,
      },
    });

    return {
      applied: true,
      detail: clusterId ? `clustered as a duplicate (${clusterId})` : "no duplicate found",
    };
  }

  /**
   * Finds or creates the cluster this asset belongs to.
   *
   * Exact byte-match is certain. A matching perceptual hash means the same match
   * re-encoded — a different file, the same football. Both must land in one
   * cluster so they cannot be split across a train/test boundary and inflate a
   * benchmark.
   */
  private async resolveDuplicateCluster(
    videoAssetId: string,
    checksum: string,
    perceptual: string | null
  ): Promise<string | null> {
    const twins = await this.prisma.visionVideoAsset.findMany({
      where: {
        id: { not: videoAssetId },
        OR: [
          { checksumSha256: checksum },
          ...(perceptual ? [{ perceptualFingerprint: perceptual }] : []),
        ],
      },
      select: { id: true, duplicateClusterId: true, checksumSha256: true },
    });

    if (!twins.length) return null;

    // Join an existing cluster rather than starting a rival one, so a third
    // re-upload does not split the group in two.
    const existing = twins.find((t) => t.duplicateClusterId);
    if (existing?.duplicateClusterId) return existing.duplicateClusterId;

    const exact = twins.some((t) => t.checksumSha256 === checksum);
    const cluster = await this.prisma.visionDuplicateCluster.create({
      data: {
        representativeAssetId: twins[0]!.id,
        method: exact ? "checksum" : "perceptual",
        confidence: exact ? 1 : 0.85,
      },
      select: { id: true },
    });

    // Pull the assets that matched into the new cluster too, or the grouping only
    // describes one side of the pair.
    await this.prisma.visionVideoAsset.updateMany({
      where: { id: { in: twins.map((t) => t.id) } },
      data: { duplicateClusterId: cluster.id },
    });

    return cluster.id;
  }

  /** transcode → variant rows for the proxy and thumbnails, then mark ready. */
  private async applyTranscode(
    videoAssetId: string,
    completion: StageCompletion
  ): Promise<ApplyOutcome> {
    const proxy = obj(completion.summary.proxy);
    const proxyArtifact = completion.artifacts.find((a) => a.role === "proxy");

    if (!proxyArtifact) {
      return { applied: false, detail: "transcode reported no proxy artifact" };
    }

    const durationMs = int(proxy?.durationMs);
    const fps = num(proxy?.fps);
    const height = int(proxy?.height);
    const settingsHash = str(proxy?.settingsHash);
    // Which encoder build the worker used, as it reported it. The settings hash covers the
    // recipe and not the build that runs it, and the CPU and GPU worker images ship
    // different builds -- so without this, two proxies that are not byte-identical are
    // indistinguishable here. Named no more precisely than that on purpose: this file is
    // control plane, and an architecture test forbids it so much as mentioning a media
    // tool. docs/vision/27-SPIKE-S0-SURPRISES.md, S0-12, has the versions.
    const encoder = str(proxy?.encoder);

    const variants: {
      kind: string;
      objectKey: string;
      bytes: number | null;
      fps: number | null;
      height: number | null;
      durationMs: number | null;
      settingsHash: string | null;
      encoder: string | null;
    }[] = [
      {
        kind: "proxy",
        objectKey: proxyArtifact.key,
        bytes: int(proxyArtifact.bytes),
        fps,
        height,
        durationMs,
        settingsHash,
        encoder,
      },
      ...completion.artifacts
        .filter((a) => a.role === "thumbnail")
        .map((a) => ({
          kind: "thumbnail",
          objectKey: a.key,
          bytes: int(a.bytes),
          fps: null,
          height: null,
          durationMs: null,
          settingsHash: null,
          // A thumbnail is a frame grab, not an encode; there is no encoder build worth
          // recording against it.
          encoder: null,
        })),
    ];

    // The unique key is (videoAssetId, kind, objectKey), so a retry writing to a
    // new attempt prefix adds rows rather than colliding — and a genuine re-run
    // of the same attempt updates in place.
    await this.prisma.$transaction(
      variants.map((v) =>
        this.prisma.visionVideoVariant.upsert({
          where: {
            videoAssetId_kind_objectKey: {
              videoAssetId,
              kind: v.kind,
              objectKey: v.objectKey,
            },
          },
          create: { videoAssetId, ...v },
          update: {
            bytes: v.bytes,
            fps: v.fps,
            height: v.height,
            durationMs: v.durationMs,
            settingsHash: v.settingsHash,
            encoder: v.encoder,
          },
        })
      )
    );

    // A normalised proxy exists, so the asset is analysable. Carry the source's
    // variable-frame-rate finding across too: it changes how downstream stages
    // must treat timestamps, and transcode is often the first stage to learn it.
    const sourceVfr = bool(completion.summary.sourceIsVariableFrameRate);
    await this.prisma.visionVideoAsset.update({
      where: { id: videoAssetId },
      data: {
        ingestState: "ready",
        ingestError: null,
        ...(sourceVfr === undefined ? {} : { isVariableFrameRate: sourceVfr }),
      },
    });

    const thumbnails = variants.length - 1;
    return {
      applied: true,
      detail: `proxy at ${fps ?? "?"}fps/${height ?? "?"}p plus ${thumbnails} thumbnail(s); asset is ready`,
    };
  }

  /**
   * detect → nothing in Postgres, on purpose.
   *
   * Dense per-frame output lives in object storage (docs/vision/04-DATA-MODEL.md
   * § CV outputs); a 90-minute match is millions of boxes and does not belong in a
   * row store on a 2 GB box. What the control plane keeps is on the job row already:
   * the artifact key, the summary, the model version. So this projection only checks
   * that the completion is the shape the job promised, and says what it found.
   *
   * Provenance was verified at the door (`VisionModelsService.verifyCompletion`)
   * before the job could succeed; the check here is the belt to that brace.
   */
  private applyDetect(completion: StageCompletion, context: ApplyContext): ApplyOutcome {
    const artifact = completion.artifacts.find((a) => a.role === DETECTION_ARTIFACT_ROLE);
    if (!artifact) {
      return { applied: false, detail: "detect reported no detections artifact" };
    }

    const modelVersionId = str(completion.summary.modelVersionId);
    if (!modelVersionId || modelVersionId !== context.modelVersionId) {
      return {
        applied: false,
        detail: `detect summary names model version ${modelVersionId ?? "none"}; the job carries ${
          context.modelVersionId ?? "none"
        }`,
      };
    }

    const frames = int(completion.summary.framesSampled);
    const fps = num(completion.summary.sampleFps);
    const ballPct = num(completion.summary.ballVisibilityPct);
    const weights = str(completion.summary.weightsSha256);

    return {
      applied: true,
      detail: `${frames ?? "?"} frame(s) at ${fps ?? "?"}fps, ball visible in ${
        ballPct ?? "?"
      }%, model version ${modelVersionId}${
        weights ? ` (weights ${weights.slice(0, 12)}...)` : " (weights unreported)"
      }; boxes in ${artifact.key}`,
    };
  }

  /**
   * benchmark → metric rows, a verdict, and `candidate → benchmarked`.
   *
   * Owned by the benchmarks service; this only finds the run the job was queued
   * for. A failure here is logged on the run rather than thrown at the worker, for
   * the same reason as every other projection: the artifact is written and the
   * worker is gone.
   */
  private async applyBenchmark(completion: StageCompletion, context: ApplyContext): Promise<ApplyOutcome> {
    const runId = str(context.inputSpec?.benchmarkRunId);
    if (!runId) return { applied: false, detail: "benchmark job carries no benchmarkRunId" };
    try {
      return await this.benchmarks.complete(runId, completion.summary, completion.artifacts);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.error(`applying benchmark run ${runId} failed: ${message}`);
      await this.benchmarks.fail(runId, `applying the completion failed: ${message}`);
      return { applied: false, detail: message };
    }
  }

  /** A benchmark job that will not run again: the run says so, with the reason. */
  async markBenchmarkFailed(inputSpec: Record<string, unknown> | null, reason: string): Promise<void> {
    const runId = str(inputSpec?.benchmarkRunId);
    if (runId) await this.benchmarks.fail(runId, reason);
  }

  /** Records that ingestion failed, so an operator sees why without reading logs. */
  async markIngestFailed(videoAssetId: string | null, reason: string): Promise<void> {
    if (!videoAssetId) return;
    await this.prisma.visionVideoAsset
      .update({
        where: { id: videoAssetId },
        data: { ingestState: "failed", ingestError: reason.slice(0, 2000) },
      })
      .catch(() => undefined);
  }
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function int(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function obj(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
