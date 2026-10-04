# 43 — Phase 5 Increment 6: the pitch under the player

> The API never reads bulk artifacts out of R2 — the review UI fetches Parquet
> directly via signed URL. If the API pulled results from R2, EC2 would become a
> data-plane hop, which is exactly what the freeze is trying to prevent.
> — [01-ARCHITECTURE](./01-ARCHITECTURE.md), § 1

[42](./42-PHASE-5-INCREMENT-5.md) put every track on the pitch in metres, in
Parquet, under the suppression rule. Nobody could see it. This increment is the
tactical minimap the workstation layout in [08](./08-FRONTEND.md) has carried
since Phase 0: the pitch drawn under the player, a dot per track at the
playhead's foot point, read from the game-state chunk covering that moment —
fetched by the browser from the bucket, decoded in the browser, with the API
handing out URLs and reading none of the rows. A track with no metres on the
frame is not drawn, and the caption says how many and why.

---

## What the browser does

The identity workstation asks the API for the asset's latest game state:
coverage, the pitch dimensions the placement used, the track job the rows refer
to, and a presigned URL per chunk with the source-time range each covers (the
range is in the chunk's name and the job's chunk size, so no index fetch is
needed to pick one). As the playhead moves, the chunk covering it is fetched
with one plain GET and decoded with hyparquet (MIT, no dependencies, Parquet
in pure JavaScript); the last four chunks stay decoded, so scrubbing within a
few minutes costs nothing. Rows are indexed by proxy frame — the same key the
boxes already use — so the dot and the box on a frame come from the same
moment, and a frame no track was seen on draws nothing rather than the nearest
thing.

The map is an SVG in metres: the pitch's markings on its actual dimensions, a
margin of grass, and a dot at `(x_m, y_m)` for each row that has them. Colour
follows class and kit side, never alone: every dot carries the track's label —
the player's name once somebody has said who it is, the track number until
then — and the caption counts placed and not placed with the reasons. Clicking
a dot selects the track, the same selection a box click makes. A point placed
off the drawn grass is not drawn: a wildly wrong calibration should fail the
bar, and if one did not, the map is not where it is discovered.

hyparquet decodes snappy and no other codec without a second package, so the
worker's chunks are now written with snappy rather than zstd. A chunk the
worker actually wrote is a fixture in the web tests, decoded by the real
library: the columns, the types, the nulls and the reasons are checked against
the file, not against a description of it.

## What the API adds

The game-state read now names the track job the rows belong to, the pitch
dimensions of the calibration the placement used, and each chunk's index and
source-time range beside its key and URL. Nothing else changed on the server:
the stage's output and the control plane's record of it are
[42](./42-PHASE-5-INCREMENT-5.md)'s.

## The bucket's door

> **Since:** the rule below was set on the derived bucket on 2 October 2026. Checked on
> 4 October 2026 with a preflight against a presigned URL: `GET` and `HEAD` are allowed
> from `http://localhost:5173` and from the staging site's origin, and from nowhere else;
> `PUT` is not allowed; the master bucket has no rule. Two things follow. The minimap
> reads chunks from the bucket today. And the rule names the site's origin, so the day the
> site moves to a domain or to HTTPS, the new origin has to be added or the minimap goes
> back to the message described here. The rest of this section is as it was written,
> before the rule existed.

A browser cannot read the bucket until the bucket says it may. The derived
bucket's CORS rule is unset, as it was when [36](./36-PHASE-4-INCREMENT-5.md)
routed track positions through the control plane rather than wait on it; the
API's own credentials cannot read or set the rule (bucket configuration is a
different permission from object access), so it is a dashboard change, not
code. The minimap knows: a chunk the bucket refuses is reported in words —
*the browser could not read the chunk from the bucket; this is almost always
the bucket's CORS rule* — with the pitch drawn and the coverage shown, and
nothing guessed.

The rule the bucket needs, for `dtp-staging-vision-derived` and its production
counterpart: allowed origins the review UI's origins (the deployed app and, for
development, `http://localhost:5173`), allowed methods `GET` and `HEAD`,
allowed headers `*`, exposed headers `Content-Length`, a max age of an hour.
Once it is set, the screen as built works without a change; until then, the
minimap is verifiable the way it was verified here.

## Verification

```
api tests              1,278 passed   (read route widened; same count)
web tests                172 passed   (was 161)
  game state              11
vision-worker            241 passed   (snappy; same count)
vision-contracts          54 passed
typecheck               api and web clean
migration               none
```

Eighteen mutations of the browser module, each caught: a chunk's range made
inclusive at the end and exclusive at the start; a bigint dropped; a null read
as zero; x and y swapped; the reason dropped; rows on a frame ignoring the
frame; the millisecond fallback too tolerant; the cache never evicting, and
not refreshing on use; a bad HTTP status accepted; a CORS refusal not named;
the halfway line at a third; the right box drawn on the left; the margin
ignored; the viewBox without its margin; placed counted as all rows; and the
coverage printed as a fraction.

The screen was driven in the browser as a signed-in reviewer on the demo
proxy, with a scratch fixture of three tracks over five seconds, two camera
segments (one calibrated good, one declared and never calibrated), a kick-off
anchor, and three two-second chunks written by the worker and put in the
bucket. Against the bucket as it is, the minimap showed the coverage (*placed
on 61% of frames · 1 of 2 segment(s) calibrated*), the pitch, and the CORS
message. With the page's fetch pointed at same-origin copies of the same
chunks, two frames in it placed the three tracks where the fixture put them —
`#1 at 10.6, 34.0`, `#2 at 60.0, 20.4`, `#3 at 3.0, 34.4` metres — read
*3 placed · calibration good* with the segment named, selected track #2 from
its dot, and four seconds on, under the uncalibrated segment, drew nothing and
read *0 placed · 3 not placed: segment not calibrated*. The fixture, the
copies and the reviewer were removed.

## What is not done

| | |
|---|---|
| **The CORS rule** | Set in the Cloudflare dashboard, as above. The one thing between this screen and a reviewer. Done on 2 October 2026. |
| **The ball** | Drawn when a track of class `ball` has rows; no detector in the register finds one yet. |
| **Trails and speed** | A trail is the last second of rows for one track; a speed is their difference. Both are a window over rows this screen already has, and both wait for the metrics phase so that the calculation is versioned where it is computed. |
| **Which way each side attacks** | The pitch has a left and a right; nothing yet says which goal is whose. A per-half flag belongs beside the clock anchor. |
| **The calibration editor** | Shows no minimap; a reviewer clicking landmarks wants the picture, not the map. The identity screen is where the map answers a question. |
