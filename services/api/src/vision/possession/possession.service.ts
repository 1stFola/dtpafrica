import { HttpException, Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AdminAuthContext } from "../../admin/auth/admin-auth.types";
import { PrismaService } from "../../prisma/prisma.service";
import { VisionAuditService } from "../audit/vision-audit.service";
import { RightsPolicyService } from "../rights/rights-policy.service";
import { OBJECT_STORE, type ObjectStore } from "../storage/object-store";
import { notFound, personFor, refusal } from "../shared/refusals";
import { bad, frameMs, object, readPossessionEvidence, sameEvidence } from "./possession-evidence";
import { possessionCalibration } from "./possession-calibration";

const person = personFor("PossessionNeedsAPerson", "Possession review must name an individual reviewer.");
const fix = "Refresh the possession review page and choose a current, unreviewed interval.";
const runSelect = { id: true, inferenceJobId: true, attemptNumber: true, createdBy: true, createdAt: true, windowStartMs: true, windowEndMs: true, calculationVersion: true, indexChecksum: true } as const;
type SegmentWithRun = Prisma.VisionPossessionSegmentGetPayload<{ include: { run: true } }>;

@Injectable()
export class VisionPossessionService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    @Inject(RightsPolicyService) private readonly rights: RightsPolicyService,
    @Inject(VisionAuditService) private readonly audit: VisionAuditService) {}

  private async allowed(videoAssetId: string) {
    const result = await this.rights.canAnalyze({ videoAssetId });
    if (!result.allowed) throw refusal(403, "RightsDenied", "Current analysis rights do not permit possession review.", result.remediation ?? "Review the source's rights.");
  }
  private async asset(id: string) {
    const row = await this.db.visionVideoAsset.findUnique({ where: { id }, select: { id: true, checksumSha256: true, durationMs: true } });
    if (!row) throw notFound("video asset", id);
    return row;
  }
  private async cameras(id: string) {
    return (await this.db.visionCameraSegment.findMany({ where: { videoAssetId: id }, orderBy: { startMs: "asc" }, select: { id: true, startMs: true, endMs: true, kind: true } }))
      .map((s) => ({ cameraSegmentId: s.id, startMs: s.startMs, endMs: s.endMs, kind: s.kind }));
  }
  private async calibrationCurrent(run: { videoAssetId: string; snapshot: unknown }) {
    const index = object(object(run.snapshot).index);
    if (index.constraintMode !== "calibrated") return true;
    try { return sameEvidence(index.calibrationSnapshot, await possessionCalibration(this.db, run.videoAssetId)); }
    catch (e) { if (e instanceof HttpException && e.getStatus() === 409) return false; throw e; }
  }

  async forAsset(videoAssetId: string) {
    await this.asset(videoAssetId); await this.allowed(videoAssetId);
    const [runs, jobs] = await Promise.all([
      this.db.visionPossessionRun.findMany({ where: { videoAssetId }, select: runSelect, orderBy: { createdAt: "desc" }, take: 100 }),
      this.db.visionJob.findMany({ where: { videoAssetId, type: "possession", state: "succeeded" }, select: { id: true, attemptNumber: true, finishedAt: true }, orderBy: { finishedAt: "desc" }, take: 100 }),
    ]);
    return { videoAssetId, runs, jobs };
  }

  async importRun(videoAssetId: string, jobId: unknown, actor?: AdminAuthContext) {
    const me = person(actor, "import possession evidence").userId;
    if (typeof jobId !== "string" || !jobId.trim() || jobId.length > 100) throw refusal(400, "InvalidPossessionJob", "Select a completed possession job.", fix);
    const asset = await this.asset(videoAssetId); await this.allowed(videoAssetId);
    const evidence = await readPossessionEvidence(this.db, this.store, asset, jobId);
    const index = evidence.index;
    if (!sameEvidence(await this.cameras(videoAssetId), index.cameraSegments)) throw bad("Camera declarations changed after the run. Import compatible current evidence.");
    if (!await this.calibrationCurrent({ videoAssetId, snapshot: evidence.snapshot })) throw bad("Calibration or proxy geometry changed after the run.");
    const localIds = [...new Set(evidence.segments.filter((s) => s.state === "candidate").map((s) => s.localTrackId!))];
    const tracks = await this.db.visionTrack.findMany({ where: { videoAssetId, inferenceJobId: String(index.trackJobId), localTrackId: { in: localIds } } });
    const byId = new Map(tracks.map((t) => [t.localTrackId, t]));
    const proxy = object(index.proxy);
    let frames = 0;
    const data = evidence.segments.map((s, ordinal) => {
      const lastObservationMs = Number(proxy.sourceOffsetMs) + frameMs(frames + s.frames - 1, Number(proxy.fps)); frames += s.frames;
      const track = s.localTrackId === null ? null : byId.get(s.localTrackId);
      if (s.state === "candidate" && (!track || !track.confirmed || !["player", "goalkeeper"].includes(track.class) || track.videoAssetId !== videoAssetId
        || track.inferenceJobId !== index.trackJobId)) throw bad("A possession candidate does not resolve to the declared confirmed player tracking run.");
      const declared = object(object(evidence.job.inputSpec).tracks);
      if (track && (track.artifactKey !== declared.key || track.trackerVersionId !== index.trackerVersionId || track.detectorVersionId !== index.detectorVersionId || track.startMs > s.startMs || track.endMs < lastObservationMs)) throw bad("Candidate track provenance or observed time range differs from the declared player evidence.");
      return { ordinal, startMs: s.startMs, endMs: s.endMs, frames: s.frames, sourceState: s.state, reason: s.reason,
        cameraSegmentId: s.cameraSegmentId, trajectoryId: s.trajectoryId, localTrackId: s.localTrackId, actorTrackId: track?.id ?? null, evidenceConfidence: s.evidenceConfidence };
    });
    const unique = { inferenceJobId_attemptNumber: { inferenceJobId: jobId, attemptNumber: evidence.job.attemptNumber } };
    try {
      const result = await this.db.$transaction(async (tx) => {
        const existing = await tx.visionPossessionRun.findUnique({ where: unique });
        if (existing) {
          if (existing.indexChecksum !== evidence.indexChecksum || existing.videoAssetId !== videoAssetId) throw bad("An imported attempt cannot be replaced with different evidence.");
          return { id: existing.id, imported: false };
        }
        await this.allowed(videoAssetId);
        const currentAsset = await tx.visionVideoAsset.findUnique({ where: { id: videoAssetId } });
        if (currentAsset?.checksumSha256 !== asset.checksumSha256 || currentAsset.durationMs !== asset.durationMs || !sameEvidence(await this.cameras(videoAssetId), index.cameraSegments) || !await this.calibrationCurrent({ videoAssetId, snapshot: evidence.snapshot })) throw bad("Source, camera or calibration evidence changed while the import was being prepared.");
        const run = await tx.visionPossessionRun.create({ data: { videoAssetId, inferenceJobId: jobId, attemptNumber: evidence.job.attemptNumber,
          indexKey: evidence.indexKey, indexChecksum: evidence.indexChecksum, sourceChecksum: asset.checksumSha256,
          windowStartMs: Number(index.windowStartMs), windowEndMs: Number(index.windowEndMs), trackJobId: String(index.trackJobId), calculationVersion: String(index.calculationVersion),
          snapshot: evidence.snapshot as Prisma.InputJsonValue, createdBy: me } });
        await tx.visionPossessionSegment.createMany({ data: data.map((row) => ({ ...row, runId: run.id })) });
        return { id: run.id, imported: true };
      });
      if (result.imported) await this.audit.record({ action: "possession.imported", targetKind: "possession_run", targetId: result.id, data: { jobId, attemptNumber: evidence.job.attemptNumber, indexChecksum: evidence.indexChecksum, segments: data.length } }, actor);
      return result;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await this.db.visionPossessionRun.findUnique({ where: unique });
        if (existing?.indexChecksum === evidence.indexChecksum && existing.videoAssetId === videoAssetId) return { id: existing.id, imported: false };
      }
      throw error;
    }
  }

  async get(runId: string, startOrdinal = 0) {
    if (!Number.isSafeInteger(startOrdinal) || startOrdinal < 0) throw refusal(400, "InvalidPossessionCursor", "The segment cursor must be a nonnegative integer.", fix);
    const run = await this.db.visionPossessionRun.findUnique({ where: { id: runId } });
    if (!run) throw notFound("possession run", runId);
    await this.allowed(run.videoAssetId);
    const asset = await this.asset(run.videoAssetId), index = object(object(run.snapshot).index);
    const stale = asset.checksumSha256 !== run.sourceChecksum || asset.durationMs !== object(run.snapshot).sourceDurationMs
      || !sameEvidence(await this.cameras(run.videoAssetId), index.cameraSegments) || !await this.calibrationCurrent(run);
    const segments = await this.db.visionPossessionSegment.findMany({ where: { runId, ordinal: { gte: startOrdinal } }, include: { decision: true,
      corrections: { orderBy: { version: "desc" }, take: 20, include: { decision: true } } }, orderBy: { ordinal: "asc" }, take: 101 });
    const nextCursor = segments.length > 100 ? segments.pop()!.ordinal : null;
    return { ...run, stale, segments, nextCursor, totalSegments: Number(index.segments), candidateFrames: Number(index.candidateFrames), unknownFrames: Number(index.unknownFrames) };
  }

  private async current(segment: SegmentWithRun) {
    const run = segment.run;
    await this.allowed(run.videoAssetId);
    const asset = await this.asset(run.videoAssetId), index = object(object(run.snapshot).index);
    if (asset.checksumSha256 !== run.sourceChecksum || asset.durationMs !== object(run.snapshot).sourceDurationMs
      || !sameEvidence(await this.cameras(run.videoAssetId), index.cameraSegments) || !await this.calibrationCurrent(run))
      throw refusal(409, "PossessionEvidenceStale", "Source, camera, calibration or proxy geometry changed after import.", "Import a current run; the original ledger remains evidence.");
    return index;
  }

  private async correctionTrack(segment: SegmentWithRun, row: { state: string; actorTrackId: string | null; startMs: number; endMs: number }, db: Prisma.TransactionClient) {
    if (row.state === "unknown") return null;
    // Do not turn a lost/ambiguous ball interval into model-supported possession.
    if (segment.sourceState !== "candidate") throw bad("Unknown evidence can only be trimmed or confirmed as Unknown.");
    const run = segment.run, index = object(object(run.snapshot).index), proxy = object(index.proxy);
    const exactFrame = (row.endMs - Number(proxy.sourceOffsetMs)) * Number(proxy.fps) / 1000;
    const nearest = Math.round(exactFrame);
    const frame = (Number(proxy.sourceOffsetMs) + frameMs(nearest, Number(proxy.fps)) === row.endMs ? nearest : Math.ceil(exactFrame)) - 1;
    const last = Number(proxy.sourceOffsetMs) + frameMs(frame, Number(proxy.fps));
    const track = row.actorTrackId ? await db.visionTrack.findUnique({ where: { id: row.actorTrackId } }) : null;
    if (!track || track.videoAssetId !== run.videoAssetId || track.inferenceJobId !== run.trackJobId || !track.confirmed
      || !["player", "goalkeeper"].includes(track.class) || track.artifactKey !== object(object(object(run.snapshot).input).tracks).key
      || track.trackerVersionId !== index.trackerVersionId || track.detectorVersionId !== index.detectorVersionId
      || track.startMs > row.startMs || track.endMs < last) throw bad("Choose a confirmed player track covering the correction in the original tracking run.");
    return track;
  }

  async correctionTracks(segmentId: string) {
    const segment = await this.db.visionPossessionSegment.findUnique({ where: { id: segmentId }, include: { run: true } });
    if (!segment) throw notFound("possession segment", segmentId);
    await this.current(segment);
    if (segment.sourceState !== "candidate") return { tracks: [] };
    const index = object(object(segment.run.snapshot).index);
    const tracks = await this.db.visionTrack.findMany({ where: { videoAssetId: segment.run.videoAssetId, inferenceJobId: segment.run.trackJobId,
      confirmed: true, class: { in: ["player", "goalkeeper"] }, artifactKey: String(object(object(object(segment.run.snapshot).input).tracks).key),
      trackerVersionId: String(index.trackerVersionId), detectorVersionId: String(index.detectorVersionId),
      startMs: { lt: segment.endMs }, endMs: { gte: segment.startMs } },
      select: { id: true, localTrackId: true, startMs: true, endMs: true }, orderBy: { localTrackId: "asc" }, take: 501 });
    if (tracks.length > 500) throw bad("Too many actor tracks. Use a shorter compatible tracking run.");
    return { tracks };
  }

  async correct(segmentId: string, input: { parentKey?: unknown; startMs?: unknown; endMs?: unknown; state?: unknown; actorTrackId?: unknown; reason?: unknown }, actor?: AdminAuthContext) {
    const me = person(actor, "correct possession evidence").userId;
    if (typeof input.parentKey !== "string" || !input.parentKey || input.parentKey.length > 100
      || !Number.isSafeInteger(input.startMs) || !Number.isSafeInteger(input.endMs) || !["candidate", "unknown"].includes(String(input.state))
      || typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 1000
      || (input.state === "candidate" && (typeof input.actorTrackId !== "string" || !input.actorTrackId || input.actorTrackId.length > 100))
      || (input.state === "unknown" && input.actorTrackId != null))
      throw refusal(400, "InvalidPossessionCorrection", "Supply a current version, integer source bounds, state, compatible actor and a reason.", fix);
    try {
      const correction = await this.db.$transaction(async (tx) => {
        // Serialize proposals/decisions without changing any original evidence row.
        await tx.$queryRaw`SELECT id FROM vision_possession_segments WHERE id = ${segmentId} FOR UPDATE`;
        const segment = await tx.visionPossessionSegment.findUnique({ where: { id: segmentId }, include: { run: true } });
        if (!segment) throw notFound("possession segment", segmentId);
        const index = await this.current(segment);
        const versions = await tx.visionPossessionCorrection.findMany({ where: { segmentId }, orderBy: { version: "desc" }, take: 20, include: { decision: true } });
        const latest = versions[0];
        if (input.parentKey !== (latest?.id ?? segmentId)) throw refusal(409, "PossessionCorrectionChanged", "Another correction is current.", fix);
        if (versions.length >= 20) throw refusal(409, "PossessionCorrectionLimit", "This interval has reached 20 correction versions.", "Import a new compatible run for further review.");
        const startMs = Number(input.startMs), endMs = Number(input.endMs), proxy = object(index.proxy);
        const aligned = (ms: number) => ms === Number(proxy.sourceOffsetMs) + frameMs(Math.round((ms - Number(proxy.sourceOffsetMs)) * Number(proxy.fps) / 1000), Number(proxy.fps));
        if (startMs < segment.startMs || endMs > segment.endMs || endMs <= startMs || !aligned(startMs) || (!aligned(endMs) && endMs !== segment.endMs))
          throw refusal(400, "InvalidPossessionCorrectionBounds", "Trim within the original interval using source frame boundaries.", "Use the original frame rate; trimmed portions remain unresolved Unknown.");
        const data = { segmentId, parentKey: String(input.parentKey), version: (latest?.version ?? 0) + 1, startMs, endMs, state: String(input.state),
          actorTrackId: input.state === "candidate" ? String(input.actorTrackId) : null, reason: String(input.reason).trim(), proposedBy: me };
        const original = latest ?? { ...segment, state: segment.sourceState };
        if (original.startMs === startMs && original.endMs === endMs && original.state === data.state && original.actorTrackId === data.actorTrackId)
          throw refusal(400, "PossessionCorrectionUnchanged", "The correction must change bounds, actor or state.", fix);
        const track = await this.correctionTrack(segment, data, tx);
        return tx.visionPossessionCorrection.create({ data: { ...data, localTrackId: track?.localTrackId ?? null } });
      });
      await this.audit.record({ action: "possession.corrected", targetKind: "possession_correction", targetId: correction.id,
        reason: correction.reason, data: { segmentId, parentKey: correction.parentKey } }, actor);
      return correction;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw refusal(409, "PossessionCorrectionChanged", "Another correction is current.", fix);
      throw e;
    }
  }

  async decideCorrection(correctionId: string, input: { decision?: unknown; reason?: unknown }, actor?: AdminAuthContext) {
    const me = person(actor, "review a possession correction").userId;
    if (!["accepted", "rejected"].includes(String(input.decision)) || (input.reason !== undefined && (typeof input.reason !== "string" || input.reason.length > 1000))
      || (input.decision === "rejected" && !(typeof input.reason === "string" && input.reason.trim())))
      throw refusal(400, "InvalidPossessionDecision", "Accept or reject; a rejection needs a reason of at most 1000 characters.", fix);
    const result = await this.db.$transaction(async (tx) => {
      const initial = await tx.visionPossessionCorrection.findUnique({ where: { id: correctionId } });
      if (!initial) throw notFound("possession correction", correctionId);
      await tx.$queryRaw`SELECT id FROM vision_possession_segments WHERE id = ${initial.segmentId} FOR UPDATE`;
      const row = await tx.visionPossessionCorrection.findUnique({ where: { id: correctionId }, include: { decision: true, segment: { include: { run: true } } } });
      if (!row) throw notFound("possession correction", correctionId);
      await this.current(row.segment);
      if (row.proposedBy === me) throw refusal(403, "PossessionSelfReview", "The correction author cannot review their own correction.", "Ask the other reviewer to decide this correction.");
      if (row.decision) throw refusal(409, "PossessionAlreadyReviewed", "This correction already has an immutable decision.", fix);
      if (await tx.visionPossessionCorrection.findUnique({ where: { parentKey: row.id } })) throw refusal(409, "PossessionCorrectionChanged", "A newer correction supersedes this proposal.", fix);
      await this.correctionTrack(row.segment, row, tx);
      return tx.visionPossessionCorrectionDecision.create({ data: { correctionId, decision: String(input.decision), reason: typeof input.reason === "string" ? input.reason.trim() || null : null, reviewedBy: me } });
    });
    await this.audit.record({ action: input.decision === "accepted" ? "possession.correction.accepted" : "possession.correction.rejected", targetKind: "possession_correction", targetId: correctionId, reason: result.reason }, actor);
    return result;
  }

  async decide(segmentId: string, input: { decision?: unknown; reason?: unknown }, actor?: AdminAuthContext) {
    const me = person(actor, "review possession evidence").userId;
    if (typeof input.decision !== "string" || !["accepted", "rejected"].includes(input.decision) || (input.reason !== undefined && (typeof input.reason !== "string" || input.reason.length > 1000)) || (input.decision === "rejected" && !(typeof input.reason === "string" && input.reason.trim())))
      throw refusal(400, "InvalidPossessionDecision", "Accept or reject; a rejection needs a reason of at most 1000 characters.", fix);
    const segment = await this.db.visionPossessionSegment.findUnique({ where: { id: segmentId }, include: { run: true, decision: true } });
    if (!segment) throw notFound("possession segment", segmentId);
    const run = segment.run;
    await this.allowed(run.videoAssetId);
    if (run.createdBy === me) throw refusal(403, "PossessionSelfReview", "A different reviewer must decide imported possession evidence.", "Ask the other reviewer to review this run.");
    if (segment.decision) throw refusal(409, "PossessionAlreadyReviewed", "This interval already has an immutable decision.", fix);
    const asset = await this.asset(run.videoAssetId), index = object(object(run.snapshot).index);
    if (asset.checksumSha256 !== run.sourceChecksum || asset.durationMs !== object(run.snapshot).sourceDurationMs || !sameEvidence(await this.cameras(run.videoAssetId), index.cameraSegments) || !await this.calibrationCurrent(run)) throw refusal(409, "PossessionEvidenceStale", "Source, camera, calibration or proxy geometry changed after import.", "Import a current run; the original ledger remains evidence.");
    if (segment.sourceState === "candidate") {
      const track = segment.actorTrackId ? await this.db.visionTrack.findUnique({ where: { id: segment.actorTrackId } }) : null;
      const proxy = object(index.proxy), startFrame = Math.round((segment.startMs - Number(proxy.sourceOffsetMs)) * Number(proxy.fps) / 1000);
      const lastObservation = Number(proxy.sourceOffsetMs) + frameMs(startFrame + segment.frames - 1, Number(proxy.fps));
      if (!track || track.inferenceJobId !== run.trackJobId || track.localTrackId !== segment.localTrackId || track.videoAssetId !== run.videoAssetId || !track.confirmed || !["player", "goalkeeper"].includes(track.class)
        || track.artifactKey !== object(object(object(run.snapshot).input).tracks).key || track.trackerVersionId !== index.trackerVersionId || track.detectorVersionId !== index.detectorVersionId || track.startMs > segment.startMs || track.endMs < lastObservation) throw bad("The original candidate's player track is no longer available for review.");
    }
    try {
      const decision = await this.db.visionPossessionDecision.create({ data: { segmentId, decision: String(input.decision), reason: typeof input.reason === "string" ? input.reason.trim() || null : null, reviewedBy: me } });
      await this.audit.record({ action: input.decision === "accepted" ? "possession.accepted" : "possession.rejected", targetKind: "possession_segment", targetId: segmentId,
        reason: decision.reason, data: { runId: run.id, sourceState: segment.sourceState, actorTrackId: segment.actorTrackId } }, actor);
      return decision;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw refusal(409, "PossessionAlreadyReviewed", "Another reviewer already decided this interval.", fix);
      throw e;
    }
  }
}
