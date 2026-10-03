# 53 — QA fix 3: the job protocol

PR-3 of the fix plan in [50](./50-QA-PHASES-1-6.md) §3. It covers critical C2, the
queue races and input findings in appendix A, and the worker-loop findings in
appendix C.

---

## The proxy is where transcode wrote it (C2)

Transcode writes the proxy under its own job's output prefix
(`inference/<job>/<attempt>/proxy.mp4`) and records it as a `proxy` variant. The
worker's `proxy` input role resolved to `visionKeys.proxy(asset.id)`, a fixed key
that nothing writes. So every stage after transcode (cuts, detect, identify) was
handed a URL to an object that did not exist.

`input-url` now resolves the role to the asset's newest proxy variant (`orderBy
createdAt desc`, as `proxyClock` already did). With no proxy, it refuses with
`409 ProxyNotTranscoded` and a remedy.

**Proven against the real worker.** `vision:e2echeck` used to stop after transcode,
which is why nothing showed the bug. It now runs `cuts` as a third stage, and cuts
reads the proxy by role. With the fix the check passes 38/38. With the old fixed key
put back, the API reloaded and the same run failed `cuts … expected succeeded, got
failed`. The fix was then restored.

## Every queue transition is conditional

`markRunning`, `heartbeat`, `succeed`, `fail` and `cancel` read the row and then wrote
it unconditionally. A stale worker, or the reaper working from a list it read a moment
earlier, could overwrite a job that had moved on. Worse, the holder of a succeeded job
could `fail` it into a requeue, so its stage results were applied twice.

Each is now one `updateMany`:

- The holder and an active state (`claimed`, `running`) are in its `WHERE`. For `fail`
  the attempt number is too, so a requeue in between makes the update miss.
- `fail` refuses a job that is no longer active, even when the caller is its holder.
- The reaper passes the claim it judged (worker and `claimedAt`). A job requeued and
  re-claimed between its read and its write is left alone, as is one that succeeded
  meanwhile.
- When nothing matched, the row is read once, only to say why.
- A concurrent retry of the same completion that landed first is still recognised as
  `alreadyApplied`.

## An automatic requeue gets its own prefix

`retry()` already gave a manual retry `inferencePrefix(job, attempt + 1)`. The
automatic requeue in `fail` incremented the attempt and kept attempt 1's prefix, so
attempt 2 overwrote attempt 1's artifacts. It now sets the new attempt's prefix.

## Refusals a worker can read

`JobNotClaimableError` and `JobNotHeldByWorkerError` were plain `Error`s, so every
lost-job case reached the worker as a 500. They are now a `409 JobNotClaimable` and a
`403 JobNotHeldByWorker`, each with the refusal shape and a remedy.

## What a caller and a worker may name

- **Reserved inputs.** `enqueueForAsset` spread the caller's `params` after
  `videoAssetId`, and on stages that declare no inputs of their own it kept a
  caller's `readKeys`. That became the list of objects the worker may presign, any
  derived or models object. Caller params now go first and lose `videoAssetId`,
  `proxy`, `readKeys`, `detections`, `tracks`, `segments` and `anchors`.
  `enqueueDetached` is reachable only from the benchmark service.
- **Artifact bucket.** `complete` now refuses an artifact whose reported bucket is
  not the job type's output bucket. Presign only ever wrote there, and the
  projections select by bucket.
- **Identify's track job.** `applyIdentify` trusted the worker's
  `summary.trackJobId`. It must now equal the `tracks.jobId` the job was dispatched
  with, or nothing is applied.

## The worker loop

- **Claim failures count toward idle.** A claim that raised used to sleep and
  `continue` without advancing `idle_since`, so a GPU pod whose claims kept failing
  ran, and billed, for ever. A failed claim now counts as an empty one. Backoff
  doubles per consecutive failure up to a minute, with jitter.
- **A refused claim stops the worker.** A 400, 401 or 403 (expired or revoked token,
  refused contract) will not fix itself, and since [51](./51-QA-FIX-1-SECRETS.md) a
  worker token cannot re-register. The worker exits, and the supervisor (the box's
  restart policy, or a provider) provisions afresh.
- **`fail` never raises.** It was called unguarded inside `except`, so a network blip
  while reporting a failure exited the worker. It now retries network errors and
  5xx with backoff, then logs and returns.
- **`complete` is retried** on network errors and 5xx. The idempotency key makes a
  repeat safe, and a dropped connection after the uploads no longer re-runs the whole
  job. A 4xx is an answer and is not retried.
- **A heartbeat refused with 403, 404, 409 or 410 means the job is gone.** It was
  expired, cancelled, over budget or reassigned. The reporter records it, and the
  stage stops at its next `progress.set`. The job is abandoned, not failed: it is no
  longer the worker's to report on.
- **Presigned URLs are redacted.** `download` and `upload` raised httpx errors whose
  message held the full URL, signature included, and that message went to the log and
  into the job's stored error. Errors now name the object with `?<redacted>` for the
  query, and `fail` redacts any URL left in its detail.
- **The server's heartbeat interval is adopted.** `register` returns
  `heartbeatIntervalSeconds`. The worker beats at the tighter of that and its own, so
  the control plane's reaper never sees it late.

## Tests and checks

| Check | Result |
|---|---|
| `postgres-job-queue.spec.ts` (new, 13) | the WHERE of every transition; a stale worker and a finished job refused; a succeeded job never requeued; the requeue's prefix; the reaper leaving alone a job that moved on. Mutations: drop the reaper's `expect` → fails; drop the requeue prefix → fails |
| Controller | the proxy role reads the newest variant and refuses with no proxy; a misfiled artifact bucket refused |
| Inputs | forged `readKeys`, `videoAssetId` and `tracks` on a detect job are dropped; identify refuses a track job it was not dispatched with |
| API vision suite | 762 passed; typecheck clean |
| `test_control_plane.py` (new, 14) | redaction; `fail` never raises; `complete` retried through a drop and a 503 but not a 409; heartbeat 403/404/409/410 → lost; a lost job abandoned, not failed; server interval adopted; a 401 claim stops the loop; failing claims reach idle shutdown. Mutations: no fatal statuses → fails; failed claims skip idle → fails |
| Worker pytest | 273 passed |
| `vision:e2echeck` (real worker image built from this branch, 6 s clip) | 38/38 with the fix; 37/38 with the old fixed key |
| `vision:jobcheck` ×2, `trackcheck`, `identitycheck`, `gamestatecheck`, `cutscheck`, `eventcheck`, `promotioncheck` | all pass |
| `db:purge:gate-litter` | nothing to delete |

**Three stale gate expectations, not caused by this PR.** `vision:teamcheck` expects
an abstaining kit to name no colour. Since doc 37 the clustering records the nearest
side even when it abstains, so the check fails. `vision:benchcheck` expects a tracker
to be refused as `ModelTaskUnsupported`, but trackers have been benchmarkable since
doc 33. It also reads `params.detections`, renamed `predictions` at the same time.
None of those code paths changed here. The gates were last edited before the
behaviour moved, and nothing in CI runs them, which is appendix E's point. They are
fixed in PR-11.

## What is not done

| | |
|---|---|
| **A worker token refresh** | Doc 06 calls the worker token refreshable; nothing refreshes it. A worker past its 12 h exits and is reprovisioned instead. |
| **Source reads limited to ingest stages, and audited** | PR-4, with the other rights findings. |
