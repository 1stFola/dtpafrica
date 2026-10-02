import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { AdminAuthContext } from "../../admin/auth/admin-auth.types";
import { PrismaService } from "../../prisma/prisma.service";
import { VisionAuditService } from "../audit/vision-audit.service";
import { VisionIdentityService } from "../identity/identity.service";
import { CALIBRATION_THRESHOLDS, qualityOf, type CalibrationQuality, type CalibrationThresholds } from "./calibration-thresholds";
import { fitHomography, isFit, project, type Correspondence, type Fit, type FitFailure, type Homography } from "./homography";
import { DEFAULT_PITCH, landmarkById, pitchProblem, type PitchDimensions } from "./pitch-model";

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

export type PreviewResult =
  | { ok: true; pitch: PitchDimensions; homography: Homography; reprojectionErrorM: number; maxPointErrorM: number; reprojectionErrorPx: number; points: number; quality: CalibrationQuality; thresholdsVersion: string }
  | { ok: false; pitch: PitchDimensions; reason: FitFailure["reason"] | "unknown_landmark"; detail?: string };

@Injectable()
export class VisionCalibrationService {
  private readonly thresholds: CalibrationThresholds = CALIBRATION_THRESHOLDS;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(VisionAuditService) private readonly audit: VisionAuditService,
    @Inject(VisionIdentityService) private readonly identity: VisionIdentityService
  ) {}

  // ── Segments ─────────────────────────────────────────────────────────────

  /**
   * A camera segment of an asset, in source milliseconds, declared by a person.
   * Segments of one asset do not overlap: a moment has one camera.
   */
  async declareSegment(videoAssetId: string, input: { startMs: number; endMs: number; kind: string }, actor?: AdminAuthContext) {
    const person = requirePerson(actor, "declare a camera segment");
    const asset = await this.prisma.visionVideoAsset.findUnique({ where: { id: videoAssetId }, select: { id: true, durationMs: true } });
    if (!asset) throw new NotFoundException(`Unknown video asset ${videoAssetId}`);
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
    if (!segment) throw new NotFoundException(`Unknown camera segment ${cameraSegmentId}`);
    if (segment._count.calibrations > 0) {
      throw new ConflictException({
        statusCode: 409,
        error: "SegmentCalibrated",
        message: `Segment ${cameraSegmentId} has ${segment._count.calibrations} calibration(s) on it.`,
        remediation: "A calibrated segment is a fact with a name on it. Supersede the calibration instead.",
      });
    }
    await this.prisma.visionCameraSegment.delete({ where: { id: segment.id } });
    await this.audit.record({ action: "camera.segment.removed", targetKind: "vision_camera_segment", targetId: segment.id, data: { videoAssetId: segment.videoAssetId, source: segment.source, startMs: segment.startMs, endMs: segment.endMs } }, actor);
    return { removed: segment.id };
  }

  /** The asset's segments with each one's current calibration, as a reviewer reads them. */
  async segments(videoAssetId: string) {
    const asset = await this.prisma.visionVideoAsset.findUnique({ where: { id: videoAssetId }, select: { id: true, durationMs: true } });
    if (!asset) throw new NotFoundException(`Unknown video asset ${videoAssetId}`);
    const segments = await this.prisma.visionCameraSegment.findMany({
      where: { videoAssetId },
      orderBy: { startMs: "asc" },
      include: { calibrations: { orderBy: { createdAt: "desc" } } },
    });
    const rows = segments.map((s) => {
      const current = s.calibrations.find((c) => c.supersededBy === null) ?? null;
      return {
        id: s.id,
        kind: s.kind,
        source: s.source,
        startMs: s.startMs,
        endMs: s.endMs,
        calibration: current ? summarise(current) : null,
        superseded: s.calibrations.filter((c) => c.supersededBy !== null).length,
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
      },
      thresholds: this.thresholds,
    };
  }

  // ── Calibration ──────────────────────────────────────────────────────────

  /** The fit and its quality, saved nowhere: the editor's live readout. */
  preview(points: CalibrationPointInput[], pitch: PitchDimensions = DEFAULT_PITCH): PreviewResult {
    const problem = pitchProblem(pitch);
    if (problem) throw new BadRequestException({ statusCode: 400, error: "PitchDimensionsInvalid", message: problem });
    const by = landmarkById(pitch);
    const pairs: Correspondence[] = [];
    for (const p of points) {
      const l = by.get(p.landmark);
      if (!l) return { ok: false, pitch, reason: "unknown_landmark", detail: p.landmark };
      pairs.push({ px: p.px, py: p.py, xM: l.xM, yM: l.yM });
    }
    const fit = fitHomography(pairs);
    if (!isFit(fit)) return { ok: false, pitch, reason: fit.reason };
    return { ok: true, pitch, ...describeFit(fit, this.thresholds) };
  }

  /**
   * A person's calibration of a segment. A fit that cannot be made (too few or
   * degenerate points) is refused; a fit that can be made is filed whatever its
   * quality -- a `failed` calibration is a fact about the footage, and it is what
   * makes the suppression rule fire rather than fall back to a stale one.
   */
  async calibrate(cameraSegmentId: string, input: { points: CalibrationPointInput[]; pitch?: PitchDimensions }, actor?: AdminAuthContext) {
    const person = requirePerson(actor, "calibrate a camera segment");
    const segment = await this.prisma.visionCameraSegment.findUnique({ where: { id: cameraSegmentId }, select: { id: true, videoAssetId: true } });
    if (!segment) throw new NotFoundException(`Unknown camera segment ${cameraSegmentId}`);
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
        },
      });
      await tx.visionPitchCalibration.updateMany({ where: { cameraSegmentId: segment.id, supersededBy: null, id: { not: created.id } }, data: { supersededBy: created.id } });
      return created;
    });
    await this.audit.record(
      {
        action: "calibration.set",
        targetKind: "vision_camera_segment",
        targetId: segment.id,
        data: { calibrationId: row.id, videoAssetId: segment.videoAssetId, quality: row.quality, reprojectionErrorM: row.reprojectionErrorM, points: row.pointsUsed, thresholdsVersion: row.thresholdsVersion },
      },
      actor
    );
    return summarise(row);
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
  async pitchPositions(trackId: string) {
    const track = await this.prisma.visionTrack.findUnique({ where: { id: trackId }, select: { id: true, videoAssetId: true } });
    if (!track) throw new NotFoundException(`Unknown track ${trackId}`);
    const [{ positions }, segments] = await Promise.all([
      this.identity.positions(trackId),
      this.prisma.visionCameraSegment.findMany({
        where: { videoAssetId: track.videoAssetId },
        orderBy: { startMs: "asc" },
        include: { calibrations: { where: { supersededBy: null }, take: 1 } },
      }),
    ]);

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
      const segment = segments.find((s) => s.startMs <= t && t <= s.endMs);
      if (!segment) {
        fail("no_camera_segment");
        continue;
      }
      const calibration = segment.calibrations[0];
      if (!calibration) {
        fail("segment_not_calibrated");
        continue;
      }
      if (calibration.quality === "failed") {
        fail("calibration_failed");
        continue;
      }
      const point = project(calibration.homography as Homography, { x: box.x + box.width / 2, y: box.y + box.height });
      if (!point) {
        fail("beyond_horizon");
        continue;
      }
      pitch = pitch ?? { lengthM: calibration.pitchLengthM, widthM: calibration.pitchWidthM };
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

function describeFit(fit: Fit, thresholds: CalibrationThresholds) {
  return {
    homography: fit.homography,
    reprojectionErrorM: fit.rmseM,
    maxPointErrorM: fit.maxErrorM,
    reprojectionErrorPx: fit.rmsePx,
    points: fit.points,
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

function requirePerson(actor: AdminAuthContext | undefined, what: string): { userId: string } {
  if (!actor?.userId) {
    throw new ForbiddenException({
      statusCode: 403,
      error: "CalibrationNeedsAPerson",
      message: `Only a signed-in person may ${what}.`,
      detail: "A calibration is a judgement about the footage with a name on it; the shared operator key has none.",
      remediation: "Sign in as yourself.",
    });
  }
  return { userId: actor.userId };
}
