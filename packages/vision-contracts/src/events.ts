/**
 * Event candidates -- Phase 6.
 *
 * A candidate is Vision's proposal that something happened: a type from a
 * versioned taxonomy, a window in source time, an actor, evidence links to the
 * tracks, calibration, identity and clock it rests on, and a review state. The
 * recorder's pitch-side `SbMatchEvent` stays canonical (docs/vision/02 D10,
 * docs/vision/13 Q7): a candidate that two people stand behind *enriches* a
 * matching recorder event, or creates one only where the recorder logged nothing
 * and a publisher says so. The Vision row remains the evidence of record.
 */

import { NON_LIVE_SEGMENT_KINDS } from "./media";

/** Bumped when a type is added, removed or redefined. Every candidate carries the version it was proposed under. */
export const VISION_EVENT_TAXONOMY_VERSION = "2026.10.0";

/**
 * The first taxonomy: events that are both high value and observable
 * (docs/vision/09 § Taxonomy). It expands only when review quality on this set
 * supports it.
 */
export const VISION_EVENT_TYPES = [
  "pass",
  "carry",
  "shot",
  "cross",
  "header",
  "tackle",
  "interception",
  "recovery",
  "clearance",
  "throw_in",
  "corner",
  "free_kick",
  "save",
  "goal_candidate",
] as const;
export type VisionEventType = (typeof VISION_EVENT_TYPES)[number];

/**
 * Which candidate types have a ScoreBoard event type to promote into. The
 * recorder's vocabulary is goals, cards, substitutions and injuries; a pass or a
 * tackle has no row in the match record and stays Vision evidence, read by the
 * metrics phase. Only what is here can be promoted.
 */
export const SCOREBOARD_TYPE_OF: Partial<Record<VisionEventType, string>> = {
  goal_candidate: "goal",
};

/**
 * Camera segment kinds in which an event is not play: a replayed goal is not a
 * second goal. The same list as `NON_LIVE_SEGMENT_KINDS` in media.ts, under the
 * name the event rules use; one list, so the two cannot drift.
 */
export const NON_PLAY_SEGMENT_KINDS = NON_LIVE_SEGMENT_KINDS;

export const EVENT_METHODS = ["manual", "model"] as const;
export type EventMethod = (typeof EVENT_METHODS)[number];

export const EVENT_REVIEW_STATES = ["unreviewed", "accepted", "rejected"] as const;
export type EventReviewState = (typeof EVENT_REVIEW_STATES)[number];

/** How a candidate reached the match record. */
export const EVENT_PROMOTION_KINDS = ["enriched", "created"] as const;
export type EventPromotionKind = (typeof EVENT_PROMOTION_KINDS)[number];

/** What a candidate may rest on. */
export const EVIDENCE_KINDS = ["track", "camera_segment", "calibration", "identity", "clock_anchor", "detection_frame"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/** How far, in match minutes, a candidate may sit from a recorder event and still be the same event. */
export const PROMOTION_MINUTE_TOLERANCE = 1;

/**
 * What the review queue holds: every current, undecided claim that needs a
 * second person -- an identity on a window of a track, an event candidate on a
 * window of the footage. `GET /vision/review/queue` lists them oldest first by
 * default or by ascending confidence with `order=confidence`, the reader's own left out.
 */
export const REVIEW_QUEUE_KINDS = ["event", "identity"] as const;
export type ReviewQueueKind = (typeof REVIEW_QUEUE_KINDS)[number];

/**
 * What promotion writes under `SbMatchEvent.metadata.vision`: the bridge back
 * to the candidate, and the precision the recorder's whole minute lost.
 */
export type VisionEventPromotionV1 = {
  contract: "VisionEventPromotionV1";
  candidateId: string;
  videoAssetId: string;
  type: VisionEventType;
  taxonomyVersion: string;
  startMs: number;
  endMs: number;
  actorTrackId: string | null;
  promotedAt: string;
};
