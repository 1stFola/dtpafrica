# ADR-0011 — MediaMTX records on its own; the Edge indexes what it wrote

**Status**: proposed (Phase 1) · **Decides**: who starts recording, and how a segment becomes "final"

## Context

The PID's first priority is a recording that does not fail silently. Two designs were
possible: the Edge switches recording on per session through MediaMTX's API, or MediaMTX
records every configured source whenever it publishes. MediaMTX can call a command when a
segment completes (`runOnRecordSegmentComplete`), but its published image is built from
scratch with no shell, so a hook would need a second image or a host binary.

## Decision

- **`record: yes` for every configured path, in MediaMTX's own config.** A source that
  publishes is recorded, whatever the Edge is doing. Stopping, restarting or crashing the
  Edge cannot stop a recording, and a MediaMTX restart resumes recording without the Edge
  having to re-assert anything. Sessions (Phase 2) become time windows over the recordings,
  not switches.
- **The Edge watches the recordings folder** every poll (2 s). A segment is final when a
  newer segment exists for its source, or its source is not publishing and the file has
  not grown for `FAIRPLAY_FINALIZE_QUIET_SECONDS`. The same pass runs at start-up, so a
  segment finalised while the Edge was down is picked up then.
- **Completeness is read from the file, not assumed.** The MP4 box structure is walked
  (`mp4.inspect`): a box running past the end of the file, or a `moof` with no `mdat`,
  makes the segment `partial`; no complete fragment, or ffprobe failing, makes it
  `corrupt`. Only a whole file is `finalized`.
- **Repair never touches the original.** It writes a separate file truncated at the last
  whole fragment, hashes and probes it, and records it as a derivative with the bytes it
  dropped. The original keeps its hash and its `partial` state.
- **Retention belongs to the Edge**, so MediaMTX's `recordDeleteAfter` is `0s`: only the
  Edge knows which segments a hold or unsynced evidence protects.

## Consequences

Disk fills whenever a source publishes, session or not; the disk watchdog and retention
cover that, and the fixtures measure the rate. A segment's hash exists only once it is
final, so the segment duration bounds how long the newest footage waits for its hash; the
Phase 1 report records the measured cost of hashing and the duration chosen.

## Alternatives rejected

- **Per-session recording switched by the Edge over MediaMTX's API**: API changes are
  in memory, so a MediaMTX restart mid-match would silently stop recording until the Edge
  noticed and re-asserted it. That is the failure the PID calls out first.
- **Hooks in a MediaMTX image with a shell** (the `-ffmpeg` variant, or a custom build):
  a second image to maintain, and still blind to anything that happened while the hook
  target was down.
