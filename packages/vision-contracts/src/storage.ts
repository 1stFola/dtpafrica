/**
 * Object storage contracts: logical buckets and the deterministic key scheme.
 *
 * See docs/vision/05-STORAGE.md. Keys are derived from database IDs only —
 * never from a human-typed name, title or date, because those get corrected and
 * an object key cannot be.
 */

/**
 * Logical buckets, split by access and retention policy rather than by content
 * type. The environment maps each to a real bucket name.
 */
export const BUCKET_IDS = ["master", "derived", "models", "clips"] as const;
export type BucketId = (typeof BUCKET_IDS)[number];

/** Buckets whose objects are write-once. A PUT over an existing key is a bug. */
export const WRITE_ONCE_BUCKETS: readonly BucketId[] = ["master"];

/**
 * Buckets whose contents cannot be regenerated if lost.
 *
 * Originally `VERSIONED_BUCKETS`, on the assumption that the object store would
 * keep version history for them. The chosen backend does not implement bucket
 * versioning at all, so there is nothing to fall back on: the write-once and
 * protected-delete guards in the ObjectStore adapters are the only protection
 * these objects have.
 *
 * Which backend, and the evidence, is recorded in docs/vision/05-STORAGE.md —
 * naming it here would couple the contracts to a vendor, which
 * vision-boundaries.spec.ts asserts against.
 */
export const IRREPLACEABLE_BUCKETS: readonly BucketId[] = ["master", "models"];

export class InvalidObjectKeySegmentError extends Error {
  constructor(segment: string) {
    super(
      `Unsafe object key segment ${JSON.stringify(segment)}: expected 1-64 chars of [A-Za-z0-9._-]`
    );
    this.name = "InvalidObjectKeySegmentError";
  }
}

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * Guards every interpolated path component.
 *
 * Keys are built from IDs, but a caller can still pass a user-supplied string by
 * mistake. This refuses anything that could traverse (`..`, `/`) or that is
 * simply not an identifier.
 */
export function assertSafeKeySegment(segment: string): string {
  if (!SAFE_SEGMENT.test(segment) || segment.includes("..")) {
    throw new InvalidObjectKeySegmentError(segment);
  }
  return segment;
}

/** File extension, normalised to lower case with a single leading dot. */
export function normaliseExtension(ext: string): string {
  const trimmed = ext.trim().replace(/^\.+/, "").toLowerCase();
  if (!/^[a-z0-9]{1,8}$/.test(trimmed)) {
    throw new InvalidObjectKeySegmentError(ext);
  }
  return `.${trimmed}`;
}

export type ObjectRef = { bucket: BucketId; key: string };

/**
 * The canonical key scheme. Every producer and consumer of an object goes
 * through here, so a layout change is one edit rather than a grep.
 */
export const visionKeys = {
  // ── master ────────────────────────────────────────────────────────────────
  sourceOriginal(videoAssetId: string, extension: string): ObjectRef {
    return {
      bucket: "master",
      key: `originals/${assertSafeKeySegment(videoAssetId)}/source${normaliseExtension(extension)}`,
    };
  },

  rightsEvidence(partnerId: string, evidenceId: string, extension: string): ObjectRef {
    return {
      bucket: "master",
      key: `rights/${assertSafeKeySegment(partnerId)}/${assertSafeKeySegment(evidenceId)}${normaliseExtension(extension)}`,
    };
  },

  // ── derived ───────────────────────────────────────────────────────────────
  probe(videoAssetId: string): ObjectRef {
    return { bucket: "derived", key: `probes/${assertSafeKeySegment(videoAssetId)}/ffprobe.json` };
  },

  proxy(videoAssetId: string): ObjectRef {
    return { bucket: "derived", key: `proxies/${assertSafeKeySegment(videoAssetId)}/proxy.mp4` };
  },

  hlsIndex(videoAssetId: string): ObjectRef {
    return { bucket: "derived", key: `hls/${assertSafeKeySegment(videoAssetId)}/index.m3u8` };
  },

  hlsPrefix(videoAssetId: string): string {
    return `hls/${assertSafeKeySegment(videoAssetId)}/`;
  },

  thumbnail(videoAssetId: string, atMs: number): ObjectRef {
    return {
      bucket: "derived",
      key: `thumbnails/${assertSafeKeySegment(videoAssetId)}/t-${assertNonNegativeInt(atMs)}.jpg`,
    };
  },

  crop(videoAssetId: string, trackId: string, atMs: number): ObjectRef {
    return {
      bucket: "derived",
      key: `crops/${assertSafeKeySegment(videoAssetId)}/${assertSafeKeySegment(trackId)}/${assertNonNegativeInt(atMs)}.jpg`,
    };
  },

  /**
   * Inference output prefix, scoped by attempt.
   *
   * The attempt number is what makes retries safe: a retry writes to a new
   * prefix and never overwrites a previous attempt's output.
   */
  inferencePrefix(jobId: string, attempt: number): string {
    return `inference/${assertSafeKeySegment(jobId)}/${assertPositiveInt(attempt)}/`;
  },

  inferenceArtifact(jobId: string, attempt: number, filename: string): ObjectRef {
    return {
      bucket: "derived",
      key: `${visionKeys.inferencePrefix(jobId, attempt)}${assertSafeKeySegment(filename)}`,
    };
  },

  datasetManifest(datasetVersionId: string): ObjectRef {
    return {
      bucket: "derived",
      key: `datasets/${assertSafeKeySegment(datasetVersionId)}/manifest.json`,
    };
  },

  /**
   * One annotator's submitted labels.
   *
   * Keyed by version, never by task, because a submission is superseded and never
   * overwritten — the corrections are the most valuable data DTP generates, and a
   * task-keyed path would quietly destroy them on every resubmission.
   */
  annotationPayload(taskId: string, annotationVersionId: string): ObjectRef {
    return {
      bucket: "derived",
      key: `annotations/${assertSafeKeySegment(taskId)}/${assertSafeKeySegment(annotationVersionId)}.json`,
    };
  },

  datasetLabels(datasetVersionId: string, shard: string): ObjectRef {
    return {
      bucket: "derived",
      key: `datasets/${assertSafeKeySegment(datasetVersionId)}/labels/${assertSafeKeySegment(shard)}.jsonl`,
    };
  },

  exportPrefix(exportJobId: string): string {
    return `exports/${assertSafeKeySegment(exportJobId)}/`;
  },

  // ── models ────────────────────────────────────────────────────────────────
  modelWeights(modelVersionId: string): ObjectRef {
    return { bucket: "models", key: `${assertSafeKeySegment(modelVersionId)}/weights.pt` };
  },

  modelConfig(modelVersionId: string): ObjectRef {
    return { bucket: "models", key: `${assertSafeKeySegment(modelVersionId)}/config.json` };
  },

  modelCard(modelVersionId: string): ObjectRef {
    return { bucket: "models", key: `${assertSafeKeySegment(modelVersionId)}/model-card.md` };
  },

  benchmarkResult(modelVersionId: string, benchmarkRunId: string): ObjectRef {
    return {
      bucket: "models",
      key: `${assertSafeKeySegment(modelVersionId)}/benchmarks/${assertSafeKeySegment(benchmarkRunId)}.json`,
    };
  },

  // ── clips ─────────────────────────────────────────────────────────────────
  clip(clipId: string): ObjectRef {
    return { bucket: "clips", key: `${assertSafeKeySegment(clipId)}/clip.mp4` };
  },

  clipPoster(clipId: string): ObjectRef {
    return { bucket: "clips", key: `${assertSafeKeySegment(clipId)}/poster.jpg` };
  },
} as const;

function assertNonNegativeInt(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new InvalidObjectKeySegmentError(String(value));
  }
  return value;
}

function assertPositiveInt(value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new InvalidObjectKeySegmentError(String(value));
  }
  return value;
}

/**
 * Whether a key falls under a prefix, for validating a worker's requested write
 * location against the prefix its job was granted.
 *
 * Rejects traversal rather than normalising it: a worker asking to write
 * `inference/x/1/../../../master` is not a path to clean up, it is a signal.
 */
export function isKeyUnderPrefix(key: string, prefix: string): boolean {
  if (key.includes("..") || key.startsWith("/")) return false;
  if (!prefix.endsWith("/")) return false;
  return key.startsWith(prefix) && key.length > prefix.length;
}
