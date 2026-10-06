# 73 — Phase 6 real-footage pilot

Prepared 5 October 2026. This is a run plan, not a completed evaluation.

**Pilot preparation executed:** [74](./74-LOCAL-PILOT-CLIP.md) records the real
clip, local fixture and reviewers, completed CPU ingestion, QA, and the remaining
hosted-compute/evaluation work. The key is now configured and authenticated;
the initial readiness observations below remain as history.

## Intake

Supply the following before registering or uploading footage:

- Full local path to one original match video.
- Full local path to the signed rights agreement PDF, or its existing Vision evidence ID.
- Competition, teams, match date, and existing ScoreBoard match ID if known.
- Team rosters and shirt numbers, as a file path or existing match squad records.
- Target: local development or staging, with the site's/API's URL if staging.
- Existing Vision source/asset ID if this footage was already uploaded.
- Two independent reviewers and their existing DTP account identifiers, if available.
- Maximum authorized pilot compute spend in USD. Zero means no paid compute.

Credentials stay in the configured environment. Agreement scopes, restrictions,
expiry and signatory authority are recorded from the supplied evidence, not
inferred from possession of the video. Existing records are checked before new
ones are created.

## Readiness findings

A read-only inspection of `services/api/.env` found nonblank entries for the
admin key, database URL, Vision enablement/storage settings, R2 credentials and
master/derived bucket names. Values were not printed. Presence does not establish
valid credentials, enabled services, reachable storage or staging readiness.

`VISION_RUNPOD_API_KEY` is missing or blank in that file. This does not establish
whether staging has credentials or whether local GPU compute is available.

The resumable upload CLI exists at `services/api/scripts/vision-upload.ts`.
It sends media directly to object storage, supports resuming a session, and
automatically queues probe/fingerprint after completion when analysis is allowed.
Its default destination is the local API; select the target explicitly.

The baseline detector is approved in the OSS register for S0/Phase 3 experiments,
not production. The existing FFmpeg clearance requires revisiting the register's
hosted-provider condition before sending its worker image to a GPU provider.

## Execution sequence

1. **Inspect the selected target.** Read health/status and existing match, source,
   rights, model and worker records. Confirm persistent storage and current CPU
   worker readiness. Do not run fixture-based QA gates against staging.
2. **Record the rights and match linkage.** Reuse existing partner/evidence records
   when suitable. Record the actual signatory and authorized scopes; authorize
   acquisition. Analysis requires `canAnalyze`; dataset membership follows the
   existing `canTrain` and corpus eligibility rules.
3. **Ingest one match.** Check local file existence, size and readability. Use the
   resumable CLI with an explicit source ID and API URL. Retain the upload session
   ID. QA the acquired asset, checksums, duration, probe and fingerprint findings.
4. **Build and inspect the proxy.** Queue transcode on a CPU worker. Verify playback,
   dimensions, frame rate, source/proxy time mapping and match linkage. Identify
   replay/non-play segments and anchor the match clock from the actual footage.
5. **Establish human reference events.** Start with a bounded clip containing clear
   events plus replay/occlusion examples. Each reviewer records event type, source
   start/end and actor independently. Resolve disagreements explicitly. The current
   event accept/reject workflow is usable, but it is not by itself a complete
   independent event-gold dataset or an event benchmark evaluator; those need work.
6. **Evaluate the approved experimental baseline.** Check compute availability,
   exact model/image provenance and the applicable licence conditions. Run a small
   sample first. Use authorized paid compute only within the stated ceiling and
   with a teardown plan; do not launch a provider merely because a key exists.
   Measure ball visibility, missed balls and false detections against human labels,
   separating footage quality from detector failures.
7. **Implement and QA the missing Phase 6 pipeline.** Add ball smoothing/lost state,
   possession candidates/segments, event proposal logic and the event scoring
   harness. Test against synthetic edge cases, then compare to human references.
   Suppress conclusions when evidence is insufficient.
8. **Report and decide the next run.** Report detection and event precision/recall,
   actor/timestamp accuracy, replay errors, correction effort and observed compute
   cost. Choose thresholds after baseline measurement. A one-match pilot informs
   feasibility; representative locked evaluation data is still needed to close
   the phase gate. Do not publish pilot-derived events automatically.

## Outputs to retain

Record the target, match/source/asset IDs, upload session ID, rights evidence and
scope IDs, worker/model/image versions, source/proxy mapping, clip selection,
independent labels and disagreement decisions, benchmark version, measurements,
failure examples, actual costs and remaining blockers. Store signed URLs and
tokens outside reports.

## Preparation QA

Upload behavior and paths were checked against the CLI; rights intake against
docs 07 and 14; evaluation requirements against docs 09 and 10; experimental
model and hosted-image limits against the OSS register. This preparation made no
database changes, uploaded no footage and launched no paid compute. Operational
readiness remains to be checked after intake identifies the target and files.
