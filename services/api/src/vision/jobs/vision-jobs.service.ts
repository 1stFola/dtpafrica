import { randomUUID } from "node:crypto";
import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
} from "@nestjs/common";
import {
  DEFAULT_RESOURCE_CLASS,
  CAMERA_SEGMENT_KINDS,
  DETECTION_ARTIFACT_ROLE,
  JOB_TYPE_PREREQUISITES,
  MIN_TRACK_SAMPLE_FPS,
  TRACK_ARTIFACT_ROLE,
  visionKeys,
  type BallTrajectoryJobParams,
  BALL_TRAJECTORY_INDEX_ROLE,
  BALL_TRAJECTORY_CHUNK_ROLE,
  BALL_TRAJECTORY_VERSION,
  type PossessionJobParams,
  type GameStateJobParams,
  type IdentifyJobParams,
  type TrackJobParams,
  type VisionJobType,
  type VisionResourceClass,
} from "@dtp/vision-contracts";
import type { AdminAuthContext } from "../../admin/auth/admin-auth.types";
import { PrismaService } from "../../prisma/prisma.service";
import { VisionAuditService } from "../audit/vision-audit.service";
import { orientStored } from "../calibration/homography";
import { possessionCalibration } from "../possession/possession-calibration";
import { VISION_CONFIG, type VisionConfig } from "../config/vision.config";
import { VisionModelsService } from "../models/models.service";
import { RightsPolicyService } from "../rights/rights-policy.service";
import { JOB_QUEUE, type JobQueue } from "./job-queue";
import { refusal } from "../shared/refusals";
import { OBJECT_STORE, type ObjectStore } from "../storage/object-store";
import { eventCarryInputs } from "../events/event-carry-inputs";

type AssetJobRequest = { type: VisionJobType; videoAssetId: string; resourceClass?: VisionResourceClass; priority?: number; params?: Record<string, unknown>; budgetSeconds?: number; budgetUsdCents?: number; modelVersionId?: string };

/**
 * Job orchestration.
 *
 * Owns the two things the queue deliberately does not: whether a job is *allowed*
 * to run, and whether its inputs exist yet.
 */
@Injectable()
export class VisionJobsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RightsPolicyService) private readonly rights: RightsPolicyService,
    @Inject(VisionAuditService) private readonly audit: VisionAuditService,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    @Inject(VISION_CONFIG) private readonly config: VisionConfig,
    @Inject(VisionModelsService) private readonly models: VisionModelsService,
    @Inject(OBJECT_STORE) private readonly store?: ObjectStore
  ) {}

  /**
   * Queue a job against a video asset.
   *
   * Three gates, in this order, because the cheapest refusal should come first
   * and the rights check must never be skippable:
   *
   *   1. the asset exists and is linked to a fixture
   *   2. `canAnalyze` is granted right now
   *   3. every prerequisite stage has already succeeded
   *
   * Then two resolutions, so the worker receives what it cannot work out alone:
   * the one model version a model-bound job must run, and the proxy's clock for any
   * stage that reads the proxy. Both are written into the job here, at enqueue,
   * because a worker sees a presigned URL and a job id -- it cannot ask which model
   * the operator meant, or what a trimmed proxy's source offset is.
   */
  private async prepareForAsset(params: AssetJobRequest) {
    const asset = await this.prisma.visionVideoAsset.findUnique({
      where: { id: params.videoAssetId },
      select: { id: true, sbMatchId: true, ingestState: true, checksumSha256: true, durationMs: true },
    });
    if (!asset) throw refusal(400, "AssetUnknown", `Unknown video asset ${params.videoAssetId}`, "Check the asset id; list footage with GET /vision/assets.");

    // Inference against footage nobody has linked to a fixture produces evidence
    // that cannot be attributed to anything.
    const needsMatch = params.type !== "probe" && params.type !== "fingerprint";
    if (needsMatch && !asset.sbMatchId) {
      throw refusal(400, "AssetNotLinked", `Asset ${asset.id} is not linked to a match yet. Link it before queueing ${params.type}.`, "Link the asset's source record to its match, then queue the stage.");
    }

    const decision = await this.rights.canAnalyze({ videoAssetId: asset.id });
    if (!decision.allowed) {
      throw new ForbiddenException({
        statusCode: 403,
        error: "RightsDenied",
        message: `Analysis rights are not granted for this source.`,
        reason: decision.reason,
        assetId: asset.id,
        remediation: decision.remediation,
      });
    }

    await this.assertPrerequisitesMet(params.type, asset.id);

    const model = await this.models.resolveForJob(params.type, params.modelVersionId);
    // Any stage that, however indirectly, follows transcode reads the proxy.
    const proxy = dependsOn(params.type, "transcode") ? await this.proxyClock(asset.id) : null;
    const track = params.type === "track" ? await this.trackInputs(asset.id, params.params) : null;
    const identify = params.type === "identify" ? await this.identifyInputs(asset.id, params.params) : null;
    const gamestate = params.type === "gamestate" ? await this.gamestateInputs(asset.id, params.params) : null;
    const ball = params.type === "ball_trajectory" ? await this.ballInputs(asset, params.params) : null;
    const possession = params.type === "possession" ? await this.possessionInputs(asset, params.params) : null;
    const events = params.type === "events" && model && this.store ? await eventCarryInputs(this.prisma, this.store, asset, model.id, params.params) : null;
    if (params.type === "events" && !events) throw refusal(409, "EventCarryEvidenceMissing", "Event proposals require a resolved algorithm and original evidence storage.", "Select a compatible event rule version and complete calibrated possession.");

    const resourceClass = params.resourceClass ?? DEFAULT_RESOURCE_CLASS[params.type];
    if (params.type === "ball_trajectory" && resourceClass !== "cpu_small") throw refusal(400, "BallTrajectoryCpuOnly", "Ball trajectory is a CPU transformation of stored detections.", "Use the default cpu_small resource class.");
    if (params.type === "possession" && resourceClass !== "cpu_small") throw refusal(400, "PossessionCpuOnly", "Possession candidates transform stored observations on CPU.", "Use cpu_small.");
    if (params.type === "events" && resourceClass !== "cpu_small") throw refusal(400, "EventsCpuOnly", "Carry proposals transform original observations on CPU.", "Use cpu_small.");

    return { asset, model, proxy, track, identify, gamestate, ball, possession, events, resourceClass };
  }

  /** Read-only, fail-fast assessment of exactly the inputs enqueue would resolve. */
  async carryPreflight(videoAssetId: string, modelVersionId?: string, possessionJobId?: string) {
    const checkedAt = new Date().toISOString();
    try {
      const prepared = await this.prepareForAsset({ type: "events", videoAssetId, modelVersionId, params: possessionJobId === undefined ? undefined : { possessionJobId } });
      return { videoAssetId, checkedAt, ready: true as const, modelVersionId: prepared.model!.id, possessionJobId: prepared.events!.possession.jobId };
    } catch (error) {
      if (!(error instanceof HttpException) || error.getStatus() >= 500) throw error;
      const response = error.getResponse();
      const body = typeof response === "object" ? response as Record<string, unknown> : { message: response };
      return { videoAssetId, checkedAt, ready: false as const, blocker: { statusCode: error.getStatus(), error: String(body.error ?? "CarryPreflightBlocked"), message: String(body.message ?? "Carry inputs are unavailable."), remediation: String(body.remediation ?? "Review the named input, then recheck.") } };
    }
  }

  async enqueueForAsset(params: AssetJobRequest, actor?: AdminAuthContext): Promise<{ id: string }> {
    const { asset, model, proxy, track, identify, gamestate, ball, possession, events, resourceClass } = await this.prepareForAsset(params);
    // The id is generated here so the output prefix can be derived from it in the
    // same insert: an artifact key then names the job that produced it, with no
    // second write to correct.
    const id = randomUUID();
    const created = await this.queue.enqueue({
      id,
      type: params.type,
      resourceClass,
      priority: params.priority,
      videoAssetId: asset.id,
      modelVersionId: model?.id ?? null,
      // The caller's params go first and lose every key the control plane owns, and the
      // asset, clock and declared inputs are spread after them, so a caller cannot forge
      // any of them -- in particular not `readKeys`, which becomes the list of objects
      // the worker may presign (docs/vision/50, PR-3).
      inputSpec: {
        ...withoutReservedInputs(params.params),
        videoAssetId: asset.id,
        ...(params.type === "detect" ? { sourceChecksum: asset.checksumSha256 } : {}),
        ...(proxy ? { proxy } : {}),
        ...(track ?? {}),
        ...(identify ?? {}),
        ...(gamestate ?? {}),
        ...(ball ?? {}),
        ...(possession ?? {}),
        ...(events ?? {}),
      },
      // Attempt 1 by construction; a retry writes to its own attempt prefix.
      outputPrefix: visionKeys.inferencePrefix(id, 1),
      budgetSeconds: params.budgetSeconds ?? this.config.jobs.defaultBudgetSeconds,
      budgetUsdCents: params.budgetUsdCents ?? this.config.jobs.defaultBudgetUsdCents,
      createdBy: actor?.userId ?? null,
    });

    await this.audit.record(
      {
        action: "job.queued",
        targetKind: "vision_job",
        targetId: created.id,
        data: {
          type: params.type,
          resourceClass,
          videoAssetId: asset.id,
          modelVersionId: model?.id ?? null,
        },
      },
      actor
    );

    return created;
  }

  /**
   * The detect artifact a track job links, declared on the job so the worker may
   * read it and nothing else.
   *
   * The latest succeeded detect job for the asset, or the one named in
   * `params.detectJobId`. Refused when none exists, or when its boxes were sampled
   * too sparsely to link: a player moves too far between frames at 2fps, and the
   * worker would refuse the job anyway -- better at the door than after a pod spun up.
   */
  private async trackInputs(
    videoAssetId: string,
    requested: Record<string, unknown> | undefined
  ): Promise<TrackJobParams> {
    const wanted = typeof requested?.detectJobId === "string" ? requested.detectJobId : null;
    const job = await this.prisma.visionJob.findFirst({
      where: { type: "detect", state: "succeeded", videoAssetId, ...(wanted ? { id: wanted } : {}) },
      orderBy: { finishedAt: "desc" },
      select: { id: true, modelVersionId: true, progress: true },
    });
    const progress = (job?.progress ?? null) as
      | { artifacts?: { key: string; bucket: string; role: string }[]; summary?: { sampleFps?: unknown } }
      | null;
    const artifact = progress?.artifacts?.find((a) => a.role === DETECTION_ARTIFACT_ROLE && a.bucket === "derived");
    if (!job || !artifact || !job.modelVersionId) {
      throw new ConflictException({
        statusCode: 409,
        error: "DetectionsMissing",
        message: wanted
          ? `Detect job ${wanted} did not succeed for this asset, or reported no detections artifact.`
          : "No succeeded detect job with a detections artifact exists for this asset.",
        remediation: "Queue detect for the asset, then track.",
      });
    }
    const sampleFps = typeof progress?.summary?.sampleFps === "number" ? progress.summary.sampleFps : 0;
    if (sampleFps < MIN_TRACK_SAMPLE_FPS) {
      throw new ConflictException({
        statusCode: 409,
        error: "DetectionsTooSparse",
        message: `The detections were sampled at ${sampleFps}fps; tracking needs at least ${MIN_TRACK_SAMPLE_FPS}.`,
        remediation: "Queue detect with params.sampleFps at the proxy's rate, then track.",
      });
    }
    /* Where the camera changes: the start of every camera segment but the first. The
       tracker ends every live track there, because the box on the far side is another
       camera's picture. With no segments yet (cuts not run, none declared) there are
       none, and only the clock ends a track. */
    const starts = await this.prisma.visionCameraSegment.findMany({ where: { videoAssetId }, orderBy: { startMs: "asc" }, select: { startMs: true } });
    const cuts = [...new Set(starts.map((s) => s.startMs))].slice(1);
    return {
      detections: { jobId: job.id, key: artifact.key, modelVersionId: job.modelVersionId, sampleFps },
      ...(cuts.length ? { cuts } : {}),
      readKeys: [{ bucket: "derived", key: artifact.key }],
    };
  }

  private async possessionInputs(asset: { id: string; checksumSha256: string; durationMs: number | null }, requested?: Record<string, unknown>): Promise<PossessionJobParams> {
    const fail = () => refusal(409, "PossessionEvidenceMismatch", "Possession needs a current, succeeded ball trajectory and full-rate tracks from the same detection bytes and camera boundaries.", "Complete compatible detect, ball_trajectory and track runs for this asset first.");
    const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/i.test(v);
    const positive = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
    const selectJob = (type: "ball_trajectory" | "track", id: unknown) => this.prisma.visionJob.findFirst({ where: { videoAssetId: asset.id, type, state: "succeeded", ...(typeof id === "string" ? { id } : {}) }, orderBy: { finishedAt: "desc" } });
    const ball = await selectJob("ball_trajectory", requested?.ballJobId);
    const track = await selectJob("track", requested?.trackJobId);
    const bp = ball?.progress as { summary?: Record<string, unknown>; artifacts?: { key: string; bucket: string; role: string }[] } | null;
    const tp = track?.progress as typeof bp;
    const b = bp?.summary, t = tp?.summary;
    const input = ball?.inputSpec as Record<string, unknown> | null;
    const detector = input?.detections as Record<string, unknown> | undefined;
    const artifacts = (p: typeof bp, role: string) => Array.isArray(p?.artifacts) ? p.artifacts.filter((a) => a && a.role === role && a.bucket === "derived") : [];
    const indices = artifacts(bp, BALL_TRAJECTORY_INDEX_ROLE), chunks = artifacts(bp, BALL_TRAJECTORY_CHUNK_ROLE), tracks = artifacts(tp, TRACK_ARTIFACT_ROLE);
    if (!ball || !track?.modelVersionId || !b || !t || !input || !detector || indices.length !== 1 || tracks.length !== 1 || !chunks.length || chunks.length > 6000
      || chunks.length !== b.chunks || b.calculationVersion !== BALL_TRAJECTORY_VERSION || !hash(asset.checksumSha256) || !positive(asset.durationMs)
      || !hash(b.indexChecksum) || !hash(b.detectionsChecksum) || !hash(t.tracksChecksum) || !hash(input.proxyChecksum)
      || input.sourceChecksum !== asset.checksumSha256 || input.sourceDurationMs !== asset.durationMs || b.sourceChecksum !== asset.checksumSha256 || t.sourceChecksum !== asset.checksumSha256
      || t.proxyChecksum !== input.proxyChecksum || t.detectionsChecksum !== b.detectionsChecksum || t.detectJobId !== detector.jobId || t.detectorVersionId !== detector.modelVersionId || t.trackerVersionId !== track.modelVersionId
      || b.detectorJobId !== detector.jobId || b.detectorVersionId !== detector.modelVersionId || !positive(input.imageWidth) || !positive(input.imageHeight) || !positive(input.proxyDurationMs)
      || t.imageWidth !== input.imageWidth || t.imageHeight !== input.imageHeight || t.proxyDurationMs !== input.proxyDurationMs
      || [...indices, ...chunks].some((a) => typeof a.key !== "string" || !a.key.startsWith(visionKeys.inferencePrefix(ball.id, ball.attemptNumber)))
      || !tracks[0]!.key.startsWith(visionKeys.inferencePrefix(track.id, track.attemptNumber)) || new Set([...indices, ...chunks].map((a) => a.key)).size !== chunks.length + 1)
      throw fail();
    const proxy = await this.proxyClock(asset.id);
    const ballProxy = input.proxy as Record<string, unknown> | undefined, trackProxy = t.proxy as Record<string, unknown> | undefined;
    const windowEnd = Math.min(asset.durationMs, proxy.sourceOffsetMs + input.proxyDurationMs);
    if (!ballProxy || !trackProxy || proxy.fps < 10 || proxy.fps > 120 || ballProxy.fps !== proxy.fps || trackProxy.fps !== proxy.fps || t.sampleFps !== proxy.fps
      || ballProxy.sourceOffsetMs !== proxy.sourceOffsetMs || trackProxy.sourceOffsetMs !== proxy.sourceOffsetMs || proxy.sourceOffsetMs < 0 || proxy.sourceOffsetMs >= asset.durationMs
      || Math.ceil(input.proxyDurationMs * proxy.fps / 1000) > 1_000_000 || b.windowStartMs !== proxy.sourceOffsetMs || b.windowEndMs !== windowEnd || b.frames !== Math.ceil((windowEnd - proxy.sourceOffsetMs) * proxy.fps / 1000)) throw fail();
    const cameras = await this.prisma.visionCameraSegment.findMany({ where: { videoAssetId: asset.id }, orderBy: { startMs: "asc" }, select: { id: true, startMs: true, endMs: true, kind: true } });
    const segments = cameras.map((s) => ({ cameraSegmentId: s.id, startMs: s.startMs, endMs: s.endMs, kind: s.kind as BallTrajectoryJobParams["segments"][number]["kind"] }));
    if (JSON.stringify(segments) !== JSON.stringify(input.segments) || !Array.isArray(t.cameraCuts) || segments.slice(1).some((s) => !(t.cameraCuts as unknown[]).includes(s.startMs))) throw fail();
    const config = requested?.possessionConfig;
    if (config !== undefined) {
      const ranges: Record<string, [number, number]> = { minBallConfidence: [0, 1], minPlayerConfidence: [0, 1], maxFootDistanceHeights: [Number.MIN_VALUE, 0.5], minContinuityMs: [80, 2000] };
      if (!config || typeof config !== "object" || Array.isArray(config) || Object.entries(config).some(([key, value]) => !ranges[key] || typeof value !== "number" || !Number.isFinite(value) || value < ranges[key]![0] || value > ranges[key]![1] || (key === "minContinuityMs" && !Number.isInteger(value))))
        throw refusal(400, "InvalidPossessionConfig", "Invalid possession confidence, foot distance or continuity configuration.", "Use supported finite values; continuity is an integer from 80 to 2000 ms.");
    }
    if (requested?.chunkMs !== undefined && (!positive(requested.chunkMs) || requested.chunkMs < 10000 || requested.chunkMs > 600000)) throw refusal(400, "InvalidPossessionConfig", "Possession chunks must be 10000–600000 ms.", "Use the default 60000 ms chunks.");
    const mode = requested?.constraintMode ?? "image";
    if ((mode !== "image" && mode !== "calibrated") || (mode === "image" && requested?.calibrationSnapshot !== undefined)) throw refusal(400, "InvalidPossessionConfig", "Choose image or calibrated constraints; calibration evidence is owned by the API.", "Use constraintMode: calibrated for pitch constraints.");
    const football = requested?.footballConfig;
    const ranges: Record<string, [number, number]> = { maxGroundDistanceM: [0.1, 3], maxBallGroundSpeedMps: [5, 50], maxPlayerSpeedMps: [2, 15] };
    if (football !== undefined && (mode !== "calibrated" || !football || typeof football !== "object" || Array.isArray(football)
      || Object.entries(football).some(([k, v]) => !ranges[k] || typeof v !== "number" || !Number.isFinite(v) || v < ranges[k]![0] || v > ranges[k]![1])))
      throw refusal(400, "InvalidPossessionConfig", "Invalid calibrated distance or motion limits.", "Use the documented finite footballConfig ranges with calibrated mode.");
    const calibrationSnapshot = mode === "calibrated" ? await possessionCalibration(this.prisma, asset.id) : undefined;
    if (calibrationSnapshot && (calibrationSnapshot.proxyChecksum !== input.proxyChecksum || JSON.stringify(calibrationSnapshot.segments.map((s) => ({ cameraSegmentId: s.cameraSegmentId, startMs: s.startMs, endMs: s.endMs }))) !== JSON.stringify(segments.map(({ kind: _kind, ...s }) => s)))) throw fail();
    return { ball: { jobId: ball.id, key: indices[0]!.key, indexChecksum: b.indexChecksum, chunkKeys: chunks.map((c) => c.key) },
      tracks: { jobId: track.id, key: tracks[0]!.key, trackerVersionId: track.modelVersionId, checksum: t.tracksChecksum },
      sourceChecksum: asset.checksumSha256, sourceDurationMs: asset.durationMs, proxyChecksum: input.proxyChecksum, proxyDurationMs: input.proxyDurationMs,
      imageWidth: input.imageWidth, imageHeight: input.imageHeight, detectionsChecksum: b.detectionsChecksum, detectorJobId: String(detector.jobId), detectorVersionId: String(detector.modelVersionId), segments, proxy,
      ...(calibrationSnapshot ? { constraintMode: "calibrated" as const, calibrationSnapshot, ...(football ? { footballConfig: football as PossessionJobParams["footballConfig"] } : {}) } : {}),
      readKeys: [...indices, ...chunks, ...tracks].map((a) => ({ bucket: "derived" as const, key: a.key })) };
  }

  private async ballInputs(asset: { id: string; checksumSha256: string; durationMs: number | null }, requested?: Record<string, unknown>): Promise<BallTrajectoryJobParams> {
    const wanted = typeof requested?.detectJobId === "string" ? requested.detectJobId : undefined;
    const job = await this.prisma.visionJob.findFirst({ where: { videoAssetId: asset.id, type: "detect", state: "succeeded", ...(wanted ? { id: wanted } : {}) }, orderBy: { finishedAt: "desc" } });
    const progress = job?.progress as { artifacts?: { role: string; bucket: string; key: string }[]; summary?: Record<string, unknown> } | null;
    const summary = progress?.summary;
    const artifacts = Array.isArray(progress?.artifacts) ? progress.artifacts.filter((row) => row && typeof row === "object" && row.role === DETECTION_ARTIFACT_ROLE && row.bucket === "derived") : [];
    const positive = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
    const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
    if (!job?.modelVersionId || !summary || summary.modelVersionId !== job.modelVersionId || artifacts.length !== 1 || typeof artifacts[0]!.key !== "string" || !artifacts[0]!.key.startsWith(visionKeys.inferencePrefix(job.id, job.attemptNumber))
      || !hash(asset.checksumSha256) || !positive(asset.durationMs) || summary.sourceChecksum !== asset.checksumSha256 || !hash(summary.weightsSha256) || !hash(summary.proxyChecksum)
      || !positive(summary.imageWidth) || !positive(summary.imageHeight) || !positive(summary.proxyDurationMs))
      throw refusal(409, "BallDetectionsMissing", "Ball trajectory needs a succeeded detection artifact with source, proxy, weights and image geometry provenance.", "Complete fingerprint and a current detector run; this CPU stage does not load or approve a detector.");
    const proxy = await this.proxyClock(asset.id);
    if (proxy.fps < 10 || proxy.fps > 120 || summary.sampleFps !== proxy.fps || summary.proxyFps !== proxy.fps || summary.sourceOffsetMs !== proxy.sourceOffsetMs)
      throw refusal(409, "BallDetectionsTooSparse", "Ball trajectory requires detections at the full proxy rate on the same source clock.", "Run a licensed detector with sampleFps equal to the proxy frame rate.");
    if (!Number.isSafeInteger(proxy.sourceOffsetMs) || proxy.sourceOffsetMs < 0 || proxy.sourceOffsetMs >= asset.durationMs || Math.ceil(summary.proxyDurationMs * proxy.fps / 1000) > 1_000_000)
      throw refusal(409, "BallTrajectoryWindowInvalid", "The ball trajectory proxy window is invalid or exceeds one million frames.", "Choose a bounded proxy inside the source, or split the footage.");
    const config = requested?.trajectoryConfig;
    if (config !== undefined) {
      const ranges: Record<string, [number, number]> = { minConfidence: [0, 1], smoothingMs: [0, 1000], maxImageSpeedPerSecond: [Number.MIN_VALUE, 100] };
      if (!config || typeof config !== "object" || Array.isArray(config) || Object.entries(config).some(([key, value]) => !ranges[key] || typeof value !== "number" || !Number.isFinite(value) || value < ranges[key]![0] || value > ranges[key]![1]))
        throw refusal(400, "InvalidBallTrajectoryConfig", "The ball trajectory configuration is invalid.", "Use finite confidence [0,1], smoothingMs [0,1000] and positive maxImageSpeedPerSecond up to 100.");
    }
    if (requested?.chunkMs !== undefined && (!positive(requested.chunkMs) || requested.chunkMs < 10000 || requested.chunkMs > 600000))
      throw refusal(400, "InvalidBallTrajectoryConfig", "Ball chunks must cover 10000 to 600000 source milliseconds.", "Use the default one-minute chunks.");
    const segments = await this.prisma.visionCameraSegment.findMany({ where: { videoAssetId: asset.id }, orderBy: { startMs: "asc" }, select: { id: true, startMs: true, endMs: true, kind: true } });
    if (segments.some((row, i) => !(CAMERA_SEGMENT_KINDS as readonly string[]).includes(row.kind) || row.startMs < 0 || row.endMs <= row.startMs || row.endMs > asset.durationMs! || (i > 0 && row.startMs < segments[i - 1]!.endMs)))
      throw refusal(409, "InvalidBallCameraSegments", "Ball trajectory needs non-overlapping, bounded camera segments with supported kinds.", "Correct the camera segment declarations before queueing.");
    return { detections: { jobId: job.id, key: artifacts[0]!.key, modelVersionId: job.modelVersionId, sampleFps: proxy.fps, weightsChecksum: summary.weightsSha256 },
      sourceChecksum: asset.checksumSha256, sourceDurationMs: asset.durationMs, proxyChecksum: summary.proxyChecksum, proxyDurationMs: summary.proxyDurationMs,
      imageWidth: summary.imageWidth, imageHeight: summary.imageHeight,
      segments: segments.map((segment) => ({ cameraSegmentId: segment.id, startMs: segment.startMs, endMs: segment.endMs, kind: segment.kind as BallTrajectoryJobParams["segments"][number]["kind"] })),
      readKeys: [{ bucket: "derived", key: artifacts[0]!.key }] };
  }

  /**
   * What a gamestate job places with: the track artifact (as identify finds it),
   * every camera segment with its current calibration where there is one, and
   * the clock anchors. Refused when no segment has a calibration at all -- there
   * would be nothing but suppressed rows -- but not when some have failed or
   * none was filed on some: those rows say so.
   */
  private async gamestateInputs(
    videoAssetId: string,
    requested: Record<string, unknown> | undefined
  ): Promise<GameStateJobParams> {
    const identify = await this.identifyInputs(videoAssetId, requested);
    const segments = await this.prisma.visionCameraSegment.findMany({
      where: { videoAssetId },
      orderBy: { startMs: "asc" },
      include: { calibrations: { where: { supersededBy: null }, orderBy: { createdAt: "desc" }, take: 1 } },
    });
    const declared: GameStateJobParams["segments"] = segments.map((s) => {
      const c = s.calibrations[0] ?? null;
      return {
        cameraSegmentId: s.id,
        startMs: s.startMs,
        endMs: s.endMs,
        quality: c ? (c.quality as NonNullable<GameStateJobParams["segments"][number]["quality"]>) : null,
        // Signed by its own clicked points: the stage tells the horizon by the sign of w,
        // and a row filed before the fit oriented its result may be either way round.
        homography: c ? orientStored(c.homography, c.points) : null,
        pitch: c ? { lengthM: c.pitchLengthM, widthM: c.pitchWidthM } : null,
      };
    });
    if (!declared.some((s) => s.quality)) {
      throw new ConflictException({
        statusCode: 409,
        error: "NoCalibration",
        message: segments.length
          ? `None of the asset's ${segments.length} camera segment(s) has a calibration.`
          : "The asset has no camera segments, so nothing can be placed on the pitch.",
        remediation: "Declare segments and calibrate them in the editor, then queue gamestate.",
      });
    }
    const anchors = await this.prisma.visionClockAnchor.findMany({
      where: { videoAssetId, supersededBy: null },
      select: { half: true, sourceMs: true, endMs: true },
      orderBy: { half: "asc" },
    });
    const chunkMs = typeof requested?.chunkMs === "number" && Number.isInteger(requested.chunkMs) && requested.chunkMs > 0 ? requested.chunkMs : undefined;
    return {
      tracks: identify.tracks,
      segments: declared,
      anchors,
      ...(chunkMs ? { chunkMs } : {}),
      readKeys: identify.readKeys,
    };
  }

  /**
   * The track artifact an identify job assigns teams on: the latest succeeded
   * track job for the asset, or the one named in `params.trackJobId`, declared
   * on the job so the worker may read it and nothing else.
   */
  private async identifyInputs(
    videoAssetId: string,
    requested: Record<string, unknown> | undefined
  ): Promise<IdentifyJobParams> {
    const wanted = typeof requested?.trackJobId === "string" ? requested.trackJobId : null;
    const job = await this.prisma.visionJob.findFirst({
      where: { type: "track", state: "succeeded", videoAssetId, ...(wanted ? { id: wanted } : {}) },
      orderBy: { finishedAt: "desc" },
      select: { id: true, modelVersionId: true, progress: true },
    });
    const progress = (job?.progress ?? null) as { artifacts?: { key: string; bucket: string; role: string }[] } | null;
    const artifact = progress?.artifacts?.find((a) => a.role === TRACK_ARTIFACT_ROLE && a.bucket === "derived");
    if (!job || !artifact || !job.modelVersionId) {
      throw new ConflictException({
        statusCode: 409,
        error: "TracksMissing",
        message: wanted
          ? `Track job ${wanted} did not succeed for this asset, or reported no tracks artifact.`
          : "No succeeded track job with a tracks artifact exists for this asset.",
        remediation: "Queue track for the asset, then identify.",
      });
    }
    return {
      tracks: { jobId: job.id, key: artifact.key, trackerVersionId: job.modelVersionId },
      readKeys: [{ bucket: "derived", key: artifact.key }],
    };
  }

  /**
   * The proxy's constant frame rate and source offset, from the variant row.
   *
   * Refused rather than defaulted when the proxy records no frame rate: a guessed
   * rate produces frame indices that look precise and are wrong, which is the same
   * refusal the dataset export makes (`proxy_without_fps`).
   */
  private async proxyClock(videoAssetId: string): Promise<{ fps: number; sourceOffsetMs: number }> {
    const proxy = await this.prisma.visionVideoVariant.findFirst({
      where: { videoAssetId, kind: "proxy" },
      orderBy: { createdAt: "desc" },
      select: { fps: true, sourceOffsetMs: true },
    });
    if (!proxy) {
      throw new ConflictException({
        statusCode: 409,
        error: "ProxyMissing",
        message: "transcode succeeded for this asset but no proxy variant is recorded.",
        remediation: "Re-run transcode so the variant row is written.",
      });
    }
    if (proxy.fps === null || !(proxy.fps > 0)) {
      throw new ConflictException({
        statusCode: 409,
        error: "ProxyWithoutFps",
        message: "The proxy records no frame rate, so no stage can map its frames to time.",
        remediation: "Re-run transcode; the worker reports the proxy's frame rate.",
      });
    }
    return { fps: proxy.fps, sourceOffsetMs: proxy.sourceOffsetMs };
  }

  /**
   * Queue a job that has no asset: a benchmark, later a training run.
   *
   * No rights check here, deliberately. Rights are per asset, and the asset-level
   * decisions were taken when the detect jobs this consumes were queued and when
   * the dataset was frozen; the caller (`VisionBenchmarksService`) re-checks the
   * dataset's revocation flag. What this does guard is the contract: the type must
   * be one that exists, and the model version, when given, must be real.
   */
  async enqueueDetached(
    params: {
      type: VisionJobType;
      datasetVersionId: string;
      modelVersionId?: string | null;
      params: Record<string, unknown>;
      priority?: number;
      budgetSeconds?: number;
      budgetUsdCents?: number;
    },
    actor?: AdminAuthContext
  ): Promise<{ id: string }> {
    if (JOB_TYPE_PREREQUISITES[params.type].length) {
      throw refusal(400, "StageNeedsAnAsset", `${params.type} depends on other stages for an asset; queue it with POST /vision/jobs instead.`, "Queue it for an asset with POST /vision/jobs.");
    }
    const id = randomUUID();
    const created = await this.queue.enqueue({
      id,
      type: params.type,
      resourceClass: DEFAULT_RESOURCE_CLASS[params.type],
      priority: params.priority,
      videoAssetId: null,
      datasetVersionId: params.datasetVersionId,
      modelVersionId: params.modelVersionId ?? null,
      inputSpec: params.params,
      outputPrefix: visionKeys.inferencePrefix(id, 1),
      budgetSeconds: params.budgetSeconds ?? this.config.jobs.defaultBudgetSeconds,
      budgetUsdCents: params.budgetUsdCents ?? this.config.jobs.defaultBudgetUsdCents,
      createdBy: actor?.userId ?? null,
    });
    await this.audit.record(
      {
        action: "job.queued",
        targetKind: "vision_job",
        targetId: created.id,
        data: {
          type: params.type,
          resourceClass: DEFAULT_RESOURCE_CLASS[params.type],
          datasetVersionId: params.datasetVersionId,
          modelVersionId: params.modelVersionId ?? null,
        },
      },
      actor
    );
    return created;
  }

  async retry(jobId: string, actor?: AdminAuthContext) {
    const job = await this.prisma.visionJob.findUnique({
      where: { id: jobId },
      select: { state: true, attemptNumber: true, maxAttempts: true, videoAssetId: true },
    });
    if (!job) throw refusal(400, "JobUnknown", `Unknown job ${jobId}`, "Check the job id; list jobs with GET /vision/jobs.");
    if (!["failed", "cancelled", "expired"].includes(job.state)) {
      throw refusal(400, "JobNotFinished", `Job is ${job.state}; only a finished job can be retried.`, "Wait for the job to finish, or cancel it, then retry.");
    }
    // The grant that allowed the first attempt may have been withdrawn since.
    if (job.videoAssetId) {
      const decision = await this.rights.canAnalyze({ videoAssetId: job.videoAssetId });
      if (!decision.allowed) {
        throw new ForbiddenException({
          statusCode: 403,
          error: "RightsDenied",
          message: decision.detail,
          reason: decision.reason,
          remediation: decision.remediation,
        });
      }
    }

    await this.prisma.visionJob.update({
      where: { id: jobId },
      data: {
        state: "queued",
        attemptNumber: { increment: 1 },
        workerId: null,
        claimedAt: null,
        startedAt: null,
        heartbeatAt: null,
        finishedAt: null,
        // A retry gets its own prefix, so the failed attempt's artifacts survive
        // for debugging rather than being overwritten.
        outputPrefix: visionKeys.inferencePrefix(jobId, job.attemptNumber + 1),
      },
    });
    await this.prisma.visionJobEvent.create({
      data: { jobId, kind: "retried", data: { by: actor?.userId ?? null } as never },
    });
  }

  async cancel(jobId: string, reason: string, actor?: AdminAuthContext) {
    await this.queue.cancel(jobId, reason, actor?.userId ?? null);
    await this.audit.record(
      { action: "job.cancelled", targetKind: "vision_job", targetId: jobId, data: { reason } },
      actor
    );
  }

  /**
   * Refuses to queue a stage whose inputs do not exist yet.
   *
   * Without this, a `track` job would claim, fail to find detections, and burn an
   * attempt — or worse, a GPU minute.
   */
  private async assertPrerequisitesMet(type: VisionJobType, videoAssetId: string) {
    const required = JOB_TYPE_PREREQUISITES[type];
    if (!required.length) return;

    const satisfied = await this.prisma.visionJob.findMany({
      where: { videoAssetId, type: { in: [...required] }, state: "succeeded" },
      select: { type: true },
    });
    const done = new Set(satisfied.map((j) => j.type));
    const missing = required.filter((r) => !done.has(r));

    if (missing.length) {
      throw refusal(400, "PrerequisiteMissing", `${type} needs ${missing.join(" and ")} to have succeeded for this asset first.`, "Run the stages it names for this asset first.");
    }
  }
}

/** Whether `type` has `ancestor` anywhere in its prerequisite chain. */
function dependsOn(type: VisionJobType, ancestor: VisionJobType): boolean {
  const seen = new Set<VisionJobType>();
  const stack: VisionJobType[] = [...JOB_TYPE_PREREQUISITES[type]];
  while (stack.length) {
    const next = stack.pop()!;
    if (next === ancestor) return true;
    if (seen.has(next)) continue;
    seen.add(next);
    stack.push(...JOB_TYPE_PREREQUISITES[next]);
  }
  return false;
}

/** Keys of a job's inputSpec that only the control plane writes. */
export const RESERVED_INPUT_KEYS = [
  "videoAssetId",
  "proxy",
  "readKeys",
  "detections",
  "tracks",
  "segments",
  "anchors",
  "cuts",
  "sourceChecksum",
  "sourceDurationMs",
  "proxyChecksum",
  "proxyDurationMs",
  "imageWidth",
  "imageHeight",
  "ball",
  "detectionsChecksum",
  "detectorJobId",
  "detectorVersionId",
  "eventAlgorithm",
  "possession",
  "possessionIndex",
  "possessionSource",
  "windowStartMs",
  "windowEndMs",
] as const;

export function withoutReservedInputs(params: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    if (!(RESERVED_INPUT_KEYS as readonly string[]).includes(key)) out[key] = value;
  }
  return out;
}
