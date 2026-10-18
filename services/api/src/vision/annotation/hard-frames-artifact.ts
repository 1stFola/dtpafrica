import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  DETECTION_CLASSES,
  HARD_FRAME_CAUSES,
  HARD_FRAME_REASON,
  HARD_FRAMES_ARTIFACT_ROLE,
  HARD_FRAMES_VERSION,
  MAX_HARD_FRAME_BOXES,
  MAX_HARD_FRAMES,
  MAX_HARD_FRAMES_BYTES,
  visionKeys,
  type HardFrame,
  type HardFramesArtifact,
} from "@dtp/vision-contracts";
import type { ObjectStore } from "../storage/object-store";
import { refusal } from "../shared/refusals";

const bad = (message: string) =>
  refusal(409, "HardFramesEvidenceInvalid", message, "Use a succeeded hard_frames job whose artifact still matches its completion; run hard_frames again if not.");

const unit = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
const whole = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/**
 * A succeeded hard_frames job's artifact, read through the store's bounded small-object
 * read and checked against the checksum its completion logged. Every frame and box is
 * validated, so nothing malformed reaches a person's screen (docs/vision/99).
 */
export async function readHardFrames(db: Pick<PrismaClient, "visionJob">, store: ObjectStore, jobId: string) {
  const job = await db.visionJob.findUnique({ where: { id: jobId } });
  if (!job || job.type !== "hard_frames" || job.state !== "succeeded" || !job.videoAssetId) throw bad("That is not a succeeded hard_frames job.");
  const progress = job.progress as { summary?: Record<string, unknown>; artifacts?: { key: string; bucket: string; role: string }[] } | null;
  const refs = (progress?.artifacts ?? []).filter((a) => a.role === HARD_FRAMES_ARTIFACT_ROLE && a.bucket === "derived");
  const summary = progress?.summary ?? {};
  if (refs.length !== 1 || !refs[0]!.key.startsWith(visionKeys.inferencePrefix(job.id, job.attemptNumber)) || typeof summary.artifactChecksum !== "string")
    throw bad("The job's completion does not name one hard_frames artifact of its own.");
  const body = await store.getSmallObject("derived", refs[0]!.key, MAX_HARD_FRAMES_BYTES);
  if (!body) throw bad("The hard_frames artifact is missing.");
  if (createHash("sha256").update(body).digest("hex") !== summary.artifactChecksum) throw bad("The hard_frames artifact changed after its job completed.");
  const raw = JSON.parse(body.toString("utf8")) as Partial<HardFramesArtifact>;
  if (raw.role !== HARD_FRAMES_ARTIFACT_ROLE || raw.calculationVersion !== HARD_FRAMES_VERSION || raw.videoAssetId !== job.videoAssetId
    || typeof raw.detectorVersionId !== "string" || !whole(raw.frameDurationMs) || raw.frameDurationMs < 1 || !Array.isArray(raw.frames) || raw.frames.length > MAX_HARD_FRAMES)
    throw bad("The hard_frames artifact is not a complete hard-frames/v1 record for this footage.");
  const frames: HardFrame[] = raw.frames.map((f) => {
    if (!f || !whole(f.frameIndex) || !whole(f.sourceTimeMs) || !(HARD_FRAME_CAUSES as readonly string[]).includes(f.cause) || f.reason !== HARD_FRAME_REASON[f.cause]
      || !unit(f.score) || !Array.isArray(f.boxes) || f.boxes.length > MAX_HARD_FRAME_BOXES
      || f.boxes.some((b) => !b || !(DETECTION_CLASSES as readonly string[]).includes(b.class) || ![b.x, b.y, b.width, b.height, b.confidence].every(unit) || b.x + b.width > 1.000001 || b.y + b.height > 1.000001 || b.width <= 0 || b.height <= 0))
      throw bad(`Frame ${String(f?.frameIndex)} of the hard_frames artifact is malformed.`);
    return f;
  });
  return { job, artifact: raw as HardFramesArtifact, frames, frameDurationMs: raw.frameDurationMs };
}
