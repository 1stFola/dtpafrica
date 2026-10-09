import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { CALIBRATED_POSSESSION_VERSION, POSSESSION_CALIBRATED_REASONS, POSSESSION_VERSION, POSSESSION_INDEX_ROLE, POSSESSION_CHUNK_ROLE, POSSESSION_UNKNOWN_REASONS, CAMERA_SEGMENT_KINDS, visionKeys, type PossessionCandidateSegment } from "@dtp/vision-contracts";
import { SmallObjectTooLargeError, type ObjectStore } from "../storage/object-store";
import { refusal } from "../shared/refusals";

export const MAX_POSSESSION_REVIEW_SEGMENTS = 20_000;
export const MAX_POSSESSION_INDEX_BYTES = 1024 * 1024;
export const MAX_POSSESSION_CHUNK_BYTES = 4 * 1024 * 1024;
export const MAX_POSSESSION_IMPORT_BYTES = 16 * 1024 * 1024;
export const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
export const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const count = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const confidence = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
/** The Python producer uses round-to-even, including at half-millisecond ticks. */
export const frameMs = (frame: number, fps: number) => { const value = frame * 1000 / fps, floor = Math.floor(value); return value - floor === 0.5 ? floor + floor % 2 : Math.round(value); };
export const bad = (message: string) => refusal(409, "PossessionEvidenceInvalid", message, "Choose a complete possession run with compatible pinned evidence. Use shorter footage or larger chunks if the review import exceeds its limits.");
export const checksum = (body: Buffer) => createHash("sha256").update(body).digest("hex");
const keys = ["calculationVersion", "frames", "candidateFrames", "unknownFrames", "candidateFrameCoverage", "reasons", "segments", "windowStartMs", "windowEndMs", "sourceChecksum", "ballJobId", "trackJobId", "ballIndexChecksum", "tracksChecksum", "chunks", "coordinateBasis", "reviewState"];
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
};
export const sameEvidence = (a: unknown, b: unknown) => canonical(a) === canonical(b);

/** No media or dense track data enters the API: only bounded index/segment JSON. */
export async function readPossessionEvidence(db: Pick<PrismaClient, "visionJob" | "visionJobEvent">, store: ObjectStore,
  asset: { id: string; checksumSha256: string; durationMs: number | null }, jobId: string) {
  const job = await db.visionJob.findFirst({ where: { id: jobId, videoAssetId: asset.id, type: "possession", state: "succeeded" } });
  if (!job || job.videoAssetId !== asset.id || job.type !== "possession" || job.state !== "succeeded" || job.modelVersionId || !job.finishedAt || !job.workerId || !job.idempotencyKey || !count(job.attemptNumber) || job.attemptNumber < 1) throw bad("The selected job is not a completed CPU possession run for this asset.");
  const progress = object(job.progress), summary = object(progress.summary), input = object(job.inputSpec);
  const event = await db.visionJobEvent.findFirst({ where: { jobId, kind: "succeeded" }, orderBy: { createdAt: "desc" } });
  const logged = object(event?.data), loggedSummary = object(logged.summary);
  const prefix = visionKeys.inferencePrefix(job.id, job.attemptNumber);
  const refs = Array.isArray(progress.artifacts) ? progress.artifacts.map(object) : [];
  if (!refs.length || refs.length > 257 || job.outputPrefix !== prefix || !sameEvidence(progress.artifacts, logged.artifacts)
    || !sameEvidence(progress.modelVersionIds, []) || !sameEvidence(logged.modelVersionIds, [])
    || typeof progress.workerImage !== "string" || !progress.workerImage.trim() || progress.workerImage !== logged.workerImage
    || !sameEvidence(summary, loggedSummary) || !hash(summary.indexChecksum)
    || refs.some((r) => r.bucket !== "derived" || typeof r.key !== "string" || !r.key.startsWith(prefix) || r.key.includes("..") || !count(r.bytes) || r.bytes < 1)
    || new Set(refs.map((r) => r.key)).size !== refs.length) throw bad("Completion and append-only log must agree on this attempt's artifacts, checksums and worker image.");
  const indexRefs = refs.filter((r) => r.role === POSSESSION_INDEX_ROLE), chunkRefs = refs.filter((r) => r.role === POSSESSION_CHUNK_ROLE);
  if (indexRefs.length !== 1 || !chunkRefs.length || refs.length !== chunkRefs.length + 1 || indexRefs[0]!.contentType !== "application/json" || chunkRefs.some((r) => r.contentType !== "application/x-ndjson")) throw bad("The run needs one JSON possession index and declared segment chunks.");
  let totalBytes = 0;
  const read = async (ref: Record<string, unknown>, limit: number, digest: string) => {
    if (!hash(digest) || Number(ref.bytes) > limit || totalBytes + Number(ref.bytes) > MAX_POSSESSION_IMPORT_BYTES) throw bad("Possession review import exceeds its bounded object or total byte limit.");
    const meta = await store.head("derived", String(ref.key));
    if (!meta || meta.bytes !== ref.bytes || meta.contentType !== ref.contentType) throw bad("The declared possession object is missing or its metadata changed.");
    let body: Buffer | null;
    try { body = await store.getSmallObject("derived", String(ref.key), limit); }
    catch (e) { if (e instanceof SmallObjectTooLargeError) throw bad("Possession object exceeded the hard streaming byte limit."); throw e; }
    if (!body || body.length !== meta.bytes || body.length > limit || checksum(body) !== digest) throw bad("Possession object bytes differ from the pinned checksum or size.");
    totalBytes += body.length;
    return body;
  };
  const parse = (body: string) => { try { return JSON.parse(body) as unknown; } catch { throw bad("Possession artifact contains invalid JSON."); } };
  const index = object(parse((await read(indexRefs[0]!, MAX_POSSESSION_INDEX_BYTES, summary.indexChecksum)).toString("utf8")));
  const calibrated = index.calculationVersion === CALIBRATED_POSSESSION_VERSION;
  if (index.role !== POSSESSION_INDEX_ROLE || index.videoAssetId !== asset.id || ![POSSESSION_VERSION, CALIBRATED_POSSESSION_VERSION].includes(String(index.calculationVersion)) || index.reviewState !== "unreviewed" || index.coordinateBasis !== "image_foot_proximity"
    || !count(asset.durationMs) || asset.durationMs < 1 || !hash(asset.checksumSha256) || index.sourceChecksum !== asset.checksumSha256 || input.sourceChecksum !== asset.checksumSha256 || input.sourceDurationMs !== asset.durationMs
    || !count(index.windowStartMs) || !count(index.windowEndMs) || index.windowEndMs <= index.windowStartMs || index.windowEndMs > asset.durationMs
    || !count(index.frames) || index.frames < 1 || index.frames > 1_000_000 || !count(index.segments) || index.segments < 1 || index.segments > MAX_POSSESSION_REVIEW_SEGMENTS
    || !count(index.candidateFrames) || !count(index.unknownFrames) || index.candidateFrames + index.unknownFrames !== index.frames
    || !confidence(index.candidateFrameCoverage) || Math.abs(index.candidateFrameCoverage - index.candidateFrames / index.frames) > 1e-9) throw bad("Possession index is not a complete, bounded unreviewed run on the original source.");
  const proxy = object(index.proxy), ball = object(input.ball), tracks = object(input.tracks);
  if (!sameEvidence(proxy, input.proxy) || typeof proxy.fps !== "number" || !Number.isFinite(proxy.fps) || proxy.fps < 10 || proxy.fps > 120 || !count(proxy.sourceOffsetMs)
    || index.windowStartMs !== proxy.sourceOffsetMs || !count(input.proxyDurationMs) || input.proxyDurationMs < 1
    || index.windowEndMs !== Math.min(asset.durationMs, proxy.sourceOffsetMs + input.proxyDurationMs) || index.frames !== Math.ceil((index.windowEndMs - index.windowStartMs) * proxy.fps / 1000)
    || index.ballJobId !== ball.jobId || index.ballIndexChecksum !== ball.indexChecksum || !hash(index.ballIndexChecksum)
    || index.trackJobId !== tracks.jobId || index.tracksChecksum !== tracks.checksum || !hash(index.tracksChecksum) || index.trackerVersionId !== tracks.trackerVersionId
    || index.detectorJobId !== input.detectorJobId || index.detectorVersionId !== input.detectorVersionId || index.proxyChecksum !== input.proxyChecksum || !hash(index.proxyChecksum)
    || index.detectionsChecksum !== input.detectionsChecksum || !hash(index.detectionsChecksum) || index.imageWidth !== input.imageWidth || index.imageHeight !== input.imageHeight
    || !count(index.imageWidth) || !index.imageWidth || !count(index.imageHeight) || !index.imageHeight) throw bad("Possession source clock or producer lineage differs from the queued evidence.");
  const cameras = Array.isArray(index.cameraSegments) ? index.cameraSegments.map(object) : [];
  if (!sameEvidence(cameras, input.segments) || cameras.some((c, i) => typeof c.cameraSegmentId !== "string" || !c.cameraSegmentId || !count(c.startMs) || !count(c.endMs) || c.endMs <= c.startMs || c.endMs > asset.durationMs!
    || !(CAMERA_SEGMENT_KINDS as readonly unknown[]).includes(c.kind) || (i > 0 && Number(c.startMs) < Number(cameras[i - 1]!.endMs))) || new Set(cameras.map((c) => c.cameraSegmentId)).size !== cameras.length) throw bad("Camera snapshot is invalid or changed since enqueue.");
  const calibration = object(index.calibrationSnapshot);
  const calibrationRows = Array.isArray(calibration.segments) ? calibration.segments.map(object) : [];
  if (calibrated) {
    const expectedConfig = { maxGroundDistanceM: 2, maxBallGroundSpeedMps: 35, maxPlayerSpeedMps: 12, ...object(input.footballConfig) };
    if (index.constraintMode !== "calibrated" || input.constraintMode !== "calibrated" || !sameEvidence(index.calibrationSnapshot, input.calibrationSnapshot)
      || !sameEvidence(index.footballConfig, expectedConfig) || calibration.proxyChecksum !== index.proxyChecksum || typeof calibration.proxyVariantId !== "string" || !calibration.proxyVariantId || typeof calibration.proxyKey !== "string" || !calibration.proxyKey
      || !count(calibration.proxyWidth) || !calibration.proxyWidth || !count(calibration.proxyHeight) || !calibration.proxyHeight
      || !sameEvidence(calibrationRows.map((s) => ({ cameraSegmentId: s.cameraSegmentId, startMs: s.startMs, endMs: s.endMs })), cameras.map((s) => ({ cameraSegmentId: s.cameraSegmentId, startMs: s.startMs, endMs: s.endMs }))))
      throw bad("Calibrated constraints differ from the queued geometry, calibration snapshot or limits.");
    for (const k of ["constraintMode", "calibrationSnapshot", "footballConfig"]) if (!sameEvidence(summary[k], index[k])) throw bad("Calibrated completion and index disagree.");
  } else if (input.constraintMode === "calibrated" || input.calibrationSnapshot !== undefined || input.footballConfig !== undefined || index.constraintMode !== undefined || index.calibrationSnapshot !== undefined || index.footballConfig !== undefined)
    throw bad("Legacy image evidence cannot claim calibrated constraints.");
  const chunks = Array.isArray(index.chunks) ? index.chunks.map(object) : [];
  if (chunks.length !== chunkRefs.length || chunks.length !== summary.chunks || new Set(chunks.map((c) => c.key)).size !== chunks.length) throw bad("Index chunks do not match the declared completion.");
  const segments: PossessionCandidateSegment[] = [];
  const reasons: Record<string, number> = {};
  let frames = 0, candidateFrames = 0;
  for (const chunk of chunks) {
    const ref = chunkRefs.find((r) => r.key === chunk.key);
    if (!ref || !hash(chunk.checksumSha256) || !count(chunk.frames) || !count(chunk.segments)) throw bad("Missing or invalid declared segment chunk.");
    const body = await read(ref, MAX_POSSESSION_CHUNK_BYTES, chunk.checksumSha256);
    const first = segments.length, frameStart = frames;
    const lines = body.toString("utf8").split("\n");
    if (lines.at(-1) === "") lines.pop();
    if (lines.length > MAX_POSSESSION_REVIEW_SEGMENTS - segments.length) throw bad("Too many possession segments for a single review import.");
    for (const line of lines) {
      const row = object(parse(line));
      if (!count(row.frames) || row.frames < 1 || !count(row.startMs) || !count(row.endMs) || row.endMs <= row.startMs || row.reviewState !== "unreviewed"
        || row.startMs !== Number(proxy.sourceOffsetMs) + frameMs(frames, Number(proxy.fps))
        || row.endMs !== Math.min(Number(index.windowEndMs), Number(proxy.sourceOffsetMs) + frameMs(frames + row.frames, Number(proxy.fps)))
        || (row.cameraSegmentId !== null && typeof row.cameraSegmentId !== "string") || (row.trajectoryId !== null && (!count(row.trajectoryId) || row.trajectoryId < 1))) throw bad("Segments must cover the window contiguously on its exact frame clock.");
      if (row.sourceState !== undefined) throw bad("Worker segments must use the original state contract.");
      const camera = cameras.find((c) => c.cameraSegmentId === row.cameraSegmentId);
      const lastObservation = Number(proxy.sourceOffsetMs) + frameMs(frames + row.frames - 1, Number(proxy.fps));
      if (row.cameraSegmentId !== null && (!camera || Number(camera.startMs) > row.startMs || Number(camera.endMs) <= lastObservation)) throw bad("A segment's camera must cover every contributing observation.");
      if (row.state === "candidate") {
        if (!count(row.localTrackId) || row.reason !== null || !confidence(row.evidenceConfidence) || row.trajectoryId === null || !camera || camera.kind !== "live_play" || Number(camera.startMs) > row.startMs || Number(camera.endMs) < row.endMs) throw bad("A candidate needs a track, observed trajectory and a wholly live camera window.");
        candidateFrames += row.frames;
        if (calibrated && !calibrationRows.some((c) => c.cameraSegmentId === row.cameraSegmentId && ["good", "usable", "carried"].includes(String(c.quality)))) throw bad("A calibrated candidate requires a passing or carried camera calibration.");
      } else if (row.state === "unknown") {
        if (row.localTrackId !== null || row.evidenceConfidence !== null || ![...POSSESSION_UNKNOWN_REASONS, ...(calibrated ? POSSESSION_CALIBRATED_REASONS : [])].includes(row.reason as never)) throw bad("Unknown segments cannot name a possessor or confidence.");
        if (row.reason === "ball_lost" ? row.trajectoryId !== null : row.trajectoryId === null || !camera || camera.kind !== "live_play") throw bad("Unknown reason and observed/lost trajectory evidence disagree.");
        const reason = String(row.reason); reasons[reason] = (reasons[reason] ?? 0) + row.frames;
      } else throw bad("Unsupported possession segment state.");
      frames += row.frames;
      if (frames > Number(index.frames)) throw bad("Segment frames exceed the declared source window.");
      segments.push(row as unknown as PossessionCandidateSegment);
    }
    if (segments.length - first !== chunk.segments || frames - frameStart !== chunk.frames || !segments[first] || segments[first]!.startMs !== chunk.startMs || segments.at(-1)!.endMs !== chunk.endMs) throw bad("Segment chunk bounds and counters differ from the actual rows.");
  }
  if (frames !== index.frames || segments.length !== index.segments || candidateFrames !== index.candidateFrames || frames - candidateFrames !== index.unknownFrames || !sameEvidence(reasons, index.reasons)) throw bad("Actual segments do not account for the complete candidate/Unknown coverage.");
  for (const k of keys) {
    const expected = k === "chunks" ? chunks.length : index[k];
    if (!sameEvidence(summary[k], expected)) throw bad(`Completion disagrees with actual possession ${k}.`);
  }
  return { job, index, indexKey: String(indexRefs[0]!.key), indexChecksum: summary.indexChecksum, segments, snapshot: { index, input, sourceDurationMs: asset.durationMs, workerImage: progress.workerImage, finishedAt: job.finishedAt.toISOString(), attemptNumber: job.attemptNumber } };
}
