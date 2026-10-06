# Phase 6 Increment 9 — ball trajectory with explicit lost states

Implemented on 5 October 2026. The full Phase 6 gate remains open.

## Behavior

The new `ball_trajectory` CPU stage consumes a succeeded detection artifact. It
does not download weights, run a detector, or infer possession. Footage and
Pipeline show the stage and its limitations. Existing job authorization, current
analysis rights, prerequisites and budget checks still apply.

Every source frame in the declared window has an observed or lost row. Only one
valid, sufficiently confident ball in a labelled `live_play` camera segment can
produce coordinates. Missing frames, no ball, low confidence, ambiguous balls,
invalid detections, implausible image motion, unknown cameras, camera cuts and
non-play footage produce explicit lost reasons with null coordinates. Each loss
or camera change resets smoothing. The next observation starts a new trajectory;
there is no interpolation, extrapolation or carried-forward lost position.

Coordinates are normalized image coordinates, with the raw observation retained.
Confidence remains the detector's original confidence. Causal smoothing is based
on elapsed source time. These are not pitch coordinates, physical speeds,
possession assignments or validated accuracy claims. Frame coverage measures
observations, not correctness.

## Inputs and provenance

Contract version is `1.13.0`; older workers remain compatible with their existing
stages but cannot claim the new stage. Jobs route to `cpu_small`; GPU overrides
are refused. No trajectory model registration is required.

The API selects a succeeded detect job on the same asset (optionally selected by
`detectJobId`) and owns the declared artifact key, detector model and weights,
source checksum/duration, proxy checksum/duration, detector image dimensions,
proxy clock and camera segment snapshot. Caller attempts to override those values
do not become authoritative. Only the exact successful attempt's derived object
is accepted. Sparse detection sampling, stale source evidence, missing geometry,
invalid camera windows and mismatched clocks refuse enqueueing.

Detection outputs now record probed proxy geometry/duration and proxy/source
checksums. Older artifacts without this evidence require a new valid detection
run before trajectory processing. The trajectory worker checks the downloaded
artifact's header against the queued evidence and streams its frames. It requires
full proxy-frame-rate detections (10–120 fps), monotonic frames and matching
source/proxy timestamps. Source padding is excluded using the original duration.
The frame count is capped at one million.

Optional `trajectoryConfig` accepts `minConfidence` (default 0.5), `smoothingMs`
(default 120) and `maxImageSpeedPerSecond` (default 2 normalized image units/s).
These defaults are provisional filters, not thresholds established by evaluation.
`chunkMs` defaults to 60,000 and may be 10,000–600,000.

The stage writes a small `ball_trajectory/v1` index and streamed JSONL chunks
under its own immutable attempt prefix in derived storage. The index pins the
detection file checksum, detector/weights, source/proxy checksums, image geometry,
clock, camera snapshot, algorithm configuration, chunk checksums and observed/lost
counts. Completion validation checks source-window frame counts, coverage,
reasons and artifacts. It writes no player, match, possession or calibrated facts.

## QA and pilot status

- Worker: 366 tests passed, including loss/reset, camera boundaries, corrupt
  input, proxy padding, chunk checksums and declared-input stage tests.
- API: 1,644 tests across 104 files passed; focused enqueue/completion checks
  cover stale/forged evidence, sparse input, CPU enforcement and honest counts.
- Web: 246 tests across 23 files passed. Contracts: 75 tests across seven files.
- API and web production builds passed; whitespace checks passed. The restarted
  local API and real pilot Footage row show the new stage as not run; desktop
  layout was inspected and the temporary viewport override restored.

These checks use synthetic detection fixtures; they do not establish real ball
accuracy or a successful real detector run. No paid compute was launched: pilot
spend remains $0 against the $4 ceiling. The real Jagaban Cup reference still has
zero of two independent reviewer submissions and remains unfrozen/unscored.

Next implementation: possession candidates and segments over valid trajectories
and player evidence, with Unknown retained when attribution is uncertain.
Production detector licensing, representative real-footage evaluation, independent
gold labels and event inference remain required before Phase 6 completion.
Commit and push remain deferred until that full gate is complete, as requested.
