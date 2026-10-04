import { adminFetch } from "./admin";
import type { CalibrationQuality } from "@dtp/vision-contracts";

/**
 * Vision Engine API client.
 *
 * Phase 0 exposes one read-only endpoint. Ingestion, jobs and review arrive in
 * Phase 1 — see docs/vision/07-API-CONTRACTS.md.
 */

export type VisionResourceClass = "cpu_small" | "gpu_24gb" | "gpu_48gb" | "gpu_80gb";

export type VisionProviderCapabilities = {
  providerId: string;
  resourceClasses: VisionResourceClass[];
  maxConcurrentWorkers: number;
  /** False for providers that may only run throwaway experiments. */
  productionApproved: boolean;
};

export type VisionStatus = {
  phase: string;
  enabled: boolean;
  contractVersion: string;
  storage: {
    backend: string;
    buckets: Record<string, string | null>;
    /** Whether credentials are present — never the credentials themselves. */
    credentialsConfigured: boolean;
  };
  upload: {
    partBytes: number;
    sessionTtlHours: number;
    partUrlTtlSeconds: number;
  };
  playback: { urlTtlSeconds: number };
  jobs: {
    heartbeatIntervalSeconds: number;
    missedHeartbeatsBeforeExpiry: number;
    workerTokenTtlHours: number;
    defaultBudgetSeconds: number;
    defaultBudgetUsdCents: number;
  };
  compute: {
    defaultProvider: string;
    workerImage: string;
    monthlyBudgetUsdCents: number;
    providers: VisionProviderCapabilities[];
  };
  policy: {
    takedownUnpublishImmediate: boolean;
    takedownDeleteWithinDays: number;
    dataSubjectAckWithinDays: number;
    dataSubjectCompleteWithinDays: number;
    derivedMediaRetentionMonths: number;
  };
};

export function fetchVisionStatus() {
  return adminFetch<VisionStatus>("/vision/status");
}

// ── Partner source catalog ──────────────────────────────────────────────────

export type VisionRightsDecision =
  | { allowed: true; scopeId: string; grantLevel: string; expiresAt: string | null }
  | { allowed: false; reason: string; detail: string; remediation: string };

export type VisionScopeKey =
  | "canAnalyze"
  | "canTrain"
  | "canPublishHighlight"
  | "canShareWithScout";

export type VisionPartner = {
  id: string;
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  isActive: boolean;
  _count: { videoRecords: number; evidence: number; signatories: number };
};

export type VisionSourceRow = {
  id: string;
  title: string | null;
  url: string | null;
  sourceQualityRank: string;
  acquisitionStatus: string;
  acquisitionMethod: string | null;
  rightsOwnerName: string | null;
  originalAvailable: boolean;
  createdAt: string;
  partner: { id: string; name: string };
  sbMatch: { id: string; slug: string | null } | null;
  sbCompetition: { id: string; name: string } | null;
  _count: { videoAssets: number };
};

export type VisionRightsScopeRow = {
  id: string;
  grantLevel: string;
  canAnalyze: boolean;
  canTrain: boolean;
  canPublishHighlight: boolean;
  canShareWithScout: boolean;
  grantedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
};

export type VisionEvidenceRow = {
  id: string;
  kind: string;
  objectKey: string;
  documentDate: string | null;
  createdAt: string;
};

export type VisionSignatoryRow = {
  id: string;
  name: string;
  role: string;
  activeFrom: string;
  activeTo: string | null;
};

export type VisionSourceDetail = {
  source: VisionSourceRow & {
    notes: string | null;
    acquisitionAuthorizedAt: string | null;
    partner: VisionPartner & {
      evidence: VisionEvidenceRow[];
      signatories: VisionSignatoryRow[];
      rightsScopes: VisionRightsScopeRow[];
    };
    rightsScopes: VisionRightsScopeRow[];
    authorizedBy: VisionSignatoryRow | null;
    videoAssets: {
      id: string;
      ingestState: string;
      ingestError: string | null;
      durationMs: number | null;
      videoCodec: string | null;
      duplicateClusterId: string | null;
      createdAt: string;
      /** The review proxy, when transcode has produced one. */
      variants: { kind: string; durationMs: number | null }[];
    }[];
    uploadGrants: {
      id: string;
      expiresAt: string;
      usedAt: string | null;
      revokedAt: string | null;
      createdAt: string;
    }[];
  };
  decisions: Record<VisionScopeKey, VisionRightsDecision>;
  preference: number | null;
};

export function fetchVisionPartners() {
  return adminFetch<{ partners: VisionPartner[] }>("/vision/partners");
}

export function fetchVisionSources(filters: {
  partnerId?: string;
  acquisitionStatus?: string;
  q?: string;
}) {
  const params = new URLSearchParams();
  if (filters.partnerId) params.set("partnerId", filters.partnerId);
  if (filters.acquisitionStatus) params.set("acquisitionStatus", filters.acquisitionStatus);
  if (filters.q) params.set("q", filters.q);
  const query = params.toString();
  return adminFetch<{ sources: VisionSourceRow[] }>(`/vision/sources${query ? `?${query}` : ""}`);
}

export function fetchVisionSource(id: string) {
  return adminFetch<VisionSourceDetail>(`/vision/sources/${id}`);
}

export function fetchVisionSourceImpact(id: string) {
  return adminFetch<{
    assets: number;
    variants: number;
    jobs: number;
    duplicateClusters: number;
    datasetVersions: { id: string; label: string; frozen: boolean }[];
    liveScopes: number;
    note: string;
  }>(`/vision/sources/${id}/impact`);
}

export function grantVisionScope(body: Partial<Record<VisionScopeKey, boolean>> & {
  partnerId?: string;
  sourceVideoRecordId?: string;
  evidenceId?: string;
  expiresAt?: string;
}) {
  return adminFetch<VisionRightsScopeRow>("/vision/rights/scopes", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function revokeVisionScope(scopeId: string, reason: string) {
  return adminFetch<VisionRightsScopeRow>(`/vision/rights/scopes/${scopeId}/revoke`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function authorizeVisionAcquisition(
  sourceId: string,
  body: { acquisitionMethod: string; signatoryId: string }
) {
  return adminFetch<VisionSourceRow>(`/vision/sources/${sourceId}/authorize-acquisition`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function issueVisionUploadGrant(
  sourceId: string,
  body: { expiresInHours?: number } = {}
) {
  return adminFetch<{
    grantId: string;
    /** Shown once. Only the hash is stored server-side. */
    token: string;
    expiresAt: string;
    maxBytes: number;
    allowedMimeTypes: string[];
  }>(`/vision/sources/${sourceId}/upload-grant`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ── Annotation and review ──────────────────────────────────────────────────

export type SamplingStrategy =
  | "uniform_random"
  | "low_confidence"
  | "stage_disagreement"
  | "reviewer_disagreement"
  | "new_domain_slice"
  | "business_value"
  | "targeted_event";

export type AnnotationTaskState =
  | "queued"
  | "assigned"
  | "submitted"
  | "approved"
  | "rejected"
  | "abandoned";

export type ReviewDecisionKind = "approved" | "corrected" | "rejected";

export type RejectionReason =
  | "wrong_box"
  | "wrong_identity"
  | "camera_cut"
  | "ball_invisible"
  | "event_ambiguous"
  | "roster_error"
  | "rights_issue";

export type VisionLabelSchema = {
  id: string;
  version: string;
  definitions: Record<string, unknown>;
  effectiveFrom: string;
  supersededAt: string | null;
  notes: string | null;
  _count?: { annotationTasks: number };
};

export type VisionAnnotationVersionRow = {
  id: string;
  payloadKey: string;
  payloadChecksum: string;
  annotatorId: string | null;
  effortMinutes: number | null;
  supersedesId: string | null;
  createdAt: string;
  reviews: {
    id: string;
    decision: ReviewDecisionKind;
    rejectionReason: RejectionReason | null;
    reviewerId: string | null;
    notes: string | null;
    createdAt: string;
  }[];
};

export type VisionAnnotationTask = {
  id: string;
  videoAssetId: string;
  labelSchemaVersionId: string;
  samplingStrategy: SamplingStrategy;
  startMs: number;
  endMs: number;
  assignedTo: string | null;
  state: AnnotationTaskState;
  preLabelled: boolean;
  preLabelModelVersionId: string | null;
  createdAt: string;
  labelSchemaVersion?: { id: string; version: string; definitions: Record<string, unknown> };
  versions?: VisionAnnotationVersionRow[];
};

/**
 * Where the clip actually is, and where in it the window sits.
 *
 * `windowStartMs` is in **proxy** time, already offset from source time by the
 * server. The two must never be conflated: `47:12` on the match clock is not
 * `47:12` in the file, and treating them as one corrupts every label.
 */
export type VisionTaskMedia = {
  url: string;
  windowStartMs: number;
  windowEndMs: number;
  fps: number | null;
  expiresInSeconds: number;
};

export type VisionActiveLearningItem = {
  id: string;
  videoAssetId: string;
  startMs: number;
  endMs: number;
  reason: SamplingStrategy;
  score: number;
  state: string;
  createdAt: string;
};

export type VisionMixReport = {
  tasks: number;
  bySamplingStrategy: Record<string, number>;
  hardCaseShare: number | null;
  byState: Record<string, number>;
  reviewDecisions: Record<string, number>;
  rejectionReasons: Record<string, number>;
  effort: {
    submissions: number;
    averageMinutes: number | null;
    totalMinutes: number | null;
  };
};

export function fetchVisionLabelSchemas() {
  return adminFetch<{ schemas: VisionLabelSchema[] }>("/vision/annotation/schemas");
}

/**
 * Claims the next task atomically, as the signed-in person; `task` is null when the
 * queue is empty. The API takes the annotator from the session.
 */
export function claimVisionTask(samplingStrategy?: SamplingStrategy) {
  return adminFetch<{ task: VisionAnnotationTask | null; media?: VisionTaskMedia }>(
    "/vision/annotation/tasks/claim",
    {
      method: "POST",
      body: JSON.stringify(samplingStrategy ? { samplingStrategy } : {}),
    }
  );
}

export function fetchVisionTask(id: string) {
  return adminFetch<{ task: VisionAnnotationTask; media: VisionTaskMedia }>(
    `/vision/annotation/tasks/${id}`
  );
}

/**
 * One box in a submission. Source time and normalised geometry: see
 * `modules/admin/vision/annotation-boxes.ts` for why neither is in proxy pixels.
 */
export type VisionAnnotationBox = {
  sourceTimeMs: number;
  class: "player" | "goalkeeper" | "referee" | "ball";
  x: number;
  y: number;
  width: number;
  height: number;
  uncertain?: boolean;
  fromModelVersionId?: string | null;
  /** The same id on boxes across frames says "the same player". */
  trackId?: string;
};

export function submitVisionAnnotation(
  taskId: string,
  body: { payload: Record<string, unknown>; effortMinutes?: number; annotatorId?: string }
) {
  return adminFetch<VisionAnnotationVersionRow>(`/vision/annotation/tasks/${taskId}/submit`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function fetchVisionAnnotationPayload(versionId: string) {
  return adminFetch<{ version: VisionAnnotationVersionRow; payload: unknown }>(
    `/vision/annotation/versions/${versionId}`
  );
}

export function reviewVisionAnnotation(
  versionId: string,
  body: { decision: ReviewDecisionKind; rejectionReason?: RejectionReason; notes?: string }
) {
  return adminFetch<{ id: string; decision: ReviewDecisionKind }>(
    `/vision/annotation/versions/${versionId}/review`,
    { method: "POST", body: JSON.stringify(body) }
  );
}

export function fetchVisionAnnotationQueue(limit = 50) {
  return adminFetch<{ items: VisionActiveLearningItem[] }>(
    `/vision/annotation/queue?limit=${limit}`
  );
}

export function convertVisionQueueItem(
  itemId: string,
  body: { labelSchemaVersionId: string; assignedTo?: string }
) {
  return adminFetch<{ task: VisionAnnotationTask; item: string }>(
    `/vision/annotation/queue/${itemId}/convert`,
    { method: "POST", body: JSON.stringify(body) }
  );
}

export function fetchVisionMixReport() {
  return adminFetch<VisionMixReport>("/vision/annotation/mix");
}

// ── Identity review (Phase 4 Increment 4-5) ────────────────────────────────

export type VisionReviewTeam = {
  team: "A" | "B" | null;
  confidence: number | null;
  method: string;
  kitDescription: string | null;
  reviewState: string;
  inferenceJobId: string;
};

export type VisionIdentityAssignment = {
  id: string;
  trackId: string;
  playerId: string | null;
  matchSquadPlayerId: string | null;
  sbTeamId: string | null;
  confidence: number;
  method: "manual" | "propagated" | string;
  validFromMs: number;
  validToMs: number;
  reviewState: "unreviewed" | "accepted" | "rejected" | string;
  decidedBy: string;
  reviewedBy: string | null;
  note: string | null;
  supersededBy: string | null;
  createdAt: string;
  /** The roster slot named, as the review view attaches it; absent on a bare row. */
  slot?: { name: string; jerseyNumber: number | null } | null;
};

export type VisionReviewTrack = {
  id: string;
  localTrackId: number;
  inferenceJobId: string;
  artifactKey: string;
  class: string;
  startMs: number;
  endMs: number;
  team: VisionReviewTeam | null;
  sbTeamId: string | null;
  /** `10:00–15:00` once the clock is anchored. */
  matchClock: string | null;
  identities: VisionIdentityAssignment[];
};

export type VisionReviewMatch = {
  id: string;
  homeTeam: { id: string; name: string };
  awayTeam: { id: string; name: string };
};

export type VisionIdentityReview = {
  videoAssetId: string;
  matchId: string | null;
  match: VisionReviewMatch | null;
  proxy: { fps: number | null; sourceOffsetMs: number; durationMs: number | null; width: number | null; height: number | null } | null;
  publicOnly: boolean;
  clock: { anchored: boolean; anchors: VisionClockAnchor[] };
  sidesDecided: { inferenceJobId: string; team: "A" | "B"; sbTeamId: string }[];
  tracks: VisionReviewTrack[];
  count: number;
  /** The track run shown, or null for every run; and how many runs the footage has. */
  trackJobId: string | null;
  trackJobs: number;
  /** Every track the filter matches; `truncated` when this answer is short of them. */
  total: number;
  offset: number;
  limit: number;
  truncated: boolean;
};

export type VisionClockAnchor = { half: number; sourceMs: number; endMs: number | null; name?: string };

export type VisionClockReading = {
  videoAssetId: string;
  anchored: boolean;
  anchors: VisionClockAnchor[];
  at: { sourceMs: number; status: string; display: string; half?: number; minute?: number; second?: number } | null;
};

export function fetchVisionClock(assetId: string, sourceMs?: number) {
  return adminFetch<VisionClockReading>(`/vision/review/${assetId}/clock${sourceMs === undefined ? "" : `?sourceMs=${Math.round(sourceMs)}`}`);
}

export function anchorVisionClock(assetId: string, body: { half: number; sourceMs: number; endMs?: number }) {
  return adminFetch<VisionClockAnchor & { id: string }>(`/vision/review/${assetId}/clock`, { method: "POST", body: JSON.stringify(body) });
}

export type VisionReviewMedia = {
  url: string;
  fps: number | null;
  sourceOffsetMs: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  expiresInSeconds: number;
};

export type VisionRosterCandidate = {
  matchSquadPlayerId: string;
  playerId: string | null;
  name: string;
  jerseyNumber: number | null;
  position: string | null;
  isStarter: boolean;
  sbTeamId: string;
  sbTeamSquadId: string | null;
  onPitch: "yes" | "no" | "partly" | null;
};

export type VisionTrackCandidates = {
  trackId: string;
  matchId: string;
  side: "A" | "B" | null;
  sbTeamId: string | null;
  narrowedBy: "side" | "match";
  candidates: VisionRosterCandidate[];
  clock: string;
  /** The track's window on the match clock, once anchored, with what the clock removed. */
  window: { fromMinute: number; toMinute: number; display: string; substitutions: number; offPitch: number } | null;
};

/**
 * The asset's tracks for review: the latest track run unless `job` names another, or "all".
 * The public view is every run's accepted, named identities.
 */
export function fetchVisionIdentityReview(assetId: string, publicOnly = false, job?: string) {
  const which = job ? `job=${encodeURIComponent(job)}` : "";
  return adminFetch<VisionIdentityReview>(
    publicOnly ? `/vision/assets/${assetId}/identity?public=1` : `/vision/review/${assetId}/tracks${which ? `?${which}` : ""}`
  );
}

export function fetchVisionReviewMedia(assetId: string) {
  return adminFetch<VisionReviewMedia>(`/vision/review/${assetId}/media`);
}

export type VisionTrackPosition = {
  frameIndex: number;
  proxyTimeMs: number;
  sourceTimeMs: number;
  box: { x: number; y: number; width: number; height: number };
  confidence?: number;
};

/** Every track's positions for the asset's latest track run, by track id, in one request. */
export function fetchVisionAssetPositions(assetId: string) {
  return adminFetch<{ videoAssetId: string; trackJobId: string | null; trackJobs: number; positions: Record<string, VisionTrackPosition[]> }>(`/vision/review/${assetId}/positions`);
}

export function fetchVisionTrackPositions(trackId: string) {
  return adminFetch<{ trackId: string; localTrackId: number; key: string; trackerVersionId: string | null; positions: VisionTrackPosition[] }>(
    `/vision/review/tracks/${trackId}/positions`
  );
}

export type VisionGameStateChunk = { key: string; bytes: number | null; index: number | null; fromMs: number | null; toMs: number | null; url: string };

export type VisionGameState = {
  videoAssetId: string;
  job: { id: string; finishedAt: string | null } | null;
  trackJobId: string | null;
  pitch: { lengthM: number; widthM: number } | null;
  coverage: { rows: number | null; frames: number | null; placed: number | null; suppressed: number | null; reasons: Record<string, number>; validFrameCoverage: number | null; framesTracked?: number | null; coverageBasis?: string | null; chunkMs: number | null } | null;
  placedWith: { segments: number; calibrations: number; anchors: number } | null;
  index: { key: string; url: string } | null;
  chunks: VisionGameStateChunk[];
  expiresInSeconds?: number;
};

/** The latest game state: coverage, and a presigned URL per Parquet chunk the browser fetches itself. */
export function fetchVisionGameState(assetId: string) {
  return adminFetch<VisionGameState>(`/vision/review/${assetId}/game-state`);
}

export function fetchVisionTrackCandidates(trackId: string, wholeMatch = false) {
  return adminFetch<VisionTrackCandidates>(`/vision/review/tracks/${trackId}/candidates${wholeMatch ? "?all=1" : ""}`);
}

export function setVisionTeamSides(jobId: string, sides: { A: string; B: string; override?: boolean }) {
  return adminFetch<{ inferenceJobId: string; sides: Record<string, string>; decidedBy: string }>(
    `/vision/review/jobs/${jobId}/sides`,
    { method: "POST", body: JSON.stringify(sides) }
  );
}

export type AssignIdentityBody = {
  matchSquadPlayerId: string | null;
  validFromMs?: number;
  validToMs?: number;
  note?: string;
  propagateTo?: string[];
  acceptSideMismatch?: boolean;
};

export function assignVisionIdentity(trackId: string, body: AssignIdentityBody) {
  return adminFetch<{ assignment: VisionIdentityAssignment; propagated: VisionIdentityAssignment[]; sideCorrected: boolean }>(
    `/vision/review/tracks/${trackId}/identity`,
    { method: "POST", body: JSON.stringify(body) }
  );
}

export function acceptVisionIdentity(id: string) {
  return adminFetch<VisionIdentityAssignment>(`/vision/review/identity/${id}/accept`, { method: "POST", body: "{}" });
}

export function rejectVisionIdentity(id: string, reason: string) {
  return adminFetch<VisionIdentityAssignment>(`/vision/review/identity/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

// ── Calibration (Phase 5) ──────────────────────────────────────────────────

export type VisionPitchDimensions = { lengthM: number; widthM: number };
export type VisionPitchLandmark = { id: string; name: string; xM: number; yM: number };
export type VisionCalibrationPoint = { landmark: string; px: number; py: number; frameIndex?: number };
export type VisionCalibrationQuality = CalibrationQuality;
export type VisionOverlay = { id: string; points: { px: number; py: number }[] }[];

export type VisionCalibrationPreview =
  | {
      ok: true;
      pitch: VisionPitchDimensions;
      homography: number[];
      reprojectionErrorM: number;
      maxPointErrorM: number;
      reprojectionErrorPx: number;
      points: number;
      quality: VisionCalibrationQuality;
      thresholdsVersion: string;
      overlay: VisionOverlay;
      reprojected: { landmark: string; px: number; py: number; errorM: number }[];
    }
  | { ok: false; pitch: VisionPitchDimensions; reason: string; detail?: string };

export type VisionCalibrationSummary = {
  id: string;
  cameraSegmentId: string;
  pitch: VisionPitchDimensions;
  method: string;
  reprojectionErrorM: number;
  maxPointErrorM: number;
  reprojectionErrorPx: number;
  points: number;
  clicked: VisionCalibrationPoint[];
  quality: VisionCalibrationQuality;
  thresholdsVersion: string;
  decidedBy: string | null;
  createdAt: string;
};

export type VisionCameraSegment = {
  id: string;
  kind: string;
  source: "manual" | "scene_detect" | string;
  startMs: number;
  endMs: number;
  calibration: VisionCalibrationSummary | null;
  superseded: number;
};

export type VisionCameraSegments = {
  videoAssetId: string;
  durationMs: number | null;
  segments: VisionCameraSegment[];
  coverage: { segmentedMs: number; calibratedMs: number };
  thresholds: { version: string; goodRmseM: number; goodMinPoints: number; usableRmseM: number; maxPointErrorM: number };
};

export function fetchVisionCameraSegments(assetId: string) {
  return adminFetch<VisionCameraSegments>(`/vision/review/${assetId}/camera-segments`);
}

export function declareVisionCameraSegment(assetId: string, body: { startMs: number; endMs: number; kind: string }) {
  return adminFetch<VisionCameraSegment>(`/vision/review/${assetId}/camera-segments`, { method: "POST", body: JSON.stringify(body) });
}

export function removeVisionCameraSegment(segmentId: string) {
  return adminFetch<{ removed: string }>(`/vision/review/camera-segments/${segmentId}`, { method: "DELETE" });
}

export function fetchVisionPitchLandmarks(pitch?: VisionPitchDimensions) {
  const query = pitch ? `?lengthM=${pitch.lengthM}&widthM=${pitch.widthM}` : "";
  return adminFetch<{ pitch: VisionPitchDimensions; problem: string | null; landmarks: VisionPitchLandmark[] }>(`/vision/calibration/landmarks${query}`);
}

export function previewVisionCalibration(points: VisionCalibrationPoint[], pitch?: VisionPitchDimensions) {
  return adminFetch<VisionCalibrationPreview>(`/vision/calibration/preview`, { method: "POST", body: JSON.stringify({ points, pitch }) });
}

export function calibrateVisionSegment(segmentId: string, points: VisionCalibrationPoint[], pitch?: VisionPitchDimensions) {
  return adminFetch<VisionCalibrationSummary>(`/vision/review/camera-segments/${segmentId}/calibration`, { method: "POST", body: JSON.stringify({ points, pitch }) });
}

export type VisionJobRow = {
  id: string;
  type: string;
  resourceClass: string;
  state: string;
  priority: number;
  attemptNumber: number;
  maxAttempts: number;
  videoAssetId: string | null;
  queuedAt: string;
  claimedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  workerId: string | null;
  error: string | null;
};

/** The jobs of one asset, newest first, as the pipeline panel reads them. */
export function fetchVisionJobs(videoAssetId: string) {
  return adminFetch<{ jobs: VisionJobRow[] }>(`/vision/jobs?videoAssetId=${encodeURIComponent(videoAssetId)}`);
}

export function queueVisionJob(body: { type: string; videoAssetId: string; params?: Record<string, unknown> }) {
  return adminFetch<{ id: string }>(`/vision/jobs`, { method: "POST", body: JSON.stringify(body) });
}

// ── The Vision environment (docs/vision/47): every action the API offers, reachable from a page ──

export type VisionOverview = {
  enabled: boolean;
  partners: number;
  sources: number;
  assets: number;
  assetsReady: number;
  jobsQueued: number;
  jobsRunning: number;
  jobsFailed: number;
  workersActive: number;
  annotationOpen: number;
  candidatesUnreviewed: number;
  identitiesUnreviewed: number;
  /** Everything undecided, whoever proposed it; the queue itself leaves the reader's own out. */
  reviewQueue: number;
  datasets: number;
  models: number;
  modelsInProduction: number;
};

export function fetchVisionOverview() {
  return adminFetch<VisionOverview>("/vision/overview");
}

// Partners, evidence and signatories

export function createVisionPartner(body: { name: string; contactName?: string; contactEmail?: string; contactPhone?: string; notes?: string }) {
  return adminFetch<{ id: string; name: string }>("/vision/partners", { method: "POST", body: JSON.stringify(body) });
}

export function fetchVisionPartnerEvidence(partnerId: string) {
  return adminFetch<{ evidence: VisionEvidenceRow[] }>(`/vision/partners/${partnerId}/evidence`);
}

/** The document goes through the API as multipart: a browser cannot PUT to the master bucket. */
export function attachVisionEvidenceFile(partnerId: string, file: File, meta: { kind: string; documentDate?: string; notes?: string }) {
  const form = new FormData();
  form.append("file", file);
  form.append("kind", meta.kind);
  if (meta.documentDate) form.append("documentDate", meta.documentDate);
  if (meta.notes) form.append("notes", meta.notes);
  return adminFetch<{ evidenceId: string; key: string; bytes: number }>(`/vision/partners/${partnerId}/evidence/file`, { method: "POST", body: form });
}

export function addVisionSignatory(partnerId: string, body: { name: string; role: string; contactEmail?: string; contactPhone?: string }) {
  return adminFetch<{ id: string }>(`/vision/partners/${partnerId}/signatories`, { method: "POST", body: JSON.stringify(body) });
}

export function createVisionSource(body: {
  partnerId: string;
  title?: string;
  url?: string;
  sbMatchId?: string;
  sbCompetitionId?: string;
  sourceQualityRank: string;
  originalAvailable?: boolean;
  rightsOwnerName?: string;
  notes?: string;
}) {
  return adminFetch<{ id: string }>("/vision/sources", { method: "POST", body: JSON.stringify(body) });
}

// Footage

export type VisionAssetRow = {
  id: string;
  ingestState: string;
  ingestError: string | null;
  corpus: string;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  bytes: number | string | null;
  createdAt: string;
  sbMatchId: string | null;
  sourceVideoRecord: { id: string; title: string | null; partner: { id: string; name: string } } | null;
  sbMatch: { id: string; slug: string | null; homeTeam: { name: string }; awayTeam: { name: string } } | null;
  hasProxy: boolean;
  stages: { type: string; state: string; finishedAt: string | null; error: string | null }[];
  counts: { tracks: number; cameraSegments: number; eventCandidates: number };
};

function queryOf(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => Boolean(e[1]))).toString();
  return query ? `?${query}` : "";
}

export function fetchVisionAssets(params: { ingestState?: string; partnerId?: string; q?: string } = {}) {
  return adminFetch<{ assets: VisionAssetRow[] }>(`/vision/assets${queryOf(params)}`);
}

// Pipeline: jobs, the dispatcher, workers

export function fetchVisionAllJobs(params: { state?: string; type?: string; videoAssetId?: string } = {}) {
  return adminFetch<{ jobs: VisionJobRow[] }>(`/vision/jobs${queryOf(params)}`);
}

export function fetchVisionJobEvents(jobId: string) {
  return adminFetch<{ events: { id: string; kind: string; message: string | null; createdAt: string }[] }>(`/vision/jobs/${jobId}/events`);
}

export function retryVisionJob(jobId: string) {
  return adminFetch<unknown>(`/vision/jobs/${jobId}/retry`, { method: "POST" });
}

export function cancelVisionJob(jobId: string, reason: string) {
  return adminFetch<unknown>(`/vision/jobs/${jobId}/cancel`, { method: "POST", body: JSON.stringify({ reason }) });
}

export function fetchVisionQueueDepth() {
  return adminFetch<{ depth: unknown }>("/vision/jobs/queue-depth");
}

export type VisionDispatcherHealth = { dispatcherRunning: boolean; stats: Record<string, number>; oldestQueuedAgeSeconds: number | null; staleHeartbeats: number };

export function fetchVisionDispatcher() {
  return adminFetch<VisionDispatcherHealth>("/vision/jobs/dispatcher");
}

export function tickVisionDispatcher() {
  return adminFetch<{ requeued: string[]; failed: string[]; sessionsExpired: string[] }>("/vision/jobs/dispatcher/tick", { method: "POST" });
}

export type VisionWorkerRow = {
  id: string;
  providerId: string;
  providerRef: string | null;
  resourceClass: string;
  image: string;
  firstSeenAt: string;
  lastSeenAt: string;
  jobsCompleted: number;
  retiredAt: string | null;
  tokenExpiresAt: string;
};

export function fetchVisionWorkers() {
  return adminFetch<{ workers: VisionWorkerRow[] }>("/vision/workers");
}

export function provisionVisionWorker(body: { resourceClass: string; providerId?: string }) {
  return adminFetch<{ workerId: string; providerId: string; providerRef: string; resourceClass: string; image: string; bootstrapToken: string; bootstrapExpiresAt: string }>("/vision/workers/provision", { method: "POST", body: JSON.stringify(body) });
}

export function retireVisionWorker(workerId: string) {
  return adminFetch<unknown>(`/vision/workers/${workerId}/retire`, { method: "POST" });
}

// Datasets

export type VisionDatasetVersionRow = {
  id: string;
  label: string;
  description: string | null;
  labelSchemaVersionId: string | null;
  frozenAt: string | null;
  frozenBy: string | null;
  createdAt: string;
  _count: { members: number; modelVersions: number };
};

export function fetchVisionDatasets() {
  return adminFetch<{ versions: VisionDatasetVersionRow[] }>("/vision/datasets");
}

export function fetchVisionDataset(id: string) {
  return adminFetch<Record<string, unknown>>(`/vision/datasets/${id}`);
}

export function createVisionDataset(body: { label: string; description?: string; labelSchemaVersionId?: string }) {
  return adminFetch<{ id: string }>("/vision/datasets", { method: "POST", body: JSON.stringify(body) });
}

export function addVisionDatasetMembers(id: string, videoAssetIds: string[]) {
  return adminFetch<unknown>(`/vision/datasets/${id}/members`, { method: "POST", body: JSON.stringify({ videoAssetIds }) });
}

export function splitVisionDataset(id: string) {
  return adminFetch<unknown>(`/vision/datasets/${id}/splits`, { method: "POST" });
}

export function freezeVisionDataset(id: string) {
  return adminFetch<unknown>(`/vision/datasets/${id}/freeze`, { method: "POST" });
}

export function exportVisionDataset(id: string) {
  return adminFetch<unknown>(`/vision/datasets/${id}/export`, { method: "POST", body: JSON.stringify({}) });
}

export function fetchVisionDatasetLeakage(id: string) {
  return adminFetch<Record<string, unknown>>(`/vision/datasets/${id}/leakage`);
}

export function fetchVisionDatasetRepresentation(id: string) {
  return adminFetch<Record<string, unknown>>(`/vision/datasets/${id}/representation`);
}

// Models, benchmarks and promotion

export type VisionModelVersionRow = {
  id: string;
  version: string;
  stage: string;
  datasetVersionId: string | null;
  gitCommit: string;
  workerImage: string;
  weightsChecksum: string | null;
  promotedAt: string | null;
  createdAt: string;
  _count: { jobs: number };
  /** The promotion request waiting on a second person, if any. */
  pendingPromotion?: { id: string; fromStage: string; toStage: string; requestedBy: string; requestedByEmail: string | null; createdAt: string } | null;
};

export type VisionModelRow = { id: string; key: string; task: string; description: string | null; createdAt: string; versions: VisionModelVersionRow[] };

export function fetchVisionModels() {
  return adminFetch<{ models: VisionModelRow[] }>("/vision/models");
}

export function createVisionModel(body: { key: string; task: string; description?: string }) {
  return adminFetch<{ id: string }>("/vision/models", { method: "POST", body: JSON.stringify(body) });
}

export function registerVisionModelVersion(modelId: string, body: { version: string; gitCommit: string; configKey: string; workerImage: string; licenceNote: string; datasetVersionId?: string; weightsKey?: string; weightsChecksum?: string }) {
  return adminFetch<{ id: string }>(`/vision/models/${modelId}/versions`, { method: "POST", body: JSON.stringify(body) });
}

export function requestVisionBenchmark(versionId: string, datasetVersionId: string) {
  return adminFetch<unknown>(`/vision/models/versions/${versionId}/benchmark`, { method: "POST", body: JSON.stringify({ datasetVersionId }) });
}

export function fetchVisionBenchmarks(versionId: string) {
  return adminFetch<Record<string, unknown>>(`/vision/models/versions/${versionId}/benchmarks`);
}

export function requestVisionPromotion(versionId: string) {
  return adminFetch<unknown>(`/vision/models/versions/${versionId}/promotion-request`, { method: "POST" });
}

export function approveVisionPromotion(versionId: string, note?: string) {
  return adminFetch<unknown>(`/vision/models/versions/${versionId}/promote`, { method: "POST", body: JSON.stringify({ note }) });
}

export function rejectVisionPromotion(promotionId: string, reason: string) {
  return adminFetch<unknown>(`/vision/models/promotions/${promotionId}/reject`, { method: "POST", body: JSON.stringify({ reason }) });
}

export function rollbackVisionModel(versionId: string) {
  return adminFetch<unknown>(`/vision/models/versions/${versionId}/rollback`, { method: "POST" });
}

export function fetchVisionPromotions(versionId: string) {
  return adminFetch<Record<string, unknown>>(`/vision/models/versions/${versionId}/promotions`);
}

// Event candidates

export type VisionEventCandidate = {
  id: string;
  videoAssetId: string;
  sbMatchId: string | null;
  type: string;
  taxonomyVersion: string;
  startMs: number;
  endMs: number;
  actorTrackId: string | null;
  actorPlayerId: string | null;
  actorMatchSquadPlayerId: string | null;
  sbTeamId: string | null;
  confidence: number;
  method: string;
  cameraSegmentId: string | null;
  inPlay: boolean;
  reviewState: string;
  decidedBy: string;
  reviewedBy: string | null;
  reviewNote: string | null;
  note: string | null;
  promotedEventId: string | null;
  promotionKind: string | null;
  /** Promoted once, and the event it was promoted into has since left the match record. */
  promotionStale?: boolean;
  supersededBy: string | null;
  createdAt: string;
  matchClock: string | null;
  scoreboardType: string | null;
  promotable: boolean;
  evidence: { id: string; kind: string; targetId: string; note: string | null }[];
};

export function fetchVisionEventCandidates(assetId: string, all = false) {
  return adminFetch<{ videoAssetId: string; matchId: string | null; taxonomyVersion: string; clock: { anchored: boolean }; candidates: VisionEventCandidate[]; count: number }>(`/vision/review/${assetId}/events${all ? "?all=1" : ""}`);
}

export function proposeVisionEvent(body: { videoAssetId: string; type: string; startMs: number; endMs: number; actorTrackId?: string; actorMatchSquadPlayerId?: string; sbTeamId?: string; note?: string }) {
  return adminFetch<VisionEventCandidate>("/vision/review/events", { method: "POST", body: JSON.stringify(body) });
}

/** A correction: a new row superseding the old, unreviewed again. */
export function correctVisionEvent(id: string, changes: { type?: string; startMs?: number; endMs?: number; actorTrackId?: string | null; actorMatchSquadPlayerId?: string | null; sbTeamId?: string | null; note?: string }) {
  return adminFetch<VisionEventCandidate & { supersedes: string }>(`/vision/review/events/${id}`, { method: "PATCH", body: JSON.stringify(changes) });
}

export function decideVisionEvent(id: string, decision: "accepted" | "rejected", reason?: string) {
  return adminFetch<VisionEventCandidate>(`/vision/review/events/${id}/decision`, { method: "POST", body: JSON.stringify({ decision, reason }) });
}

export function promoteVisionEvent(id: string, create = false) {
  return adminFetch<VisionEventCandidate & { promotion: { kind: string; eventId: string; minute: number; second: number | null; minutesApart: number } }>(`/vision/review/events/${id}/promote`, { method: "POST", body: JSON.stringify({ create }) });
}

// The review queue: what a second person should look at next (docs/vision/49).

export type VisionReviewQueueItem = {
  kind: "event" | "identity";
  id: string;
  videoAssetId: string;
  /** The start of the item's window in source time: where the video opens. */
  sourceMs: number;
  decidedBy: string;
  createdAt: string;
  matchClock: string | null;
  asset: { title: string | null; match: string | null };
  slot: { name: string; jerseyNumber: number | null } | null;
  // event
  type?: string;
  startMs?: number;
  endMs?: number;
  actorTrackId?: string | null;
  // identity
  trackId?: string;
  localTrackId?: number;
  matchSquadPlayerId?: string | null;
  validFromMs?: number;
  validToMs?: number;
};

export type VisionReviewQueue = { me: string; waiting: { events: number; identities: number }; count: number; items: VisionReviewQueueItem[] };

export function fetchVisionReviewQueue(opts: { assetId?: string; limit?: number } = {}) {
  const q = new URLSearchParams();
  if (opts.assetId) q.set("assetId", opts.assetId);
  if (opts.limit) q.set("limit", String(opts.limit));
  const qs = q.toString();
  return adminFetch<VisionReviewQueue>(`/vision/review/queue${qs ? `?${qs}` : ""}`);
}
