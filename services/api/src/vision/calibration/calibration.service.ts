import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { OFF_PITCH_MARGIN_M } from "@dtp/vision-contracts";
import type { AdminAuthContext } from "../../admin/auth/admin-auth.types";
import { PrismaService } from "../../prisma/prisma.service";
import { VisionAuditService } from "../audit/vision-audit.service";
import { VISION_CONFIG, type VisionConfig } from "../config/vision.config";
import { VisionIdentityService } from "../identity/identity.service";
import { OBJECT_STORE, type ObjectStore } from "../storage/object-store";
import { CALIBRATION_THRESHOLDS, qualityOf, type CalibrationQuality, type CalibrationThresholds } from "./calibration-thresholds";
import { fitHomography, homogeneousW, invert3, isFit, orientStored, project, projectInView, type Correspondence, type Fit, type FitFailure, type Homography } from "./homography";
import { DEFAULT_PITCH, landmarkById, pitchLines, pitchProblem, type PitchDimensions } from "./pitch-model";
import { pinnedProxy } from "./pinned-proxy";
import { carriedRunStale, carriedSegment, currentCarriedRun, readCarriedFrames } from "./carried-run";
import { notFound, personFor } from "../shared/refusals";

/**
 * Calibration: a homography per camera segment, and what may be derived from it.
 *
 * Phase 5's first increment, by hand. A person declares the camera segments of an
 * asset (a cut resets calibration rather than carrying a stale homography across
 * it, so a segment is the unit), clicks pitch landmarks on a frame, and the
 * control plane fits the homography, scores its reprojection error and files it
 * with a quality. A `calibrate` stage will later write the same row with
 * `method: model`, and the editor will remain, because on wide handheld footage
 * the model fails often enough that the editor is a requirement.
 *
 * **The suppression rule** lives in `pitchPositions`: a track's positions become
 * metres only through a calibration that is `good` or `usable` for the moment of
 * each position, and a distance is reported only when every position was placed.
 * Otherwise the metric is absent and labelled, never present with a caveat.
 */

export type CalibrationPointInput = { landmark: string; px: number; py: number; frameIndex?: number };

/** The pitch's markings in proxy pixels, each polyline broken where it leaves the picture or crosses the horizon. */
export type Overlay = { id: string; points: { px: number; py: number }[] }[];

export type PreviewResult =
  | {
      ok: true;
      pitch: PitchDimensions;
      homography: Homography;
      reprojectionErrorM: number;
      maxPointErrorM: number;
      reprojectionErrorPx: number;
      points: number;
      quality: CalibrationQuality;
      thresholdsVersion: string;
      overlay: Overlay;
      /** Each clicked landmark projected back from the pitch: where the fit thinks the click should have been. */
      reprojected: { landmark: string; px: number; py: number; errorM: number }[];
    }
  | { ok: false; pitch: PitchDimensions; reason: FitFailure["reason"] | "unknown_landmark"; detail?: string };

@Injectable()
export class VisionCalibrationService {
  private readonly thresholds: CalibrationThresholds = CALIBRATION_THRESHOLDS;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(VisionAuditService) private readonly audit: VisionAuditService,
    @Inject(VisionIdentityService) private readonly identity: VisionIdentityService,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    @Inject(VISION_CONFIG) private readonly config: VisionConfig
  ) {}

  // ── Segments ─────────────────────────────────────────────────────────────

  /**
   * A camera segment of an asset, in source milliseconds, declared by a person.
   * Segments of one asset do not overlap: a moment has one camera.
   */
  async declareSegment(videoAssetId: string, input: { startMs: number; endMs: number; kind: string }, actor?: AdminAuthContext) {
    const person = requirePerson(actor, "declare a camera segment");
    const asset = await this.prisma.visionVideoAsset.findUnique({ where: { id: videoAssetId }, select: { id: true, durationMs: true } });
    if (!asset) throw notFound("video asset", videoAssetId);
    if (input.endMs <= input.startMs) {
      throw new ConflictException({ statusCode: 409, error: "SegmentEmpty", message: `A segment from ${input.startMs} to ${input.endMs}ms is empty.`, remediation: "endMs must be after startMs." });
    }
    if (asset.durationMs !== null && input.endMs > asset.durationMs) {
      throw new ConflictException({ statusCode: 409, error: "SegmentOutsideAsset", message: `The asset is ${asset.durationMs}ms long; the segment ends at ${input.endMs}ms.`, remediation: "Keep the segment inside the footage." });
    }
    const overlapping = await this.prisma.visionCameraSegment.findFirst({
      where: { videoAssetId, startMs: { lt: input.endMs }, endMs: { gt: input.startMs } },
      select: { id: true, startMs: true, endMs: true },
    });
    if (overlapping) {
      throw new ConflictException({
        statusCode: 409,
        error: "SegmentOverlaps",
        message: `Segment ${overlapping.id} already covers ${overlapping.startMs}–${overlapping.endMs}ms.`,
        remediation: "A moment has one camera. Declare the segment beside it, not over it.",
      });
    }
    const segment = await this.prisma.visionCameraSegment.create({
      data: { videoAssetId, startMs: input.startMs, endMs: input.endMs, kind: input.kind, source: "manual", createdBy: person.userId },
    });
    await this.audit.record({ action: "camera.segment.declared", targetKind: "vision_camera_segment", targetId: segment.id, data: { videoAssetId, startMs: input.startMs, endMs: input.endMs, kind: input.kind } }, actor);
    return segment;
  }

  /**
   * A person removes a segment that has no calibration -- a proposal that was
   * wrong, or a declaration that was. One with a calibration is a fact with a
   * name on it and stays; supersede its calibration instead.
   */
  async deleteSegment(cameraSegmentId: string, actor?: AdminAuthContext) {
    requirePerson(actor, "remove a camera segment");
    const segment = await this.prisma.visionCameraSegment.findUnique({
      where: { id: cameraSegmentId },
      select: { id: true, videoAssetId: true, source: true, startMs: true, endMs: true, _count: { select: { calibrations: true } } },
    });
    if (!segment) throw notFound("camera segment", cameraSegmentId);
    if (segment._count.calibrations > 0) {
      throw new ConflictException({
        statusCode: 409,
        error: "SegmentCalibrated",
        message: `Segment ${cameraSegmentId} has ${segment._count.calibrations} calibration(s) on it.`,
        remediation: "A calibrated segment is a fact with a name on it. Supersede the calibration instead.",
      });
    }
    /* A candidate filed under this segment took its in-play flag from the segment's kind,
       and links to it as evidence. There is no foreign key, so deleting the segment used to
       leave both pointing at nothing. */
    const [filedUnder, linked] = await Promise.all([
      this.prisma.visionEventCandidate.count({ where: { cameraSegmentId: segment.id, supersededBy: null } }),
      this.prisma.visionEvidenceLink.count({ where: { kind: "camera_segment", targetId: segment.id, candidate: { supersededBy: null } } }),
    ]);
    if (filedUnder || linked) {
      throw new ConflictException({
        statusCode: 409,
        error: "SegmentReferenced",
        message: `Segment ${cameraSegmentId} is evidence for ${Math.max(filedUnder, linked)} current event candidate(s).`,
        remediation: "Correct those candidates first, or leave the segment and change what is wrong about it.",
      });
    }
    await this.prisma.visionCameraSegment.delete({ where: { id: segment.id } });
    await this.audit.record({ action: "camera.segment.removed", targetKind: "vision_camera_segment", targetId: segment.id, data: { videoAssetId: segment.videoAssetId, source: segment.source, startMs: segment.startMs, endMs: segment.endMs } }, actor);
    return { removed: segment.id };
  }

  /**
   * A person says what a segment is: live play, a replay, half-time. On a proposal
   * this is the person adopting it, so it becomes `manual`, with their name, and a
   * later automatic run no longer replaces it. Refused while current event candidates
   * were filed under the segment: their in-play flag came from its kind.
   */
  async setSegmentKind(cameraSegmentId: string, kind: string, actor?: AdminAuthContext) {
    const person = requirePerson(actor, "set a camera segment's kind");
    const segment = await this.prisma.visionCameraSegment.findUnique({
      where: { id: cameraSegmentId },
      select: { id: true, videoAssetId: true, kind: true, source: true, startMs: true, endMs: true },
    });
    if (!segment) throw notFound("camera segment", cameraSegmentId);
    if (segment.kind === kind && segment.source === "manual") return segment;
    const [filedUnder, linked] = await Promise.all([
      this.prisma.visionEventCandidate.count({ where: { cameraSegmentId: segment.id, supersededBy: null } }),
      this.prisma.visionEvidenceLink.count({ where: { kind: "camera_segment", targetId: segment.id, candidate: { supersededBy: null } } }),
    ]);
    if (segment.kind !== kind && (filedUnder || linked)) {
      throw new ConflictException({
        statusCode: 409,
        error: "SegmentReferenced",
        message: `Segment ${cameraSegmentId} is evidence for ${Math.max(filedUnder, linked)} current event candidate(s), which took their in-play flag from its kind.`,
        remediation: "Correct those candidates first, then change the segment's kind.",
      });
    }
    const updated = await this.prisma.visionCameraSegment.update({
      where: { id: segment.id },
      data: { kind, source: "manual", ...(segment.source === "manual" ? {} : { createdBy: person.userId }) },
    });
    await this.audit.record({ action: "camera.segment.updated", targetKind: "vision_camera_segment", targetId: segment.id,
      data: { videoAssetId: segment.videoAssetId, startMs: segment.startMs, endMs: segment.endMs, kindFrom: segment.kind, kindTo: kind, sourceFrom: segment.source } }, actor);
    return updated;
  }

  /** The asset's segments with each one's current calibration, as a reviewer reads them. */
  async segments(videoAssetId: string) {
    const asset = await this.prisma.visionVideoAsset.findUnique({ where: { id: videoAssetId }, select: { id: true, durationMs: true } });
    if (!asset) throw notFound("video asset", videoAssetId);
    const segments = await this.prisma.visionCameraSegment.findMany({
      where: { videoAssetId },
      orderBy: { startMs: "asc" },
      include: { calibrations: { orderBy: { createdAt: "desc" } } },
    });
    const rows = segments.map((s) => {
      const live = s.calibrations.filter((c) => c.supersededBy === null && c.withdrawnAt === null);
      // A segment holds one whole-segment calibration (a still camera) or keyframes (a moving one).
      const current = live.find((c) => c.frameIndex === null) ?? null;
      const keyframes = live.filter((c) => c.frameIndex !== null).sort((a, b) => a.frameIndex! - b.frameIndex!);
      return {
        id: s.id,
        kind: s.kind,
        source: s.source,
        startMs: s.startMs,
        endMs: s.endMs,
        calibration: current ? summarise(current) : null,
        keyframes: keyframes.map((k) => ({ ...summarise(k), frameIndex: k.frameIndex! })),
        superseded: s.calibrations.filter((c) => c.supersededBy !== null || c.withdrawnAt !== null).length,
      };
    });
    const covered = rows.reduce((ms, r) => ms + (r.endMs - r.startMs), 0);
    return {
      videoAssetId,
      durationMs: asset.durationMs,
      segments: rows,
      coverage: {
        segmentedMs: covered,
        calibratedMs: rows.filter((r) => r.calibration && r.calibration.quality !== "failed").reduce((ms, r) => ms + (r.endMs - r.startMs), 0),
        // Segments with keyframes: how much of each the `calibrate` stage carries them to is its finding, not this one.
        keyframedMs: rows.filter((r) => r.keyframes.some((k) => k.quality !== "failed")).reduce((ms, r) => ms + (r.endMs - r.startMs), 0),
      },
      thresholds: this.thresholds,
    };
  }

  // ── Calibration ──────────────────────────────────────────────────────────

  /** The fit and its quality, saved nowhere: the editor's live readout. */
  preview(points: CalibrationPointInput[], pitch: PitchDimensions = DEFAULT_PITCH): PreviewResult {
    const problem = pitchProblem(pitch);
    if (problem) throw new BadRequestException({ statusCode: 400, error: "PitchDimensionsInvalid", message: problem, remediation: "Give the pitch's real length and width in metres, or leave them out for 105 by 68." });
    const by = landmarkById(pitch);
    const pairs: Correspondence[] = [];
    for (const p of points) {
      const l = by.get(p.landmark);
      if (!l) return { ok: false, pitch, reason: "unknown_landmark", detail: p.landmark };
      pairs.push({ px: p.px, py: p.py, xM: l.xM, yM: l.yM });
    }
    const fit = fitHomography(pairs);
    if (!isFit(fit)) return { ok: false, pitch, reason: fit.reason };
    const back = invert3(fit.homography);
    const reprojected = back
      ? points.map((p, i) => {
          const l = pairs[i]!;
          const onPitch = projectInView(fit.homography, { x: p.px, y: p.py }) ?? project(fit.homography, { x: p.px, y: p.py });
          const onPicture = project(back, { x: l.xM, y: l.yM });
          return { landmark: p.landmark, px: onPicture ? round(onPicture.x) : p.px, py: onPicture ? round(onPicture.y) : p.py, errorM: onPitch ? round(Math.hypot(onPitch.x - l.xM, onPitch.y - l.yM)) : 0 };
        })
      : [];
    const inView = { x: pairs[0]!.xM, y: pairs[0]!.yM };
    return { ok: true, pitch, ...describeFit(fit, this.thresholds), overlay: back ? overlayFor(back, pitch, inView) : [], reprojected };
  }

  /**
   * A person's calibration of a segment. A fit that cannot be made (too few or
   * degenerate points) is refused; a fit that can be made is filed whatever its
   * quality -- a `failed` calibration is a fact about the footage, and it is what
   * makes the suppression rule fire rather than fall back to a stale one.
   */
  async calibrate(cameraSegmentId: string, input: { points: CalibrationPointInput[]; pitch?: PitchDimensions; keyframe?: boolean }, actor?: AdminAuthContext) {
    const person = requirePerson(actor, "calibrate a camera segment");
    const segment = await this.prisma.visionCameraSegment.findUnique({ where: { id: cameraSegmentId }, select: { id: true, videoAssetId: true, startMs: true, endMs: true } });
    if (!segment) throw notFound("camera segment", cameraSegmentId);
    const frameIndex = input.keyframe ? await this.keyframeFrame(segment, input.points) : null;
    const pitch = input.pitch ?? DEFAULT_PITCH;
    const result = this.preview(input.points, pitch);
    if (!result.ok) {
      throw new ConflictException({
        statusCode: 409,
        error: "CalibrationDegenerate",
        message: `No homography can be made from these points: ${result.reason}${result.detail ? ` (${result.detail})` : ""}.`,
        remediation: "At least four landmarks, no three on one line, each clicked once, each a landmark of the pitch.",
      });
    }
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.visionPitchCalibration.create({
        data: {
          cameraSegmentId: segment.id,
          pitchLengthM: pitch.lengthM,
          pitchWidthM: pitch.widthM,
          method: "manual",
          points: input.points as unknown as Prisma.InputJsonValue,
          homography: result.homography as unknown as Prisma.InputJsonValue,
          reprojectionErrorM: result.reprojectionErrorM,
          maxPointErrorM: result.maxPointErrorM,
          reprojectionErrorPx: result.reprojectionErrorPx,
          pointsUsed: result.points,
          quality: result.quality,
          thresholdsVersion: result.thresholdsVersion,
          decidedBy: person.userId,
          frameIndex,
        },
      });
      // A whole-segment calibration replaces everything current on the segment, keyframes
      // included: the camera is declared still. A keyframe replaces the whole-segment one
      // and an earlier keyframe on the same frame, and nothing else.
      await tx.visionPitchCalibration.updateMany({
        where: { cameraSegmentId: segment.id, supersededBy: null, withdrawnAt: null, id: { not: created.id },
          ...(frameIndex === null ? {} : { OR: [{ frameIndex: null }, { frameIndex }] }) },
        data: { supersededBy: created.id },
      });
      return created;
    });
    await this.audit.record(
      {
        action: "calibration.set",
        targetKind: "vision_camera_segment",
        targetId: segment.id,
        data: { calibrationId: row.id, videoAssetId: segment.videoAssetId, quality: row.quality, reprojectionErrorM: row.reprojectionErrorM, points: row.pointsUsed, thresholdsVersion: row.thresholdsVersion, frameIndex },
      },
      actor
    );
    return summarise(row);
  }

  // ── Game state ───────────────────────────────────────────────────────────

  /**
   * The asset's latest succeeded gamestate job: its coverage, its index, and a
   * presigned URL per chunk. The chunks are Parquet in object storage and the
   * control plane does not read them (docs/vision/01: the review UI fetches
   * Parquet directly); it hands out the URLs and the index.
   */
  async gameState(videoAssetId: string) {
    const asset = await this.prisma.visionVideoAsset.findUnique({ where: { id: videoAssetId }, select: { id: true } });
    if (!asset) throw notFound("video asset", videoAssetId);
    const job = await this.prisma.visionJob.findFirst({
      where: { videoAssetId, type: "gamestate", state: "succeeded" },
      orderBy: { finishedAt: "desc" },
      select: { id: true, finishedAt: true, progress: true, inputSpec: true },
    });
    if (!job) return { videoAssetId, job: null, coverage: null, chunks: [], index: null };
    const progress = (job.progress ?? {}) as { artifacts?: { key: string; role: string; bytes?: number }[]; summary?: Record<string, unknown> };
    const summary = progress.summary ?? {};
    const index = progress.artifacts?.find((a) => a.role === "gamestate") ?? null;
    const ttl = this.config.playback.urlTtlSeconds;
    const spec = (job.inputSpec ?? {}) as { segments?: { quality: string | null; pitch: { lengthM: number; widthM: number } | null }[]; anchors?: unknown[] };
    const segments = Array.isArray(spec.segments) ? spec.segments : [];
    const chunkMs = typeof summary.chunkMs === "number" && summary.chunkMs > 0 ? summary.chunkMs : null;
    // A chunk's range is in its name (`chunk-00004` is the fifth chunkMs of source time); the
    // job's artifact list carries keys and sizes, not the index's ranges, and the browser
    // must pick a chunk for the playhead without fetching the index first.
    const rangeOf = (key: string) => {
      const m = key.match(/chunk-(\d+)\.parquet$/);
      if (!m || chunkMs === null) return { index: null, fromMs: null, toMs: null };
      const index = Number(m[1]);
      return { index, fromMs: index * chunkMs, toMs: (index + 1) * chunkMs };
    };
    const chunks = await Promise.all(
      (progress.artifacts ?? [])
        .filter((a) => a.role === "gamestate_chunk")
        .map(async (a) => ({ key: a.key, bytes: a.bytes ?? null, ...rangeOf(a.key), url: await this.store.presignGet("derived", a.key, ttl) }))
    );
    return {
      videoAssetId,
      job: { id: job.id, finishedAt: job.finishedAt },
      trackJobId: typeof summary.trackJobId === "string" ? summary.trackJobId : null,
      pitch: segments.find((s) => s.quality && s.pitch)?.pitch ?? null,
      coverage: {
        rows: summary.rows ?? null,
        frames: summary.frames ?? null,
        placed: summary.placed ?? null,
        suppressed: summary.suppressed ?? null,
        reasons: summary.reasons ?? {},
        validFrameCoverage: summary.validFrameCoverage ?? null,
        // What that share is of: the frames the tracker was given, or (older runs) only those with a track.
        framesTracked: summary.framesTracked ?? null,
        coverageBasis: summary.coverageBasis ?? "frames_with_tracks",
        chunkMs,
      },
      placedWith: { segments: segments.length, calibrations: segments.filter((s) => s.quality).length, anchors: Array.isArray(spec.anchors) ? spec.anchors.length : 0 },
      index: index ? { key: index.key, url: await this.store.presignGet("derived", index.key, ttl) } : null,
      chunks,
      expiresInSeconds: ttl,
    };
  }

  // ── Derived coordinates, under the suppression rule ──────────────────────

  /**
   * A track's positions in metres on the pitch, from its foot point (the bottom
   * centre of each box) through the calibration of the segment covering that
   * moment. A position under no segment, a segment with no calibration, or a
   * calibration that `failed` is not placed, and says why. The distance covered
   * is reported only when every position was placed; otherwise it is suppressed
   * and labelled, never a number with a footnote.
   */
  /**
   * The proxy frame a keyframe is true of. Every point must have been clicked on that
   * one frame, and the frame must lie inside the segment, half-open as the pipeline
   * reads it: a keyframe is a fact about one picture, and a fit mixing two pictures
   * of a moving camera describes neither.
   */
  private async keyframeFrame(segment: { videoAssetId: string; startMs: number; endMs: number }, points: CalibrationPointInput[]): Promise<number> {
    const frames = new Set(points.map((p) => p.frameIndex));
    const frame = points[0]?.frameIndex;
    if (frames.size !== 1 || typeof frame !== "number" || !Number.isSafeInteger(frame) || frame < 0) {
      throw new BadRequestException({ statusCode: 400, error: "KeyframePointsSpanFrames", message: "A keyframe's landmarks must all be placed on one frame.",
        remediation: "Clear the points, pause on one frame, and place every landmark on it." });
    }
    const proxy = await this.prisma.visionVideoVariant.findFirst({ where: { videoAssetId: segment.videoAssetId, kind: "proxy" }, orderBy: { createdAt: "desc" }, select: { fps: true, sourceOffsetMs: true } });
    if (!proxy?.fps || proxy.fps <= 0) {
      throw new ConflictException({ statusCode: 409, error: "ProxyWithoutFps", message: "The proxy has no recorded frame rate, so a frame cannot be placed in time.", remediation: "Run transcode for the asset again." });
    }
    const sourceMs = (proxy.sourceOffsetMs ?? 0) + Math.round((frame * 1000) / proxy.fps);
    if (sourceMs < segment.startMs || sourceMs >= segment.endMs) {
      throw new ConflictException({ statusCode: 409, error: "KeyframeOutsideSegment", message: `Frame ${frame} is at ${sourceMs} ms, outside the segment ${segment.startMs}–${segment.endMs} ms.`,
        remediation: "File the keyframe on the segment the frame belongs to." });
    }
    return frame;
  }

  /**
   * One frame's calibration as the latest `calibrate` run carried it, with the pitch
   * lines it puts on the picture: how a person sees a keyframe hold, or drift, away
   * from the frame it was made on. `stale` when the run's pinned calibrations, segments
   * or proxy are no longer the current ones; the row is still shown, marked.
   */
  async carriedAt(videoAssetId: string, frame: number) {
    if (!Number.isSafeInteger(frame) || frame < 0)
      throw new BadRequestException({ statusCode: 400, error: "FrameInvalid", message: `Frame ${frame} is not a frame number.`, remediation: "Ask for a whole, non-negative proxy frame." });
    const job = await this.prisma.visionJob.findFirst({ where: { videoAssetId, type: "calibrate", state: "succeeded" }, orderBy: { finishedAt: "desc" } });
    if (!job) return { videoAssetId, frame, run: null, row: null, overlay: [] };
    const progress = job.progress as { summary?: Record<string, unknown>; artifacts?: { key: string; role: string; bucket: string }[] } | null;
    const indexKey = progress?.artifacts?.find((a) => a.role === "calibration_frames" && a.bucket === "derived")?.key;
    const run = { jobId: job.id, finishedAt: job.finishedAt, stale: await carriedRunStale(this.prisma, videoAssetId, job.inputSpec as Record<string, unknown> | null),
      frames: progress?.summary?.frames ?? null, covered: progress?.summary?.covered ?? null, coverage: progress?.summary?.coverage ?? null };
    const index = indexKey ? await this.store.getSmallObject("derived", indexKey, 4_000_000) : null;
    const chunks = index ? ((JSON.parse(index.toString("utf8")) as { chunks?: { key: string; firstFrame: number; lastFrame: number }[] }).chunks ?? []) : [];
    const chunk = chunks.find((c) => c.firstFrame <= frame && frame <= c.lastFrame);
    if (!chunk) return { videoAssetId, frame, run, row: null, overlay: [] };
    const body = await this.store.getSmallObject("derived", chunk.key, 64_000_000);
    const row = body ? body.toString("utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as CarriedRow).find((r) => r.f === frame) ?? null : null;
    if (!row?.H) return { videoAssetId, frame, run, row, overlay: [] };
    const pitch = this.pinnedPitch(job.inputSpec as Record<string, unknown> | null, row.calibrationId) ?? DEFAULT_PITCH;
    const back = invert3(row.H as Homography);
    const centre = projectInView(row.H as Homography, { x: 640, y: 360 });
    return { videoAssetId, frame, run, row, pitch, overlay: back ? overlayFor(back, pitch, centre ?? { x: pitch.lengthM / 2, y: pitch.widthM / 2 }) : [] };
  }

  /** The pitch size the run carried with a calibration, as the person filed it. */
  private pinnedPitch(spec: Record<string, unknown> | null, calibrationId: string | null): PitchDimensions | null {
    const segments = Array.isArray(spec?.segments) ? (spec!.segments as { calibrations?: { calibrationId?: string; pitch?: PitchDimensions }[] }[]) : [];
    const pinned = segments.flatMap((s) => s.calibrations ?? []).find((c) => c.calibrationId === calibrationId);
    return pinned?.pitch ?? null;
  }

  /** A person takes a keyframe back: nothing replaces it, and the frames it reached lose it. */
  async withdrawKeyframe(calibrationId: string, actor?: AdminAuthContext) {
    const person = requirePerson(actor, "withdraw a keyframe");
    const row = await this.prisma.visionPitchCalibration.findUnique({ where: { id: calibrationId }, select: { id: true, cameraSegmentId: true, frameIndex: true, supersededBy: true, withdrawnAt: true } });
    if (!row) throw notFound("calibration", calibrationId);
    if (row.frameIndex === null) {
      throw new ConflictException({ statusCode: 409, error: "NotAKeyframe", message: "This calibration holds for its whole segment; only a keyframe is withdrawn.", remediation: "File a new calibration to replace it." });
    }
    if (row.supersededBy !== null || row.withdrawnAt !== null) {
      throw new ConflictException({ statusCode: 409, error: "KeyframeNotCurrent", message: "This keyframe has already been replaced or withdrawn.", remediation: "Reload the segment and act on its current keyframes." });
    }
    const withdrawn = await this.prisma.visionPitchCalibration.update({ where: { id: row.id }, data: { withdrawnAt: new Date(), withdrawnBy: person.userId } });
    await this.audit.record({ action: "calibration.withdrawn", targetKind: "vision_camera_segment", targetId: row.cameraSegmentId, data: { calibrationId: row.id, frameIndex: row.frameIndex } }, actor);
    return { withdrawn: withdrawn.id };
  }

  async pitchPositions(trackId: string) {
    const track = await this.prisma.visionTrack.findUnique({ where: { id: trackId }, select: { id: true, videoAssetId: true } });
    if (!track) throw notFound("track", trackId);
    const [{ positions }, segments] = await Promise.all([
      this.identity.positions(trackId),
      this.prisma.visionCameraSegment.findMany({
        where: { videoAssetId: track.videoAssetId },
        orderBy: { startMs: "asc" },
        include: { calibrations: { where: { supersededBy: null, withdrawnAt: null }, orderBy: { createdAt: "desc" } } },
      }),
    ]);

    /* A keyframed segment is placed frame by frame from the current calibrate run (docs/vision/94):
       read once, for this track's frames only. With no current run its positions are not carried. */
    const keyframed = new Set(segments.filter((s) => s.calibrations.some((c) => c.frameIndex != null)).map((s) => s.id));
    const proxy = keyframed.size ? await this.prisma.visionVideoVariant.findFirst({ where: { videoAssetId: track.videoAssetId, kind: "proxy" }, orderBy: { createdAt: "desc" }, select: { fps: true, sourceOffsetMs: true } }) : null;
    const frameOf = (t: number) => (proxy?.fps ? Math.round(((t - (proxy.sourceOffsetMs ?? 0)) * proxy.fps) / 1000) : -1);
    const run = keyframed.size ? await currentCarriedRun(this.prisma, track.videoAssetId) : null;
    const carriedFrames = run && proxy?.fps
      ? await readCarriedFrames(this.store, run, keyframed, new Set((positions as { sourceTimeMs?: unknown }[]).filter((p) => typeof p.sourceTimeMs === "number").map((p) => frameOf(p.sourceTimeMs as number))))
      : new Map<number, { segmentId: string; H: number[] }>();

    const placed: { frameIndex: number; sourceTimeMs: number; xM: number; yM: number; cameraSegmentId: string }[] = [];
    const suppressed: Record<string, number> = {};
    const fail = (reason: string) => {
      suppressed[reason] = (suppressed[reason] ?? 0) + 1;
    };
    let pitch: PitchDimensions | null = null;

    for (const raw of positions as { frameIndex?: unknown; sourceTimeMs?: unknown; box?: { x?: unknown; y?: unknown; width?: unknown; height?: unknown } }[]) {
      const t = typeof raw.sourceTimeMs === "number" ? raw.sourceTimeMs : null;
      const frameIndex = typeof raw.frameIndex === "number" ? raw.frameIndex : null;
      const box = raw.box;
      if (t === null || frameIndex === null || !box || typeof box.x !== "number" || typeof box.y !== "number" || typeof box.width !== "number" || typeof box.height !== "number") {
        fail("position_malformed");
        continue;
      }
      // Half-open, as the worker reads them: the millisecond a segment ends on is the next one's.
      // Segments are in start order; where two overlap, the one that started latest covers.
      const segment = segments.filter((s) => s.startMs <= t && t < s.endMs).at(-1);
      if (!segment) {
        fail("no_camera_segment");
        continue;
      }
      let homography: Homography;
      let size: PitchDimensions;
      if (keyframed.has(segment.id)) {
        const carried = carriedFrames.get(frameOf(t));
        if (!carried || carried.segmentId !== segment.id) {
          fail("calibration_not_carried");
          continue;
        }
        homography = carried.H as Homography;
        size = carriedSegment(segment.calibrations.filter((c) => c.frameIndex != null)).pitch;
      } else {
        const calibration = segment.calibrations.find((c) => c.frameIndex == null);
        if (!calibration) {
          fail("segment_not_calibrated");
          continue;
        }
        if (calibration.quality === "failed") {
          fail("calibration_failed");
          continue;
        }
        homography = orientStored(calibration.homography, calibration.points);
        size = { lengthM: calibration.pitchLengthM, widthM: calibration.pitchWidthM };
      }
      const point = projectInView(homography, { x: box.x + box.width / 2, y: box.y + box.height });
      if (!point) {
        fail("beyond_horizon");
        continue;
      }
      // A pixel just under the horizon maps to hundreds of metres. That is a number, not a position.
      if (
        point.x < -OFF_PITCH_MARGIN_M ||
        point.x > size.lengthM + OFF_PITCH_MARGIN_M ||
        point.y < -OFF_PITCH_MARGIN_M ||
        point.y > size.widthM + OFF_PITCH_MARGIN_M
      ) {
        fail("off_pitch");
        continue;
      }
      pitch = pitch ?? size;
      placed.push({ frameIndex, sourceTimeMs: t, xM: round(point.x), yM: round(point.y), cameraSegmentId: segment.id });
    }

    const total = positions.length;
    const suppressedCount = total - placed.length;
    let distanceM: number | null = null;
    if (total > 0 && suppressedCount === 0) {
      let d = 0;
      for (let i = 1; i < placed.length; i += 1) d += Math.hypot(placed[i]!.xM - placed[i - 1]!.xM, placed[i]!.yM - placed[i - 1]!.yM);
      distanceM = round(d);
    }
    return {
      trackId,
      pitch,
      positions: placed,
      summary: {
        positions: total,
        placed: placed.length,
        suppressed: suppressedCount,
        reasons: suppressed,
      },
      distance:
        distanceM === null
          ? { suppressed: true as const, reason: total === 0 ? "no positions" : `calibration insufficient for ${suppressedCount} of ${total} position(s): ${Object.keys(suppressed).join(", ")}` }
          : { suppressed: false as const, metres: distanceM },
      thresholdsVersion: this.thresholds.version,
    };
  }
}

/**
 * The pitch's markings through the inverse homography, in proxy pixels. A vertex
 * beyond the horizon -- on the other side of it from a landmark known to be in
 * view, which a projective map would mirror to a finite pixel that means nothing
 * -- or absurdly far outside the picture breaks the polyline, so the far
 * touchline of a low camera does not become a line across the sky.
 */
/** A frame row of a calibrate run, as the stage wrote it. */
type CarriedRow = { f: number; ms: number; cameraSegmentId: string | null; H: number[] | null; calibrationId: string | null; quality: string | null; keyframe: number | null; framesFromKeyframe: number | null; reason: string | null };

function overlayFor(pitchToPixel: Homography, pitch: PitchDimensions, inView: { x: number; y: number }): Overlay {
  const LIMIT = 20_000;
  const side = Math.sign(homogeneousW(pitchToPixel, inView)) || 1;
  const out: Overlay = [];
  for (const line of pitchLines(pitch)) {
    let run: { px: number; py: number }[] = [];
    const flush = () => {
      if (run.length >= 2) out.push({ id: line.id, points: run });
      run = [];
    };
    for (const v of line.points) {
      const p = project(pitchToPixel, { x: v.xM, y: v.yM });
      const beyond = Math.sign(homogeneousW(pitchToPixel, { x: v.xM, y: v.yM })) !== side;
      if (!p || beyond || Math.abs(p.x) > LIMIT || Math.abs(p.y) > LIMIT) {
        flush();
        continue;
      }
      run.push({ px: round(p.x), py: round(p.y) });
    }
    flush();
  }
  return out;
}

function describeFit(fit: Fit, thresholds: CalibrationThresholds) {
  return {
    homography: fit.homography,
    reprojectionErrorM: fit.rmseM,
    maxPointErrorM: fit.maxErrorM,
    reprojectionErrorPx: fit.rmsePx,
    points: fit.points,
    pointsAcrossHorizon: fit.acrossHorizon,
    quality: qualityOf(fit, thresholds),
    thresholdsVersion: thresholds.version,
  };
}

function summarise(row: {
  id: string;
  cameraSegmentId: string;
  pitchLengthM: number;
  pitchWidthM: number;
  method: string;
  modelVersionId: string | null;
  points: unknown;
  homography: unknown;
  reprojectionErrorM: number;
  maxPointErrorM: number;
  reprojectionErrorPx: number;
  pointsUsed: number;
  quality: string;
  thresholdsVersion: string;
  decidedBy: string | null;
  supersededBy: string | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    cameraSegmentId: row.cameraSegmentId,
    pitch: { lengthM: row.pitchLengthM, widthM: row.pitchWidthM },
    method: row.method,
    modelVersionId: row.modelVersionId,
    homography: row.homography as Homography,
    reprojectionErrorM: row.reprojectionErrorM,
    maxPointErrorM: row.maxPointErrorM,
    reprojectionErrorPx: row.reprojectionErrorPx,
    points: row.pointsUsed,
    clicked: Array.isArray(row.points) ? (row.points as CalibrationPointInput[]) : [],
    quality: row.quality as CalibrationQuality,
    thresholdsVersion: row.thresholdsVersion,
    decidedBy: row.decidedBy,
    supersededBy: row.supersededBy,
    createdAt: row.createdAt,
  };
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

/** The shared check (`shared/refusals.ts`), with this service's error and its reason. */
const requirePerson = personFor(
  "CalibrationNeedsAPerson",
  "A calibration is a judgement about the footage with a name on it; the shared operator key has none."
);
