# 05 — Object storage

## The interface

Domain code never sees Cloudflare. It sees this:

```ts
export interface ObjectStore {
  presignGet(bucket: BucketId, key: string, ttlSeconds: number): Promise<string>;
  presignPut(bucket: BucketId, key: string, ttlSeconds: number, opts?: PutConstraints): Promise<string>;

  createMultipartUpload(bucket: BucketId, key: string, mime: string): Promise<{ uploadId: string }>;
  presignUploadPart(bucket: BucketId, key: string, uploadId: string, partNumber: number, ttlSeconds: number): Promise<string>;
  completeMultipartUpload(bucket: BucketId, key: string, uploadId: string, parts: PartRef[]): Promise<{ etag: string }>;
  abortMultipartUpload(bucket: BucketId, key: string, uploadId: string): Promise<void>;

  head(bucket: BucketId, key: string): Promise<ObjectMeta | null>;
  list(bucket: BucketId, prefix: string, cursor?: string): Promise<ObjectPage>;
  delete(bucket: BucketId, key: string): Promise<void>;   // gated: see deletion policy
  copy(from: ObjectRef, to: ObjectRef): Promise<void>;
}

type BucketId = "master" | "derived" | "models" | "clips";
```

Implementations: `R2ObjectStore` (production, via the S3-compatible API) and
`InMemoryObjectStore` (tests). Nothing else imports an S3 or Cloudflare SDK.

`BucketId` is a logical name. The environment maps it to a real bucket, so staging and production
differ only in config.

---

## Buckets

Four, split by **access policy, retention and durability posture** — not by content type.

| `BucketId` | Real bucket | Contents | Versioning | Public read | Retention |
|---|---|---|---|---|---|
| `master` | `dtp-{env}-vision-master` | Source originals, rights evidence documents | **On** | Never | Indefinite; deletion only via `VisionDeletionRequest` |
| `derived` | `dtp-{env}-vision-derived` | Proxies, HLS, thumbnails, crops, inference artifacts, dataset manifests and labels, exports | Off | Never | Regenerable; lifecycle expiry on transient prefixes |
| `models` | `dtp-{env}-vision-models` | Weights, checkpoints, benchmark artifacts | **On** | Never | Indefinite; archived, never deleted |
| `clips` | `dtp-{env}-vision-clips` | Rendered evidence and highlight clips | Off | Never (signed only) | Tied to publication and rights state |

### Why four and not six or one

The HANDOFF specifies six buckets by content type; the PID specifies one bucket with prefixes.
Bucket boundaries should follow what is actually *configured per bucket* in R2: credentials,
lifecycle rules, versioning, and read posture.

- `master` versus `derived` is the biggest real difference. One is irreplaceable and immutable;
  the other is regenerable. Different versioning, different retention, different blast radius if
  a credential leaks.
- `models` is separate because ML engineers need write access there and nowhere else, and because
  weights must outlive any dataset or asset cleanup.
- `clips` is separate because it is the only bucket whose objects are routinely served outward
  (signed) and whose lifecycle is driven by publication and rights state rather than by storage economics.

Splitting `datasets` from `annotations`, as the HANDOFF does, produces no policy difference — both
are regenerable derived artifacts written by the same actors. They become prefixes.

### Mapping from the HANDOFF's six buckets

| HANDOFF bucket | Here |
|---|---|
| `dtp-raw-video` | `master/originals/...` |
| `dtp-datasets` | `derived/datasets/...` |
| `dtp-annotations` | `derived/datasets/{id}/labels/...` and `derived/annotations/...` |
| `dtp-models` | `models/...` |
| `dtp-generated-clips` | `clips/...` |
| `dtp-vision-results` | `derived/inference/...` |

Nothing is lost. If R2 later supports prefix-scoped credentials, collapsing further becomes
attractive — the key scheme below is designed so that would be a bucket rename, not a re-key.

---

## Key scheme

Deterministic, environment-safe, and derivable from database IDs alone. Never encode a
human-typed name, a title, or a date that might be corrected later.

```
master/
  originals/{videoAssetId}/source{ext}
  rights/{partnerId}/{evidenceId}{ext}

derived/
  probes/{videoAssetId}/ffprobe.json
  proxies/{videoAssetId}/proxy.mp4
  hls/{videoAssetId}/index.m3u8
  hls/{videoAssetId}/seg-%05d.ts
  thumbnails/{videoAssetId}/t-{ms}.jpg
  crops/{videoAssetId}/{trackId}/{ms}.jpg
  inference/{jobId}/{attempt}/detections.parquet
  inference/{jobId}/{attempt}/tracks.parquet
  inference/{jobId}/{attempt}/calibration.parquet
  inference/{jobId}/{attempt}/gamestate.parquet
  inference/{jobId}/{attempt}/summary.json
  datasets/{datasetVersionId}/manifest.json
  datasets/{datasetVersionId}/labels/{shard}.jsonl
  exports/{exportJobId}/...

models/
  {modelVersionId}/weights.pt
  {modelVersionId}/config.json
  {modelVersionId}/model-card.md
  {modelVersionId}/benchmarks/{benchmarkRunId}.json

clips/
  {clipId}/clip.mp4
  {clipId}/poster.jpg
```

Rules:

1. **UUIDs, not names.** A competition can be renamed; an object key cannot be.
2. **Attempt number in inference keys.** Retry writes to a new prefix. A retry never overwrites the
   output of a previous attempt, which is what makes retries safe and failures debuggable.
3. **Master keys are write-once.** A `PUT` to an existing `master/originals/...` key is a bug.
4. **No key is ever derived from user input.** All path components come from database IDs.

---

## Artifact granularity — a cost and performance rule

**Write few large objects, never one object per frame.**

A 90-minute match at 25 fps is roughly 135 000 frames. At 22 tracked objects per frame that is
about 3 million detections. Writing those as individual objects would mean:

- millions of Class A (write) operations, which cost more than the storage itself;
- a `list` operation that takes minutes;
- a worker that spends most of its wall-clock time on HTTP round trips rather than on the GPU.

So: dense per-frame output is **columnar Parquet**, one file per stage per job attempt, referenced
by key from Postgres. Crops are the one justified exception — they are reviewed individually — and
even there, crops are written only for tracks that reach the review queue, not for every track.

R2 charges no egress, which is precisely why it was chosen: the worker reads the proxy on every
job without a bandwidth bill. Operations still cost money. Design for few, large, sequential
reads and writes.

---

## Resumable upload

Nigerian connectivity is the binding constraint, not R2. A 6 GB master file over an unstable link
will be interrupted. If an interruption restarts the upload from zero, partners stop uploading and
the corpus never gets built.

Concrete parameters — this is a spec, not an aspiration:

| Parameter | Value | Reason |
|---|---|---|
| Part size | 16 MiB | Small enough that a lost part is cheap to retry; large enough to keep part counts sane for a 6 GB file (~375 parts) |
| Part retry | 5 attempts, exponential backoff with jitter | Transient mobile-network failures |
| Part URL TTL | 15 minutes, re-requestable | A URL expiring mid-upload must not kill the session |
| Session TTL | 7 days | A partner may upload across several days |
| Session state | `VisionUploadSession` in Postgres: key, uploadId, received parts with ETags, bytes | Resume is a server-side fact, not browser state |
| Resume behaviour | Client asks `GET /uploads/{id}` for received parts, uploads only what is missing | Survives a closed browser, a new device, a reboot |
| Integrity | SHA-256 computed client-side where feasible; authoritative checksum computed by the worker on first read | Client checksums are a hint, not proof |

**Required test:** an integration test that uploads a multi-part file, kills the connection
mid-stream, and resumes to a successful `complete` with a matching checksum. This test is the
phase gate for Phase 1, not a nice-to-have.

The control plane issues part URLs; the bytes go browser-to-R2. EC2 never sees them.

---

## Lifecycle and retention

| Prefix | Rule |
|---|---|
| `master/originals/` | No expiry. Versioning on. Deletion only through an approved `VisionDeletionRequest`. |
| `master/rights/` | No expiry. This is the evidence that everything else stands on. |
| `derived/probes/`, `derived/thumbnails/` | Cheap; keep. |
| `derived/proxies/`, `derived/hls/` | Keep while the asset is active. Regenerable from master if evicted. |
| `derived/inference/{jobId}/` | Keep the attempt referenced by a successful job. Failed attempts expire after 30 days. |
| `derived/crops/` | Expire 90 days after the owning track leaves the review queue. |
| `derived/exports/` | Expire after 30 days. Always regenerable. |
| `derived/datasets/` | **No expiry.** A dataset manifest is part of reproducibility. |
| `models/` | No expiry. Archived stages stay readable. |
| `clips/` | Retained while published or pending review; expire 180 days after rejection. |

`ObjectStore.delete` is gated: the Vision module exposes no unrestricted delete path. Deletions
go through a service that checks the deletion policy, records an audit entry, and refuses on
`master/` unless an approved deletion request exists.

---

## Access model

Nobody and nothing holds standing credentials to these buckets except the control plane.

| Actor | Access |
|---|---|
| Browser (admin) | Short-lived signed GET for playback; signed part PUTs for upload. Rights-checked at issue. |
| Browser (partner, via grant) | Signed part PUTs for exactly one key. Nothing else. |
| Worker | Signed GET for its declared inputs. For outputs, it calls `POST /vision/worker/jobs/{id}/presign` per key; the control plane validates the key is under that job's `outputPrefix` and refuses otherwise. |
| Control plane | The only holder of R2 API credentials, from AWS Secrets Manager. |
| Scout / public | Signed GET on `clips/` only, for published, rights-cleared clips, issued per request. |

Worker output presigning is the important one. Handing ephemeral third-party GPU hardware a
long-lived R2 key means a compromised or misconfigured pod can read or overwrite the entire
corpus. Per-key presigning with server-side prefix validation removes that possibility entirely,
at the cost of one cheap API call per output file — and there are only a handful per job because
of the Parquet rule above.

---

## Configuration

```
VISION_R2_ACCOUNT_ID=
VISION_R2_ACCESS_KEY_ID=
VISION_R2_SECRET_ACCESS_KEY=
VISION_R2_ENDPOINT=
VISION_R2_BUCKET_MASTER=dtp-staging-vision-master
VISION_R2_BUCKET_DERIVED=dtp-staging-vision-derived
VISION_R2_BUCKET_MODELS=dtp-staging-vision-models
VISION_R2_BUCKET_CLIPS=dtp-staging-vision-clips
VISION_SIGNED_URL_TTL_PLAYBACK_SECONDS=300
VISION_SIGNED_URL_TTL_PART_SECONDS=900
VISION_UPLOAD_PART_BYTES=16777216
VISION_UPLOAD_SESSION_TTL_HOURS=168
```

Credentials come from AWS Secrets Manager (`dtp/{env}/vision`), following the existing deployment
pattern in `infra/DEPLOYMENT.md`. Config is validated at boot: a missing or malformed R2 setting
fails startup loudly rather than at the first upload.
