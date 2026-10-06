# 74 — Local Phase 6 pilot: a real clip and the faults it exposed

5 October 2026. Ingestion and local review readiness are verified; model/event
accuracy and the full phase gate are not.

## What was supplied and verified

The pilot is a 49.706-second clip of 36 Lion FC vs FC Bethel Sporting, Jagaban Cup
2026, 22 May 2026. The original is 1920 × 1080 H.264 at 50 fps with AAC audio,
106,419,388 bytes. It is not a full-match video.

The supplied two-page agreement was text-extracted and both pages inspected
visually. It names the 2026 tournament, is signed by Joshua Olaegbe and Afolabi
Sanni, takes effect on 1 May 2026, and expressly includes model training and
evaluation. The pilot records analysis and training scopes only; public
publication and scout sharing remain disabled.

The existing local ScoreBoard fixture was reused, including its 52 match-squad
entries. Its match ID is a legacy text identifier. No fixture or roster was
replaced. The database is IPv6 localhost (`[::1]`), not a hosted database.

## Ingestion result

| Item | Result |
|---|---|
| Source ID | `d6760156-5f35-4069-9425-ef4fd15a2bc9` |
| Asset ID | `c89444b0-2b9b-4af4-a616-ff29b9dc75a8` |
| Master SHA-256 | `036859090046161601e31748c6db23cf4b6826830d13e305356bbc52c45902c8` |
| Resumable upload | 13 parts; completed; stored checksum independently matches the local file |
| Probe / fingerprint / transcode | All succeeded on local CPU capacity |
| Source / asset state | `acquired` / `ready` |
| Proxy | 1280 × 720 H.264, constant 25 fps, 49.760 seconds, 11,650,674 bytes |
| Source offset | 0 ms into the supplied clip; match-clock placement remains unknown |
| Worker | Current source built locally; exact image `sha256:21a5e9ed7c5d1045718322f5c92e7a9e7996dfacea6efc0489e30df1ee6632f4` |
| Capacity cleanup | Both local worker identities retired after processing; no hosted pod launched |

The API and database are local. Storage uses the already configured R2 buckets,
whose names include staging, with new UUID-based object keys for this pilot.
Existing footage was not overwritten. This is not an offline storage deployment.

## Three fixes found by using real footage

**Match linking.** `CreateSourceDto.sbMatchId` required a UUID although ScoreBoard
stores text identifiers, including this legacy fixture. It now accepts a bounded
string and checks that the match exists before inserting the source. A supplied
competition must match the fixture's competition. Vision-owned UUID fields retain
their existing validation. Unknown or mismatched references get structured
refusals rather than relying on a database error.

**Third-party request logs.** The worker already redacted URLs in its own errors,
but `httpx` logged complete signed URLs at INFO level. A formatter now sanitizes
every output handler, including third-party records and exception tracebacks,
and emits valid JSON with quotes and newlines escaped. The rebuilt worker's real
transcode logs were checked: all lines parse as JSON, and none contain signed
credential/signature query fields. The previous task-created container was removed.

**The padded proxy tail.** The CFR proxy is 54 ms longer than the source. The
review media response now includes nullable `sourceDurationMs`. Draggable
boundaries stop at the original's limit and snap in proxy time before adding the
offset. At this clip's end, the last admissible 25 fps frame is 49.680 seconds;
the extra proxy tail cannot become a stored event boundary.

No migration, model, worker contract version or public ScoreBoard event changed.

## Reviewer handoff

The two user-approved independent reviewers have local `vision_reviewer` accounts.
Their generated passwords are in `services/api/.env.vision-pilot-access.json`,
which is git-ignored. No passwords or JWTs were printed in the report or QA output,
and no email was sent. Read-only QA authenticated both accounts independently and
checked proxy access, match-linked review and the review queue. No judgement was
submitted on either person's behalf.

Open the clip at:

`http://localhost:5173/admin/vision/workstation/identity/c89444b0-2b9b-4af4-a616-ff29b9dc75a8`

The browser login page was inspected. Interactive playback and boundary dragging
in a signed-in browser remain to be checked; authenticated HTTP playback, actual
proxy decoding and a representative decoded frame were verified separately.

The local API runs with a pilot process profile, not edited main credentials:

```
rtk proxy pnpm --filter @dtp/api exec node -r @swc-node/register .env.vision-pilot-api.cjs
rtk proxy pnpm --filter @dtp/web dev
```

The ignored profile selects local capacity, the exact CPU image tag, and 400-cent
application job/monthly budgets. These settings are **not a provider billing cap**.
Private pilot state and resumable session IDs are retained in the ignored
`services/api/.env.vision-pilot-state.json`. Temporary renders and pytest files
are ignored, too.

## QA evidence

| Check | Result |
|---|---|
| Full API suite after match-link fix | 1,571 tests passed |
| Final identity/source tests after duration addition | 45 passed |
| Final web suite | 231 passed |
| Full worker suite after log formatter fix | 335 passed |
| API / web production builds | Passed |
| Anonymous media access | Refused with 401 |
| Both approved reviewers | Login, media, linked review and queue passed |
| Uploaded master | SHA-256 matches original local bytes |
| Proxy | Downloaded, independently probed, and a frame decoded and visually inspected |
| Real worker logs | Valid JSON; signed query credentials absent |
| Git whitespace check / private access-file ignore | Passed |

## Remaining work before evaluation

- Confirm the intended clip and its position on the match clock; a full match is
  needed for full-match processing/cost claims and representative event coverage.
- Collect independent human event labels. No gold events or accuracy measurements
  have been created by this preparation.
- Connect hosted compute to the local control plane safely. The current provision
  controller supplies a relative callback URL; a hosted worker needs a reachable
  absolute callback and a pullable image. The existing untested hosted path was
  not used to launch a billable pod.
- Establish provider-side monitoring and teardown within the authorized **$4 total
  pilot compute limit** before launching. Actual hosted compute spend so far is
  **$0**; a read-only RunPod list request returned 200 with zero existing pods.
- Run and evaluate the approved experimental detector. Automatic possession and
  events, production detector clearance, and the Phase 6 real-footage gate remain
  separate unfinished work.
