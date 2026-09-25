/**
 * Source, acquisition and media enums.
 *
 * See docs/vision/03-RIGHTS-AND-GOVERNANCE.md and docs/vision/04-DATA-MODEL.md.
 */

/**
 * Which corpus an asset belongs to.
 *
 * The firewall that makes research-only footage structurally incapable of
 * entering a training set: dataset membership requires `dtp_owned`.
 */
export const CORPUS_KINDS = ["dtp_owned", "research_only", "experimental"] as const;
export type CorpusKind = (typeof CORPUS_KINDS)[number];

/** Only this corpus may back a dataset member. */
export const TRAINABLE_CORPUS: CorpusKind = "dtp_owned";

/**
 * Preference order for the copy DTP obtains, best first.
 *
 * Also a benchmark slice: platform compression destroys exactly the small-object
 * detail (ball pixels, jersey digits) the engine depends on, so model quality on
 * platform copies is reported separately from originals.
 */
export const SOURCE_QUALITY_RANKS = [
  "original_master",
  "authorized_export",
  "platform_copy",
] as const;
export type SourceQualityRank = (typeof SOURCE_QUALITY_RANKS)[number];

export const SOURCE_QUALITY_PREFERENCE: Record<SourceQualityRank, number> = {
  original_master: 0,
  authorized_export: 1,
  platform_copy: 2,
};

/**
 * How an authorized copy reached DTP. Exactly three, and there is no fourth:
 * V1 ships no automated downloader of any kind.
 */
export const ACQUISITION_METHODS = [
  "partner_direct_upload",
  "partner_authorized_export",
  "platform_copy_authorized",
] as const;
export type AcquisitionMethod = (typeof ACQUISITION_METHODS)[number];

export const ACQUISITION_STATUSES = [
  /** Metadata only. Can never be trained on. */
  "catalogued",
  /** Rights evidence attached and an authorized signatory has approved acquisition. */
  "authorized",
  /** Upload in progress. */
  "acquiring",
  /** An immutable DTP copy exists with a recorded checksum. */
  "acquired",
  /** Considered and declined — kept so the decision is not re-litigated. */
  "refused",
] as const;
export type AcquisitionStatus = (typeof ACQUISITION_STATUSES)[number];

/** Only this status may back a dataset member. */
export const ACQUIRED_STATUS: AcquisitionStatus = "acquired";

export const INGEST_STATES = [
  "uploading",
  "uploaded",
  "probing",
  "normalizing",
  "ready",
  "failed",
] as const;
export type IngestState = (typeof INGEST_STATES)[number];

export const VIDEO_VARIANT_KINDS = ["proxy", "hls", "thumbnail", "poster"] as const;
export type VideoVariantKind = (typeof VIDEO_VARIANT_KINDS)[number];

/**
 * Shot segmentation. Manual in Phase 1, model-assisted later.
 *
 * Exists from Phase 1 rather than Phase 6 because replays and intros are the
 * mechanism behind duplicated events and shortcut learning, and retrofitting the
 * table once events exist is painful.
 */
export const CAMERA_SEGMENT_KINDS = [
  "live_play",
  "replay",
  "intro",
  "halftime",
  "camera_cut",
  "unknown",
] as const;
export type CameraSegmentKind = (typeof CAMERA_SEGMENT_KINDS)[number];

/** Segments in which a proposed event must not be promoted to a published fact. */
export const NON_LIVE_SEGMENT_KINDS: readonly CameraSegmentKind[] = [
  "replay",
  "intro",
  "halftime",
];

export const RIGHTS_EVIDENCE_KINDS = [
  "contract",
  "email",
  "consent_form",
  "competition_authorization",
  "authority_evidence",
] as const;
export type RightsEvidenceKind = (typeof RIGHTS_EVIDENCE_KINDS)[number];

/**
 * Why an annotation or prediction was rejected. Structured rather than free
 * text, because these drive the next sampling batch.
 */
export const REJECTION_REASONS = [
  "wrong_box",
  "wrong_identity",
  "camera_cut",
  "ball_invisible",
  "event_ambiguous",
  "roster_error",
  "rights_issue",
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];
