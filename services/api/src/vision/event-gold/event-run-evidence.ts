import { createHash } from "node:crypto";
import type { PrismaClient, VisionEventGoldSet } from "@prisma/client";
import { EVENT_CARRY_SCHEMA_VERSION, EVENT_CARRY_VERSION, EVENT_CARRY_MANIFEST_CHECKSUM, EVENT_INFERENCE_ARTIFACT_ROLE, MAX_EVENT_INFERENCE_BYTES, validateEventInferenceArtifact, visionKeys } from "@dtp/vision-contracts";
import { sameEvidence } from "../possession/possession-evidence";
import type { ObjectStore } from "../storage/object-store";
import { SmallObjectTooLargeError } from "../storage/object-store";
import { refusal } from "../shared/refusals";

export const EVENT_SCORE_MODEL_SELECT = { id: true, version: true, datasetVersionId: true, gitCommit: true, weightsKey: true, weightsChecksum: true, configKey: true, workerImage: true, model: { select: { key: true, task: true } } } as const;
const object = (raw: unknown): Record<string, unknown> => raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
const bad = (message: string) => refusal(409, "EventRunEvidenceInvalid", message, "Select a succeeded event inference job with complete, checksum-pinned provenance and coverage. Do not manufacture or edit completed job evidence.");
const sha256 = (body: Buffer) => createHash("sha256").update(body).digest("hex");

/** Read one bounded immutable run, never merge candidates or infer completion from a missing output. */
export async function readEventRunEvidence(db: Pick<PrismaClient, "visionJob" | "visionJobEvent" | "visionModelVersion">, store: ObjectStore,
  set: VisionEventGoldSet, jobId: string, durationMs: number) {
  const job = await db.visionJob.findFirst({ where: { id: jobId, videoAssetId: set.videoAssetId, type: "events", state: "succeeded" } });
  if (!job?.modelVersionId || job.type !== "events" || job.state !== "succeeded" || job.videoAssetId !== set.videoAssetId
    || !job.finishedAt || !job.idempotencyKey || !job.workerId) throw bad("This is not a completed, model-bound event job for the reference asset.");
  const model = await db.visionModelVersion.findUnique({ where: { id: job.modelVersionId }, select: EVENT_SCORE_MODEL_SELECT });
  const input = object(job.inputSpec), algorithm = object(input.eventAlgorithm);
  const carry = algorithm.configKey === EVENT_CARRY_VERSION && algorithm.manifestChecksum === EVENT_CARRY_MANIFEST_CHECKSUM;
  if (!model || model.model.task !== "event" || !model.gitCommit?.trim() || !model.configKey?.trim() || !model.workerImage?.trim()
    || (carry ? model.weightsChecksum !== null || model.weightsKey !== null || model.configKey !== EVENT_CARRY_VERSION : !model.weightsChecksum || !/^[a-f0-9]{64}$/i.test(model.weightsChecksum))) throw bad("The event version lacks pinned weights or a supported weight-free rule, commit, configuration or worker image provenance.");
  const progress = object(job.progress), summary = object(progress.summary);
  const completionEvent = await db.visionJobEvent.findFirst({ where: { jobId: job.id, kind: "succeeded" }, orderBy: { createdAt: "desc" } });
  const logged = object(completionEvent?.data), loggedSummary = object(logged.summary);
  const matchesModel = (ids: unknown) => Array.isArray(ids) && ids.length === 1 && ids[0] === model.id;
  if (!matchesModel(progress.modelVersionIds) || !matchesModel(logged.modelVersionIds) || progress.workerImage !== model.workerImage || logged.workerImage !== model.workerImage
    || summary.modelVersionId !== model.id || loggedSummary.modelVersionId !== model.id)
    throw bad("The saved completion and append-only job log do not attribute this run to the same model and image.");
  const artifacts = Array.isArray(progress.artifacts) ? progress.artifacts.map(object).filter((row) => row.role === EVENT_INFERENCE_ARTIFACT_ROLE) : [];
  const loggedArtifacts = Array.isArray(logged.artifacts) ? logged.artifacts.map(object).filter((row) => row.role === EVENT_INFERENCE_ARTIFACT_ROLE) : [];
  const artifactRef = artifacts[0], loggedRef = loggedArtifacts[0];
  const prefix = visionKeys.inferencePrefix(job.id, job.attemptNumber);
  if (artifacts.length !== 1 || loggedArtifacts.length !== 1 || !artifactRef || !loggedRef || artifactRef.bucket !== "derived" || loggedRef.bucket !== "derived"
    || typeof artifactRef.key !== "string" || artifactRef.key !== loggedRef.key || !artifactRef.key.startsWith(prefix) || job.outputPrefix !== prefix
    || artifactRef.key.includes("..") || !Number.isSafeInteger(artifactRef.bytes) || Number(artifactRef.bytes) < 1 || Number(artifactRef.bytes) > MAX_EVENT_INFERENCE_BYTES
    || loggedRef.bytes !== artifactRef.bytes || artifactRef.contentType !== "application/json" || loggedRef.contentType !== "application/json")
    throw bad("The run needs one small JSON event artifact under its exact attempt prefix, named identically in the completion log.");
  const meta = await store.head("derived", artifactRef.key);
  if (!meta || meta.bytes !== artifactRef.bytes || meta.bytes > MAX_EVENT_INFERENCE_BYTES || meta.contentType !== "application/json") throw bad("The event artifact is missing, oversized or differs from the declared object metadata.");
  let body: Buffer | null;
  try { body = await store.getSmallObject("derived", artifactRef.key, MAX_EVENT_INFERENCE_BYTES); }
  catch (error) { if (error instanceof SmallObjectTooLargeError) throw bad("The event artifact exceeded the hard byte limit during its read."); throw error; }
  if (!body || body.length !== meta.bytes || body.length > MAX_EVENT_INFERENCE_BYTES) throw bad("The event artifact bytes do not match the bounded object metadata.");
  const artifactChecksum = sha256(body);
  if (summary.eventArtifactSha256 !== artifactChecksum || loggedSummary.eventArtifactSha256 !== artifactChecksum) throw bad("The event artifact no longer matches the checksums in its completion and immutable log.");
  let raw: unknown;
  try { raw = JSON.parse(body.toString("utf8")); } catch { throw bad("The event artifact is not valid JSON."); }
  const parsed = validateEventInferenceArtifact(raw);
  if (!parsed.artifact) throw bad(`The event inference contract is invalid: ${parsed.problems.slice(0, 5).join(" ")}`);
  const artifact = parsed.artifact;
  if (artifact.jobId !== job.id || artifact.attemptNumber !== job.attemptNumber || artifact.videoAssetId !== set.videoAssetId
    || artifact.modelVersionId !== model.id || artifact.sourceChecksum !== set.sourceChecksum.toLowerCase() || input.sourceChecksum !== set.sourceChecksum
    || artifact.weightsChecksum !== (model.weightsChecksum?.toLowerCase() ?? null) || artifact.gitCommit !== model.gitCommit || artifact.configKey !== model.configKey || artifact.workerImage !== model.workerImage
    || artifact.taxonomyVersion !== set.taxonomyVersion || artifact.coverage.endMs > durationMs || artifact.coverage.startMs > set.windowStartMs || artifact.coverage.endMs < set.windowEndMs
    || input.windowStartMs !== artifact.coverage.startMs || input.windowEndMs !== artifact.coverage.endMs)
    throw bad("Source, model, attempt or coverage differs from the queued run and frozen reference. The run must cover the entire reference window.");
  if (carry) {
    const possession = object(input.possession), index = object(input.possessionIndex), tracks = object(input.tracks);
    const expected = { algorithm: EVENT_CARRY_VERSION, manifestChecksum: EVENT_CARRY_MANIFEST_CHECKSUM, possessionJobId: possession.jobId,
      possessionIndexChecksum: possession.indexChecksum, tracksChecksum: tracks.checksum, calibrationSnapshot: index.calibrationSnapshot, cameraSegments: index.cameraSegments };
    if (artifact.schemaVersion !== EVENT_CARRY_SCHEMA_VERSION || !sameEvidence(artifact.producer, expected) || !sameEvidence(summary.producer, expected) || !sameEvidence(loggedSummary.producer, expected)
      || algorithm.modelVersionId !== model.id || algorithm.weightsChecksum !== null || algorithm.gitCommit !== model.gitCommit || algorithm.workerImage !== model.workerImage)
      throw bad("Carry rule provenance differs from the original queued possession, tracks or calibration.");
  } else if (artifact.schemaVersion === EVENT_CARRY_SCHEMA_VERSION) throw bad("A carry artifact must be queued under its weight-free rule version.");
  for (const row of [summary, loggedSummary]) {
    if (row.weightsSha256 !== artifact.weightsChecksum || row.sourceChecksum !== artifact.sourceChecksum || row.windowStartMs !== artifact.coverage.startMs
      || row.windowEndMs !== artifact.coverage.endMs || row.eventCount !== artifact.events.length) throw bad("The completion summary disagrees with the artifact's weights, source, coverage or complete event count.");
  }
  return { model, artifact, provenance: { jobId: job.id, attemptNumber: job.attemptNumber, artifactKey: artifactRef.key, artifactChecksum,
    artifactSchemaVersion: artifact.schemaVersion, coverage: artifact.coverage, finishedAt: job.finishedAt.toISOString(), eventCount: artifact.events.length,
    ...(artifact.producer ? { producer: artifact.producer } : {}) } };
}
