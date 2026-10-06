# Phase 6 Increment 13 — calibrated possession constraints

Implemented following [83](./83-PHASE-6-INCREMENT-12.md). The full Phase 6 gate
remains open. This increment adds conservative ground-plane vetoes to the existing
unreviewed image-proximity producer; it does not establish football control, ball
height or possession accuracy.

## Producer behaviour

The default image mode still produces `possession-candidates/v1`. Opt-in
`constraintMode: "calibrated"` produces `possession-candidates/v2`. Image confidence,
unique nearby player/goalkeeper, exact-frame joins and continuity rules still apply.
Calibration never resolves an ambiguous image by choosing the nearest player.

For an image-eligible observation, v2 projects the raw ball image point and player
foot point through the current camera's oriented proxy-pixel-to-pitch homography.
Detector pixels are scaled independently in x/y to the explicitly recorded proxy
dimensions. Smoothed ball points do not create contact or hide motion jumps.

The additional vetoes return Unknown with null local actor and confidence:

- Missing or failed calibration: `calibration_unavailable`; no image-mode fallback.
- Horizon or nonfinite projection: `projection_invalid`.
- Either projected point outside the pitch lines: `off_pitch`. Throw-ins/out-of-play
  points are not labelled controlled possession from this image-only heuristic.
- Ground-plane separation above the configured limit: `metric_distance`.
- Consecutive observed ground-plane ball/player displacement above the configured
  speed limit: `implausible_motion`.

Gaps, weak/ambiguous evidence, cuts and trajectory changes reset continuity. Speed
is never compared across cameras or ball trajectories; player speed is compared
only for the same local track. A motion veto starts fresh continuity and never
backfills a candidate into the uncertain window. No interpolation, extrapolation
or player identity is introduced.

Provisional defaults are 2 m separation, 35 m/s ground-plane ball motion and
12 m/s player motion. Optional `footballConfig` ranges are 0.1–3 m, 5–50 m/s and
2–15 m/s respectively. These are stored algorithm limits, not empirically validated
football thresholds. An airborne ball projected onto the pitch can be misleading;
the producer remains a candidate heuristic and requires real-footage evaluation.

## Provenance and staleness

The API owns `calibrationSnapshot`: current proxy variant ID/key, actual width and
height, proxy checksum from a matching completed transcode, and each camera's
current calibration ID, quality, threshold version, oriented homography and pitch
dimensions. Client-supplied matrices cannot override this evidence. Unknown/failed
calibration snapshots contain no usable numerical projection.

New transcode completions record actual encoded width and the proxy file SHA-256.
Older proxies lacking geometry or matching checksum evidence refuse calibrated
enqueue. A passing calibration predating the current proxy also refuses enqueue:
recalibrate after regenerating the proxy rather than reuse coordinates silently.
Stored observation proxy checksums must match the current declared proxy checksum.

The v2 index and completion pin the full snapshot and resolved football limits.
The bounded importer checks them against queued evidence, preserves the original
candidate/Unknown rows, and refuses a candidate under a nonpassing calibration.
Current calibration/proxy geometry is checked on import, reads and every review or
correction action. A superseding calibration, changed proxy variant/dimensions or
missing current provenance marks the run stale and refuses writes. Original rows
and decisions remain evidence.

Manual corrections remain separate human interpretations. A correction does not
inherit an original candidate's numerical constraint result or detector confidence.
No accepted possession, match events, player metrics or public evidence are written.

## API, UI and compatibility

Queue the existing CPU stage with:

```json
{
  "type": "possession",
  "videoAssetId": "<asset-id>",
  "params": {
    "constraintMode": "calibrated",
    "footballConfig": {
      "maxGroundDistanceM": 2,
      "maxBallGroundSpeedMps": 35,
      "maxPlayerSpeedMps": 12
    }
  }
}
```

The source detail page exposes **Image proximity** and **Calibrated distance and
motion** for the possession stage. Queue buttons also reflect the existing
job-operator permission, without expanding reviewer access. The possession reviewer view shows which checks
were applied, passing calibration coverage, configured limits, the ground-plane
limitation and calibration provenance. Legacy runs explicitly say calibrated checks
were not applied. Stale runs withhold original and correction review controls.

Contract 1.15.0 is required for possession. A 1.14 worker continues serving unchanged
stages but cannot claim the changed possession inputs. Old v1 artifacts remain
readable. Updated transcode metadata is additive; old transcode workers remain
available, but incomplete output cannot qualify for calibrated possession.
No database migration is required: snapshots use the existing immutable run JSON.

## QA

Full automated suites passed: 1,745 API tests (107 files), 452 worker tests,
258 web tests (25 files), and 77 shared contract tests. Checks cover calibrated and
legacy handlers, absent/failed calibration, detector/proxy scaling, horizon and
off-pitch suppression, motion jumps, continuity after cuts, malformed transforms,
checksum/configuration conflicts, current calibration staleness and worker gating.
Transcode tests verify actual width reporting and the checksum of encoded bytes.

Disposable local Postgres QA imported a synthetic calibrated run, superseded only
its QA calibration, verified stale review refusal and unchanged original rows, then
removed the fixture. Browser QA verified the mode selector, missing prerequisites,
operator-only queue feedback, calibrated provenance and limits, and withheld review
and correction controls after superseding only a synthetic calibration. Both final
API/web production builds passed. The final enqueue guard and unchanged route
inventory passed 47 focused checks after the full API run.

All synthetic assets, calibration versions, ledger rows, fake jobs and associated
audit entries were removed. The browser was restored to the real pilot and its
normal viewport. Actual pilot event rows and independent gold submissions were
preserved. Synthetic QA is not accuracy evaluation of the pilot clip.

## Next and full phase gate

Next: the automatic event proposal producer over stored original evidence. Licensed
ball detection, independent human gold submissions, representative footage and
measured event/possession accuracy remain required for Phase 6 completion.
The actual pilot has no ball/possession inference output and its older proxy lacks
the new width/checksum provenance; nothing was fabricated to bypass those gates.
Paid compute remains $0 against the $4 ceiling. Commit and push remain deferred
until the full Phase 6 gate is complete.
