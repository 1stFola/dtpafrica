import { Inject, Injectable, Logger } from "@nestjs/common";
import { CUTS_ARTIFACT_ROLE, DETECTION_ARTIFACT_ROLE, GAMESTATE_CHUNK_ROLE, GAMESTATE_INDEX_ROLE, IDENTITY_ARTIFACT_ROLE, TRACK_ARTIFACT_ROLE, type VisionJobType } from "@dtp/vision-contracts";
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
  jobId?: string;
};

/** Stages whose findings land on a video asset. The rest belong to a dataset or a model. */
const ASSET_STAGES: readonly VisionJobType[] = ["probe", "fingerprint", "transcode", "cuts", "detect", "track", "identify", "gamestate"];

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
        case "track":
          return await this.applyTrack(videoAssetId, completion, context);
        case "identify":
          return await this.applyIdentify(completion, context);
        case "cuts":
          return await this.applyCuts(videoAssetId, completion);
        case "gamestate":
          return this.applyGamestate(completion);
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
   * track → one `VisionTrack` row per confirmed track.
   *
   * The positions stay in the artifact; the row is what a reviewer selects and an
   * identity will attach to. Idempotent on `(job, localTrackId)`, so a retried
   * completion adds nothing. Both provenance ids are written: the tracker is the
   * job's model version, the detector is whatever the artifact says it consumed.
   */
  private async applyTrack(
    videoAssetId: string,
    completion: StageCompletion,
    context: ApplyContext
  ): Promise<ApplyOutcome> {
    const artifact = completion.artifacts.find((a) => a.role === TRACK_ARTIFACT_ROLE);
    if (!artifact) return { applied: false, detail: "track reported no tracks artifact" };
    if (!context.jobId) return { applied: false, detail: "no job id to attach tracks to" };

    const tracker = str(completion.summary.trackerVersionId);
    if (!tracker || tracker !== context.modelVersionId) {
      return {
        applied: false,
        detail: `track summary names tracker ${tracker ?? "none"}; the job carries ${context.modelVersionId ?? "none"}`,
      };
    }
    const detector = str(completion.summary.detectorVersionId);
    const rows = Array.isArray(completion.summary.trackRows) ? completion.summary.trackRows : null;
    if (!rows) return { applied: false, detail: "track summary carried no trackRows" };

    const data: {
      videoAssetId: string;
      inferenceJobId: string;
      localTrackId: number;
      class: string;
      startMs: number;
      endMs: number;
      startFrame: number;
      endFrame: number;
      detectionCount: number;
      confirmed: boolean;
      trackerVersionId: string;
      detectorVersionId: string | null;
      artifactKey: string;
    }[] = [];
    for (const row of rows) {
      const r = obj(row);
      const localTrackId = int(r?.localTrackId);
      const cls = str(r?.class);
      const startMs = int(r?.startMs);
      const endMs = int(r?.endMs);
      const startFrame = int(r?.startFrame);
      const endFrame = int(r?.endFrame);
      const count = int(r?.detectionCount);
      if (localTrackId === null || !cls || startMs === null || endMs === null || startFrame === null || endFrame === null || count === null) {
        return { applied: false, detail: `track row ${JSON.stringify(row).slice(0, 80)} is malformed; nothing written` };
      }
      data.push({
        videoAssetId,
        inferenceJobId: context.jobId,
        localTrackId,
        class: cls,
        startMs,
        endMs,
        startFrame,
        endFrame,
        detectionCount: count,
        confirmed: bool(r?.confirmed) ?? true,
        trackerVersionId: tracker,
        detectorVersionId: detector,
        artifactKey: artifact.key,
      });
    }

    const written = await this.prisma.visionTrack.createMany({ data, skipDuplicates: true });
    const byClass = obj(completion.summary.tracksByClass) ?? {};
    return {
      applied: true,
      detail: `${data.length} track(s) (${Object.entries(byClass)
        .map(([k, v]) => `${v} ${k}`)
        .join(", ") || "none"}), ${written.count} new; tracker ${tracker}, detector ${detector ?? "unknown"}; positions in ${artifact.key}`,
    };
  }

  /**
   * gamestate → nothing in Postgres, on purpose, like detect.
   *
   * The rows are Parquet in object storage (docs/vision/04 § CV outputs); the job
   * row keeps the index key, the chunk keys and the coverage in its summary, and
   * the review surface reads those. This checks the completion is the shape the
   * job promised -- an index and at least the chunks it names -- and says what
   * the coverage was.
   */
  private applyGamestate(completion: StageCompletion): ApplyOutcome {
    const index = completion.artifacts.find((a) => a.role === GAMESTATE_INDEX_ROLE);
    if (!index) return { applied: false, detail: "gamestate reported no index artifact" };
    const chunks = completion.artifacts.filter((a) => a.role === GAMESTATE_CHUNK_ROLE);
    const declared = int(completion.summary.chunks);
    if (declared === null || declared !== chunks.length) {
      return { applied: false, detail: `gamestate summary names ${declared ?? "no"} chunk(s); the completion carries ${chunks.length}` };
    }
    const coverage = num(completion.summary.validFrameCoverage);
    const placed = int(completion.summary.placed);
    const suppressed = int(completion.summary.suppressed);
    if (placed === null || suppressed === null) return { applied: false, detail: "gamestate summary carried no placed/suppressed counts" };
    return {
      applied: true,
      detail: `${chunks.length} chunk(s), ${placed} placed and ${suppressed} suppressed row(s) over ${int(completion.summary.frames) ?? "?"} frame(s); valid-frame coverage ${coverage === null ? "n/a" : coverage.toFixed(3)}; index ${index.key}`,
    };
  }

  /**
   * cuts → proposed camera segments, `source: scene_detect`, beside the ones a
   * person declared and never over them.
   *
   * A proposal that overlaps a manual segment is skipped and counted: a person's
   * declaration is a fact about the footage, a filter's score is a guess. Earlier
   * proposals that nobody calibrated are replaced by this run's; one that was
   * calibrated has become a fact too and stays. Idempotent: a retried completion
   * finds its own proposals already there and adds nothing.
   */
  private async applyCuts(videoAssetId: string, completion: StageCompletion): Promise<ApplyOutcome> {
    const artifact = completion.artifacts.find((a) => a.role === CUTS_ARTIFACT_ROLE);
    if (!artifact) return { applied: false, detail: "cuts reported no cuts artifact" };
    const proposed = Array.isArray(completion.summary.segments) ? completion.summary.segments : null;
    if (!proposed) return { applied: false, detail: "cuts summary carried no segments" };
    const segments: { startMs: number; endMs: number }[] = [];
    for (const row of proposed) {
      const r = obj(row);
      const startMs = int(r?.startMs);
      const endMs = int(r?.endMs);
      if (startMs === null || endMs === null || endMs <= startMs) {
        return { applied: false, detail: `proposed segment ${JSON.stringify(row).slice(0, 80)} is malformed; nothing written` };
      }
      segments.push({ startMs, endMs });
    }

    const existing = await this.prisma.visionCameraSegment.findMany({
      where: { videoAssetId },
      select: { id: true, startMs: true, endMs: true, source: true, _count: { select: { calibrations: true } } },
    });
    const overlaps = (a: { startMs: number; endMs: number }, b: { startMs: number; endMs: number }) => a.startMs < b.endMs && b.startMs < a.endMs;
    const same = (a: { startMs: number; endMs: number }, b: { startMs: number; endMs: number }) => a.startMs === b.startMs && a.endMs === b.endMs;
    const kept = existing.filter((e) => e.source !== "scene_detect" || e._count.calibrations > 0);
    const stale = existing.filter((e) => e.source === "scene_detect" && e._count.calibrations === 0);
    // A stale proposal identical to a new one is this run's own, retried: keep it rather than churn ids.
    const retained = stale.filter((e) => segments.some((s) => same(s, e)));
    const toDelete = stale.filter((e) => !retained.includes(e));
    const fixed = [...kept, ...retained];
    const toCreate: { startMs: number; endMs: number }[] = [];
    let alreadyThere = 0;
    let skipped = 0;
    for (const s of segments) {
      if (fixed.some((e) => same(s, e))) alreadyThere += 1;
      else if (fixed.some((e) => overlaps(s, e))) skipped += 1;
      else toCreate.push(s);
    }

    await this.prisma.$transaction([
      ...(toDelete.length ? [this.prisma.visionCameraSegment.deleteMany({ where: { id: { in: toDelete.map((e) => e.id) } } })] : []),
      ...(toCreate.length
        ? [this.prisma.visionCameraSegment.createMany({ data: toCreate.map((s) => ({ videoAssetId, startMs: s.startMs, endMs: s.endMs, kind: "unknown", source: "scene_detect" })) })]
        : []),
    ]);
    return {
      applied: true,
      detail: `${segments.length} proposed segment(s): ${toCreate.length} new, ${alreadyThere} already there, ${skipped} skipped for overlapping a segment a person declared or calibrated, ${toDelete.length} earlier proposal(s) replaced; cuts in ${artifact.key}`,
    };
  }

  /**
   * identify → one `VisionTeamAssignment` per track the job saw.
   *
   * The rows attach to the `VisionTrack` rows of the track job the artifact came
   * from, found by `(trackJobId, localTrackId)`. A row for a track that does not
   * exist is skipped and counted rather than failing the lot: the tracks table is
   * the authority on which tracks exist. Idempotent on `(track, identify job)`.
   */
  private async applyIdentify(completion: StageCompletion, context: ApplyContext): Promise<ApplyOutcome> {
    const artifact = completion.artifacts.find((a) => a.role === IDENTITY_ARTIFACT_ROLE);
    if (!artifact) return { applied: false, detail: "identify reported no identity artifact" };
    if (!context.jobId) return { applied: false, detail: "no job id to attach assignments to" };

    const identifyVersion = str(completion.summary.identifyVersionId);
    if (!identifyVersion || identifyVersion !== context.modelVersionId) {
      return {
        applied: false,
        detail: `identify summary names version ${identifyVersion ?? "none"}; the job carries ${context.modelVersionId ?? "none"}`,
      };
    }
    const trackJobId = str(completion.summary.trackJobId);
    if (!trackJobId) return { applied: false, detail: "identify summary names no trackJobId" };
    // The track job is the one the control plane dispatched, not whichever the worker
    // reports: otherwise a summary could attach assignments to another asset's tracks.
    const dispatched = context.inputSpec?.tracks as { jobId?: unknown } | undefined;
    if (typeof dispatched?.jobId !== "string" || dispatched.jobId !== trackJobId) {
      return {
        applied: false,
        detail: `identify summary names track job ${trackJobId}; the job was dispatched with ${typeof dispatched?.jobId === "string" ? dispatched.jobId : "none"}`,
      };
    }
    const rows = Array.isArray(completion.summary.teamRows) ? completion.summary.teamRows : null;
    if (!rows) return { applied: false, detail: "identify summary carried no teamRows" };

    const tracks = await this.prisma.visionTrack.findMany({
      where: { inferenceJobId: trackJobId },
      select: { id: true, localTrackId: true },
    });
    const trackIdOf = new Map(tracks.map((t) => [t.localTrackId, t.id]));
    const kits = Array.isArray(completion.summary.kits) ? completion.summary.kits : [];
    const kitOf = new Map<string, string>();
    for (const k of kits) {
      const kit = obj(k);
      const team = str(kit?.team);
      const description = str(kit?.description);
      if (team && description) kitOf.set(team, description);
    }

    const data: {
      trackId: string;
      inferenceJobId: string;
      team: string | null;
      nearestTeam: string | null;
      confidence: number | null;
      method: string;
      kitDescription: string | null;
      identifyVersionId: string;
    }[] = [];
    let skipped = 0;
    for (const row of rows) {
      const r = obj(row);
      const localTrackId = int(r?.localTrackId);
      const method = str(r?.method);
      if (localTrackId === null || !method) {
        return { applied: false, detail: `team row ${JSON.stringify(row).slice(0, 80)} is malformed; nothing written` };
      }
      const trackId = trackIdOf.get(localTrackId);
      if (!trackId) {
        skipped += 1;
        continue;
      }
      const team = str(r?.team);
      const nearest = str(r?.nearest);
      const side = team === "A" || team === "B" ? team : null;
      const nearestSide = nearest === "A" || nearest === "B" ? nearest : null;
      data.push({
        trackId,
        inferenceJobId: context.jobId,
        team: side,
        nearestTeam: nearestSide ?? side,
        confidence: num(r?.confidence),
        method,
        // The kit of the side named, or of the nearest side for an abstention, so a
        // slice by kit colour can hold abstentions too.
        kitDescription: kitOf.get(side ?? nearestSide ?? "") ?? null,
        identifyVersionId: identifyVersion,
      });
    }

    const written = await this.prisma.visionTeamAssignment.createMany({ data, skipDuplicates: true });
    const assigned = data.filter((d) => d.team !== null).length;
    return {
      applied: true,
      detail: `${data.length} assignment(s), ${assigned} with a side (${[...kitOf.entries()].map(([t, d]) => `${t}: ${d}`).join(", ") || "no kits"}), ${data.length - assigned} unknown, ${written.count} new${skipped ? `, ${skipped} for tracks not on record` : ""}; version ${identifyVersion}`,
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
