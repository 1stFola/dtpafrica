import { validateEventGoldLabels, type GoldEvent } from "./event-gold";
import { VISION_EVENT_TAXONOMY_VERSION } from "./events";
import { EVENT_CARRY_VERSION, validCarryProducer, type EventCarryProducer } from "./event-carry";

/** Legacy weighted artifacts remain readable beside the v2 weight-free carry producer. */
export const EVENT_INFERENCE_SCHEMA_VERSION = "event-inference/v1";
export const EVENT_CARRY_SCHEMA_VERSION = "event-inference/v2";
export const EVENT_INFERENCE_ARTIFACT_ROLE = "event_inference";
export const MAX_EVENT_INFERENCE_BYTES = 256 * 1024;
export type EventInferencePrediction = GoldEvent & { confidence: number; inPlay: boolean; localTrackId?: number; cameraSegmentId?: string; trajectoryId?: number; displacementM?: number };
export type EventInferenceArtifact = {
  schemaVersion: typeof EVENT_INFERENCE_SCHEMA_VERSION | typeof EVENT_CARRY_SCHEMA_VERSION;
  jobId: string;
  attemptNumber: number;
  videoAssetId: string;
  sourceChecksum: string;
  modelVersionId: string;
  weightsChecksum: string | null;
  producer?: EventCarryProducer;
  configKey: string;
  gitCommit: string;
  workerImage: string;
  taxonomyVersion: string;
  coverage: { startMs: number; endMs: number; complete: true };
  events: EventInferencePrediction[];
};

/** Explicit completed coverage and explicit empty predictions are different from an absent run. */
export function validateEventInferenceArtifact(raw: unknown): { artifact: EventInferenceArtifact | null; problems: string[] } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { artifact: null, problems: ["Event inference must be an object."] };
  const value = raw as Record<string, unknown>, problems: string[] = [];
  const carry = value.schemaVersion === EVENT_CARRY_SCHEMA_VERSION;
  if (value.schemaVersion !== EVENT_INFERENCE_SCHEMA_VERSION && !carry) problems.push("Unsupported event inference schema.");
  for (const key of ["jobId", "videoAssetId", "modelVersionId", "configKey", "gitCommit", "workerImage"])
    if (typeof value[key] !== "string" || !String(value[key]).trim() || String(value[key]).length > 2000) problems.push(`Missing or invalid ${key}.`);
  for (const key of carry ? ["sourceChecksum"] : ["sourceChecksum", "weightsChecksum"])
    if (typeof value[key] !== "string" || !/^[a-f0-9]{64}$/i.test(String(value[key]))) problems.push(`Invalid ${key}.`);
  if (!Number.isSafeInteger(value.attemptNumber) || Number(value.attemptNumber) < 1) problems.push("Invalid attempt number.");
  if (value.taxonomyVersion !== VISION_EVENT_TAXONOMY_VERSION) problems.push("Unsupported event taxonomy.");
  if (carry) {
    if (value.weightsChecksum !== null || value.configKey !== EVENT_CARRY_VERSION || !validCarryProducer(value.producer)) problems.push("Carry inference needs pinned original evidence and a weight-free rule manifest.");
  } else if (value.producer !== undefined) problems.push("Legacy inference cannot claim carry rule provenance.");
  const coverage = value.coverage as Record<string, unknown> | undefined;
  if (!coverage || typeof coverage !== "object" || Array.isArray(coverage) || coverage.complete !== true
    || !Number.isSafeInteger(coverage.startMs) || !Number.isSafeInteger(coverage.endMs) || Number(coverage.startMs) < 0
    || Number(coverage.endMs) <= Number(coverage.startMs) || Number(coverage.endMs) - Number(coverage.startMs) > 300_000)
    problems.push("Coverage must explicitly complete a positive source window of at most five minutes.");
  if (!Array.isArray(value.events)) problems.push("Events must be an explicit array, including when empty.");
  else if (coverage && !problems.length) {
    const labels = validateEventGoldLabels({ events: value.events, nonPlayWindows: [] }, { startMs: Number(coverage.startMs), endMs: Number(coverage.endMs) });
    problems.push(...labels.problems);
    for (const rawEvent of value.events) {
      const event = rawEvent as Record<string, unknown> | null;
      if (!event || typeof event.confidence !== "number" || !Number.isFinite(event.confidence) || event.confidence < 0 || event.confidence > 1 || typeof event.inPlay !== "boolean")
        problems.push("Each prediction needs finite confidence in [0,1] and explicit inPlay.");
      if (carry && event) {
        const p = value.producer as EventCarryProducer;
        const camera = p.cameraSegments.find((c) => c.cameraSegmentId === event.cameraSegmentId);
        if (event.type !== "carry" || event.actorMatchSquadPlayerId !== null || event.inPlay !== true || !Number.isSafeInteger(event.localTrackId) || Number(event.localTrackId) < 0
          || !Number.isSafeInteger(event.trajectoryId) || Number(event.trajectoryId) < 1 || typeof event.displacementM !== "number" || !Number.isFinite(event.displacementM) || event.displacementM < 2
          || Number(event.endMs) - Number(event.startMs) < 1000 || !camera || camera.kind !== "live_play" || Number(event.startMs) < camera.startMs || Number(event.endMs) > camera.endMs
          || !p.calibrationSnapshot.segments.some((c) => c.cameraSegmentId === event.cameraSegmentId && ["good", "usable"].includes(String(c.quality)))) problems.push("Carry predictions need continuous calibrated live movement and an unnamed local track.");
      }
    }
  }
  if (problems.length) return { artifact: null, problems };
  // Keep only contract fields: arbitrary payload fields are not trusted provenance.
  const labels = validateEventGoldLabels({ events: value.events, nonPlayWindows: [] }, { startMs: Number(coverage!.startMs), endMs: Number(coverage!.endMs) }).labels!;
  return { artifact: {
    schemaVersion: carry ? EVENT_CARRY_SCHEMA_VERSION : EVENT_INFERENCE_SCHEMA_VERSION, jobId: value.jobId as string, attemptNumber: value.attemptNumber as number,
    videoAssetId: value.videoAssetId as string, sourceChecksum: String(value.sourceChecksum).toLowerCase(), modelVersionId: value.modelVersionId as string,
    weightsChecksum: carry ? null : String(value.weightsChecksum).toLowerCase(), ...(carry ? { producer: value.producer as EventCarryProducer } : {}), configKey: value.configKey as string, gitCommit: value.gitCommit as string,
    workerImage: value.workerImage as string, taxonomyVersion: value.taxonomyVersion as string,
    coverage: { startMs: Number(coverage!.startMs), endMs: Number(coverage!.endMs), complete: true },
    events: labels.events.map((event, index) => { const raw = (value.events as EventInferencePrediction[])[index]!; return { ...event, confidence: raw.confidence, inPlay: raw.inPlay,
      ...(carry ? { localTrackId: raw.localTrackId, cameraSegmentId: raw.cameraSegmentId, trajectoryId: raw.trajectoryId, displacementM: raw.displacementM } : {}) }; }),
  }, problems };
}
