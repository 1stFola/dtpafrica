# 60 — QA fix 10: performance and indexes

PR-10 of the fix plan in [50](./50-QA-PHASES-1-6.md) §3. It covers the performance
findings in appendices A, B, D and E. The contract version stays `1.12.0`. There is one
migration, of indexes only.

Nothing here changes an answer. Each change makes the same answer cost fewer queries, or
makes an answer that was silently cut short say so.

---

## Training rights, asked once

`canTrain` reads three things for one asset: the asset, its source record, its grants.
Three callers asked it about one asset at a time, in sequence, inside one request:

| Caller | Was | Now |
|---|---|---|
| Adding members to a dataset | a read of the asset and a rights check per asset | one read of the assets, one batched check |
| Freezing a dataset | a rights check per member | one batched check |
| The promotion gate | a rights check per member, and the gate runs twice | one batched check per run |

A dataset of 500 matches was about 1,500 round trips to freeze. It is now two queries.

`canTrainMany(ids)` loads the assets, then every grant of their partners and source
records, and gives each asset the rows its own query would have returned. The decision is
the same function `canTrain` uses (`decideFrom`); only the loading is batched. The test
puts nine assets through both and requires the same answer for each, covering every kind
of answer: allowed, a narrower grant that says no, not acquired, research corpus, another
partner's grant, revoked, restricted, no record, no such asset.

## The review queue

The queue read every undecided event candidate and every undecided identity window, with
no limit, dropped the reader's own in memory, cut to the limit, and then asked for the
clock anchors of each asset in the page with one query apiece.

- "Not mine" (`decidedBy <> me`) and the limit are in the two queries. The oldest N of both
  kinds together are among the oldest N of each, so taking N of each loses nothing.
- The depth (`waiting`) is two counts. It was the length of the lists.
- With no footage named, the identity query no longer joins the track table.
- The anchors of every asset in the page come from one query (`currentAnchorsFor`).

The response is unchanged. `vision:eventcheck` exercises the queue as four different
people and with `limit=1`, and passes unchanged.

## An asset's tracks, for review

`GET /vision/review/:assetId/tracks` returned the first 2,000 tracks of every track run
mixed together, and reported the number it returned as the count. On a re-run asset half
of them were the older run's. For the public view it filtered to tracks with an accepted
name *after* the cut, so a name past the first 2,000 rows was dropped without a word.

| Now | |
|---|---|
| Which run | the latest track run by default. `?job=all` for every run, `?job=<id>` for one. The public view (`/vision/assets/:id/identity?public=1`) is every run: an accepted identity is a person's decision, and a re-run does not withdraw it |
| Paging | `?limit=` (default 2,000, at most 5,000) and `?offset=`, ordered by start time |
| What it says | `total`, `truncated`, `trackJobId` (null for every run) and `trackJobs`, beside `count` |
| Public filter | in the query, so `total` and a page are of tracks that have something public |

"Latest" is one definition, used by this view and by the positions endpoint from
[59](./59-QA-FIX-9-WORKSTATION.md): the run whose job finished last. The positions
endpoint now reads only that run's rows; it read every run's to find out which was latest.

The identity workstation shows a pill when the answer is short ("the first 2000 of 3140
tracks"). A link from the review queue can name a track of an earlier run; the page then
asks for every run once, selects the track, and says "every one of N track runs; boxes are
the latest run's".

## The footage list

`GET /vision/assets` loaded every job each of 200 assets had ever had, with its error
body, and kept one per stage in memory. It now asks the database for the latest job of
each stage (`DISTINCT ON (video_asset_id, type)`, on the existing index). The response is
unchanged. This is raw SQL, so its test is the gate: `vision:trackcheck` checks the list
before and after a second run of a stage.

## Finding a frame

During playback the identity workstation asks, for every track, on every tick, whether the
track has a position on the frame shown. That was a scan from the start of each track's
list. It is now a binary search over the positions in frame order (`positionOnFrame`):
twelve reads for a track of 2,000 positions, where the last frame took 2,000.

The page still re-renders on each tick. Moving the boxes off the React commit path, which
doc 08 describes, is not done; see below.

## The migration

`20261005120000_vision_performance_indexes`. Indexes only; no row changes; every statement
is `IF [NOT] EXISTS`, and it was run twice against the dev database.

| Index | For |
|---|---|
| `vision_event_candidates (review_state, superseded_by, created_at)` | the review queue and the overview's count |
| `vision_identity_assignments (review_state, superseded_by, created_at)` | the same |
| `vision_identity_assignments (track_id, superseded_by, valid_from_ms)` | a track's current windows in order. Replaces the index on `track_id` alone, which it covers |
| `vision_jobs (model_version_id, type, state)` | "is this version being benchmarked", and the foreign key |
| `vision_video_assets (source_video_record_id)` | foreign key |
| `vision_dataset_members (video_asset_id)` | foreign key. It is `ON DELETE RESTRICT`, so every asset delete scanned the table |
| `vision_active_learning_items (video_asset_id)` | foreign key |
| `vision_upload_sessions (video_asset_id)`, `(grant_id)` | foreign keys |

And one constraint removed: **`vision_jobs.idempotency_key` is no longer unique.** The key
is a worker's proof that this job's completion already landed. It is compared on the job's
own row and nowhere else, but it was unique across every job, so a second job sending a
key another had used hit the constraint and the completion was a 500. `vision:jobcheck`
now completes two jobs with one key.

The pending-request uniqueness that appendix B also asked for was settled in
[57](./57-QA-FIX-7-MODELS.md) with a lock, and is not in this migration.

## One more

The dataset export picked a proxy with `take: 1` and no order. After a transcode retry an
asset has two, and export could cut frames from a different one than inference and
annotation used. It now takes the newest, as they do.

## Tests and checks

| Check | Result |
|---|---|
| API suite | 1,470 passed (was 1,451); typecheck clean |
| Web | 212 passed (was 209); typecheck and build clean |
| Contracts, worker | not run: nothing in them changed |
| Mutation runner | 38 of 41 killed on the first run. One survivor was a real gap (nothing checked that a frame the track was not seen on is also found without a scan); a test was added and it is killed now. The other two are equivalent: handing each asset every loaded grant changes nothing because the decision filters grants by the asset's own partner and record, and a repeated asset id collapses in the answer's map |
| Migration | `prisma migrate diff` both ways against the shadow database: no difference. The SQL run twice on the dev database: no error |
| `vision:jobcheck`, run twice | 30/30 (was 27): two jobs complete with one key |
| `vision:trackcheck`, run twice | 56/56 (was 53): the footage list's stages, before and after a re-run |
| `vision:identitycheck`, run twice | 70/70 (was 65): a page says it is short, the next page is the rest, the public view says its total |
| `eventcheck` 89/89, `datasetcheck` 99/99, `promotioncheck` 61/61, each twice | pass, unchanged: the queue, dataset add and freeze, and the promotion gate against Postgres |
| `modelcheck`, `clockcheck`, `gamestatecheck`, `calibrationcheck`, `catalogcheck`, `uploadcheck` | pass |
| `teamcheck`, `annotationcheck`, `benchcheck` | fail on expectations that were stale before this PR (1, 4 and 2 checks). They are PR-11's |
| `db:purge:gate-litter` | nothing to delete |
| Browser | on a scratch asset with two track runs: three tracks and three boxes by default; a link to a track of the earlier run made one `?job=all` request, listed six and selected it; the footage list showed the stage |

## What is not done

| Item | Why | Where |
|---|---|---|
| Query plans on real volumes | Dev has a few hundred rows; Postgres will not choose these indexes there, so `EXPLAIN` proves nothing. The indexes match the queries' filters and order by reading | watch `pg_stat_user_indexes` on live once there is footage |
| Boxes drawn off the React commit path | The page re-renders on every tick of playback. The lookup per track is now cheap; a canvas or ref-drawn overlay is a rewrite of the stage | a later UI pass |
| The overview's two "unreviewed" counts | They count every undecided row by design. They are counts on the new index | nothing to do |
| Paging in the identity workstation | The page shows the first 2,000 tracks of a run and says when there are more. It does not fetch the next page | when a run exceeds 2,000 tracks |
| `events.forAsset` paging | One asset's current candidates; bounded by a match | not planned |

## After merge

1. The deploy applies the migration. On live's table sizes each index builds in well under
   a second; nothing is locked for long.
2. Nothing to run by hand.
