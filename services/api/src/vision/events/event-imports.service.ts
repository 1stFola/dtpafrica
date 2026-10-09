import { HttpException, Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { EVENT_CARRY_SCHEMA_VERSION, EVENT_CARRY_VERSION, VISION_EVENT_TAXONOMY_VERSION } from "@dtp/vision-contracts";
import type { AdminAuthContext } from "../../admin/auth/admin-auth.types";
import { PrismaService } from "../../prisma/prisma.service";
import { VisionAuditService } from "../audit/vision-audit.service";
import { readEventRunEvidence } from "../event-gold/event-run-evidence";
import { object, sameEvidence } from "../possession/possession-evidence";
import { possessionCalibration } from "../possession/possession-calibration";
import { RightsPolicyService } from "../rights/rights-policy.service";
import { notFound, personFor, refusal } from "../shared/refusals";
import { OBJECT_STORE, type ObjectStore } from "../storage/object-store";

type Db = Pick<PrismaService, "visionVideoAsset" | "visionVideoVariant" | "visionCameraSegment" | "visionJob" | "visionTrack">;
export type ImportedEventRun = { videoAssetId: string; sourceChecksum: string; snapshot: unknown };
const person = personFor("EventNeedsAPerson", "Importing event evidence must name an individual proposer.");
const stale = () => refusal(409, "EventEvidenceStale", "Source, match, camera, calibration, proxy clock or original tracks changed after this event run.", "Complete and import a compatible new run. Original candidates and manual descendants remain history.");
const trackSelect = { id: true, videoAssetId: true, inferenceJobId: true, localTrackId: true, class: true, confirmed: true, startMs: true, endMs: true, artifactKey: true, trackerVersionId: true, detectorVersionId: true } as const;

@Injectable()
export class VisionEventImportsService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    @Inject(RightsPolicyService) private readonly rights: RightsPolicyService) {}

  private async asset(id: string, db: Db = this.db) {
    const asset = await db.visionVideoAsset.findUnique({ where: { id }, select: { id: true, checksumSha256: true, durationMs: true, sbMatchId: true } });
    if (!asset) throw notFound("video asset", id);
    return asset;
  }
  private async allowed(id: string) {
    const decision = await this.rights.canAnalyze({ videoAssetId: id });
    if (!decision.allowed) throw refusal(403, "RightsDenied", "Current analysis rights do not permit importing or reviewing this event evidence.", decision.remediation ?? "Review source rights.");
  }

  /** Historical artifacts stay immutable; current declarations gate every imported revision. */
  async current(run: ImportedEventRun, db: Db = this.db): Promise<boolean> {
    const snapshot = object(run.snapshot), artifact = object(snapshot.artifact), input = object(snapshot.input), producer = object(artifact.producer);
    const asset = await this.asset(run.videoAssetId, db);
    if (asset.checksumSha256 !== run.sourceChecksum || asset.sbMatchId !== snapshot.sbMatchId || asset.durationMs !== snapshot.sourceDurationMs) return false;
    const rights = await this.rights.canAnalyze({ videoAssetId: run.videoAssetId });
    if (!rights.allowed) return false;
    const cameras = (await db.visionCameraSegment.findMany({ where: { videoAssetId: run.videoAssetId }, orderBy: { startMs: "asc" }, select: { id: true, startMs: true, endMs: true, kind: true } }))
      .map((c) => ({ cameraSegmentId: c.id, startMs: c.startMs, endMs: c.endMs, kind: c.kind }));
    if (!sameEvidence(cameras, producer.cameraSegments)) return false;
    try { if (!sameEvidence(await possessionCalibration(db, run.videoAssetId), producer.calibrationSnapshot)) return false; }
    catch (e) { if (e instanceof HttpException && e.getStatus() === 409) return false; throw e; }
    const proxy = await db.visionVideoVariant.findFirst({ where: { videoAssetId: run.videoAssetId, kind: "proxy" }, orderBy: { createdAt: "desc" }, select: { fps: true, sourceOffsetMs: true } });
    if (!proxy || !sameEvidence({ fps: proxy.fps, sourceOffsetMs: proxy.sourceOffsetMs }, object(input.possessionIndex).proxy)) return false;
    const declared = Array.isArray(snapshot.tracks) ? snapshot.tracks.map(object) : [];
    if (!Array.isArray(snapshot.tracks)) return false;
    const tracks = declared.length ? await db.visionTrack.findMany({ where: { videoAssetId: run.videoAssetId, id: { in: declared.map((t) => String(t.id)) } }, select: trackSelect, orderBy: { id: "asc" } }) : [];
    return sameEvidence(tracks, declared);
  }
  async assertCurrent(run: ImportedEventRun, db: Db = this.db) {
    await this.allowed(run.videoAssetId);
    if (!await this.current(run, db)) throw stale();
  }

  async forAsset(videoAssetId: string) {
    await this.asset(videoAssetId);
    const [runs, jobs, rights] = await Promise.all([
      this.db.visionEventImportRun.findMany({ where: { videoAssetId }, orderBy: { createdAt: "desc" }, take: 100,
        select: { id: true, inferenceJobId: true, attemptNumber: true, eventCount: true, artifactChecksum: true, createdBy: true, createdAt: true } }),
      this.db.visionJob.findMany({ where: { videoAssetId, type: "events", state: "succeeded" }, orderBy: { finishedAt: "desc" }, take: 100,
        select: { id: true, attemptNumber: true, finishedAt: true, inputSpec: true } }),
      this.rights.canAnalyze({ videoAssetId }),
    ]);
    return { videoAssetId, runs, canImport: rights.allowed, jobs: jobs.filter((j) => object(object(j.inputSpec).eventAlgorithm).configKey === EVENT_CARRY_VERSION)
      .map(({ inputSpec: _input, ...j }) => j) };
  }

  async importRun(videoAssetId: string, jobId: unknown, actor?: AdminAuthContext) {
    const me = person(actor, "import event evidence").userId;
    if (typeof jobId !== "string" || !jobId.trim() || jobId.length > 100) throw refusal(400, "InvalidEventJob", "Select a completed carry job.", "Use a completed event-carry/v1 job on this footage.");
    const asset = await this.asset(videoAssetId); await this.allowed(videoAssetId);
    if (!asset.sbMatchId) throw refusal(409, "AssetNotLinked", "Event evidence must be linked to a match.", "Link the source to its match first.");
    const job = await this.db.visionJob.findFirst({ where: { id: jobId, videoAssetId, type: "events", state: "succeeded" } });
    if (!job) throw notFound("completed event job", jobId);
    const input = object(job.inputSpec);
    const evidence = await readEventRunEvidence(this.db, this.store, { videoAssetId, sourceChecksum: asset.checksumSha256, taxonomyVersion: VISION_EVENT_TAXONOMY_VERSION,
      windowStartMs: Number(input.windowStartMs), windowEndMs: Number(input.windowEndMs) }, jobId, asset.durationMs ?? 0);
    const artifact = evidence.artifact;
    if (artifact.schemaVersion !== EVENT_CARRY_SCHEMA_VERSION || !artifact.producer) throw refusal(409, "EventImportUnsupported", "Only original weight-free carry artifacts can be imported here.", "Choose an event-inference/v2 carry run.");
    const index = object(input.possessionIndex), declaredTracks = object(input.tracks);
    if (index.role !== "possession" || index.calculationVersion !== "possession-candidates/v2" || index.videoAssetId !== videoAssetId || index.sourceChecksum !== asset.checksumSha256
      || index.trackJobId !== declaredTracks.jobId || declaredTracks.checksum !== artifact.producer.tracksChecksum || !sameEvidence(index.calibrationSnapshot, artifact.producer.calibrationSnapshot)) throw stale();
    const localIds = [...new Set(artifact.events.map((e) => e.localTrackId!))];
    const tracks = localIds.length ? await this.db.visionTrack.findMany({ where: { videoAssetId, inferenceJobId: String(index.trackJobId), localTrackId: { in: localIds } }, select: trackSelect, orderBy: { id: "asc" } }) : [];
    const byLocal = new Map(tracks.map((t) => [t.localTrackId, t]));
    for (const event of artifact.events) {
      const t = byLocal.get(event.localTrackId!);
      if (!t || !t.confirmed || !["player", "goalkeeper"].includes(t.class) || t.videoAssetId !== videoAssetId || t.inferenceJobId !== index.trackJobId || t.artifactKey !== declaredTracks.key
        || t.trackerVersionId !== index.trackerVersionId || t.detectorVersionId !== index.detectorVersionId || t.startMs > event.startMs || t.endMs < event.endMs) throw stale();
    }
    const snapshot = { artifact, input, provenance: evidence.provenance, model: evidence.model, sbMatchId: asset.sbMatchId, sourceDurationMs: asset.durationMs, tracks };
    const runEvidence = { videoAssetId, sourceChecksum: asset.checksumSha256, snapshot };
    await this.assertCurrent(runEvidence);
    const unique = { inferenceJobId_attemptNumber: { inferenceJobId: jobId, attemptNumber: job.attemptNumber } };
    const existingResult = async (db: Prisma.TransactionClient | PrismaService) => {
      const previous = await db.visionEventImportRun.findUnique({ where: unique });
      if (!previous) return null;
      if (previous.videoAssetId !== videoAssetId || previous.artifactChecksum !== evidence.provenance.artifactChecksum || !sameEvidence(previous.snapshot, snapshot)) throw stale();
      const originals = await db.visionEventCandidate.findMany({ where: { importRunId: previous.id, importPredictionId: { not: null } }, select: { id: true, importPredictionId: true } });
      if (originals.length !== artifact.events.length || artifact.events.some((e) => !originals.some((r) => r.importPredictionId === e.id))) throw stale();
      return { id: previous.id, imported: false, eventCount: previous.eventCount, candidateIds: originals.map((r) => r.id) };
    };
    try {
      const result = await this.db.$transaction(async (tx) => {
        const previous = await existingResult(tx);
        if (previous) return previous;
        await this.assertCurrent(runEvidence, tx);
        const run = await tx.visionEventImportRun.create({ data: { videoAssetId, inferenceJobId: jobId, attemptNumber: job.attemptNumber, artifactKey: evidence.provenance.artifactKey,
          artifactChecksum: evidence.provenance.artifactChecksum, sourceChecksum: asset.checksumSha256, eventCount: artifact.events.length, snapshot: snapshot as unknown as Prisma.InputJsonValue, createdBy: me } });
        const candidateIds: string[] = [];
        for (const event of artifact.events) {
          const track = byLocal.get(event.localTrackId!)!;
          const calibration = artifact.producer!.calibrationSnapshot.segments.find((c) => c.cameraSegmentId === event.cameraSegmentId)!;
          const row = await tx.visionEventCandidate.create({ data: { videoAssetId, sbMatchId: asset.sbMatchId, type: "carry", taxonomyVersion: artifact.taxonomyVersion, startMs: event.startMs, endMs: event.endMs,
            actorTrackId: track.id, actorPlayerId: null, actorMatchSquadPlayerId: null, sbTeamId: null, confidence: event.confidence, method: "model", modelVersionId: evidence.model.id,
            cameraSegmentId: event.cameraSegmentId, inPlay: true, reviewState: "unreviewed", decidedBy: me, proposedBy: me, importRunId: run.id, importPredictionId: event.id,
            note: "Original automatic carry proposal; football control and roster actor need review." } });
          candidateIds.push(row.id);
          // A still camera's calibration, or the keyframes a moving camera's frames were carried from.
          const calibrations = calibration.quality === "carried" ? (calibration.keyframeIds ?? []) : [calibration.calibrationId!];
          await tx.visionEvidenceLink.createMany({ data: [{ kind: "track", targetId: track.id }, { kind: "camera_segment", targetId: event.cameraSegmentId! }, ...calibrations.map((id) => ({ kind: "calibration", targetId: id }))]
            .map((e) => ({ candidateId: row.id, ...e, note: "Pinned original carry input" })) });
        }
        await new VisionAuditService(tx as PrismaService).record({ action: "event.imported", targetKind: "vision_event_import_run", targetId: run.id, data: { inferenceJobId: jobId, eventCount: artifact.events.length, candidateIds } }, actor);
        return { id: run.id, imported: true, eventCount: artifact.events.length, candidateIds };
      });
      return result;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        await this.assertCurrent(runEvidence);
        const previous = await existingResult(this.db);
        if (previous) return previous;
      }
      throw e;
    }
  }
}
