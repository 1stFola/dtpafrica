import { adminFetch } from "./admin";

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

/** Claims the next task atomically; `task` is null when the queue is empty. */
export function claimVisionTask(annotatorId: string, samplingStrategy?: SamplingStrategy) {
  return adminFetch<{ task: VisionAnnotationTask | null; media?: VisionTaskMedia }>(
    "/vision/annotation/tasks/claim",
    {
      method: "POST",
      body: JSON.stringify({ annotatorId, ...(samplingStrategy ? { samplingStrategy } : {}) }),
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
  sidesDecided: { inferenceJobId: string; team: "A" | "B"; sbTeamId: string }[];
  tracks: VisionReviewTrack[];
  count: number;
};

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
};

export type VisionTrackCandidates = {
  trackId: string;
  matchId: string;
  side: "A" | "B" | null;
  sbTeamId: string | null;
  narrowedBy: "side" | "match";
  candidates: VisionRosterCandidate[];
  clock: string;
};

export function fetchVisionIdentityReview(assetId: string, publicOnly = false) {
  return adminFetch<VisionIdentityReview>(
    publicOnly ? `/vision/assets/${assetId}/identity?public=1` : `/vision/review/${assetId}/tracks`
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

export function fetchVisionTrackPositions(trackId: string) {
  return adminFetch<{ trackId: string; localTrackId: number; key: string; trackerVersionId: string | null; positions: VisionTrackPosition[] }>(
    `/vision/review/tracks/${trackId}/positions`
  );
}

export function fetchVisionTrackCandidates(trackId: string, wholeMatch = false) {
  return adminFetch<VisionTrackCandidates>(`/vision/review/tracks/${trackId}/candidates${wholeMatch ? "?all=1" : ""}`);
}

export function setVisionTeamSides(jobId: string, sides: { A: string; B: string }) {
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
export type VisionCalibrationQuality = "good" | "usable" | "failed";
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

export function queueVisionJob(body: { type: string; videoAssetId: string; params?: Record<string, unknown> }) {
  return adminFetch<{ id: string }>(`/vision/jobs`, { method: "POST", body: JSON.stringify(body) });
}
