# ADR-0013 — Evidence clips are stream copies of verified originals, made on request

**Status**: proposed (Phase 3) · **Decides**: how an evidence MP4 is made, and what makes it trustworthy

## Context

Replay (ADR-0012) already shows any recorded window without making a file. Evidence is
different. It is the clip a finding relies on, the one an organiser may see later, so
someone must be able to show it is what the camera recorded and nothing else. The Edge is a
small venue machine that is also recording. MediaMTX's playback server can produce a
window, but it does so from whatever is on disk at that moment, with no hash check, and it
is a stream with no byte ranges.

## Decision

- **On request only.** An operator asks for a clip of one camera for one incident. Nothing
  is encoded in advance, and never a whole game. The job runs in its own worker thread, so
  recording, scanning and replay carry on.
- **From the originals, after a hash check.** Every original segment in the window must be
  final and must still hash to the SHA-256 recorded when it was finalised. A missing or
  changed original fails the job (`source_missing`, `source_mismatch`). A segment still
  being written makes the job wait (not a failed attempt). An unreadable (`corrupt`)
  segment is left out and counted as a gap.
- **Stream copy, piece by piece.** Each original's part of the window is copied out by
  input seeking (`ffmpeg -ss <keyframe> -i <original> -t <length> -c copy`), and the pieces
  are joined whole (`-f concat`, no in- or out-points). No decode, no re-encode: the
  pictures are the camera's own, the cost is a file copy, and the same originals always
  give a byte-identical clip (`-fflags +bitexact`, `-map_metadata -1`), which a unit test
  checks. The plan follows each segment's **video** span, not its container's length, and
  no two pieces overlap.
- **Every piece starts on a keyframe.** The first starts on the keyframe at or before the
  requested start, so the clip opens with up to one GOP of footage from before the window
  (`leadInMs`), counted into `eventAtMs`. A segment that opens on frames whose keyframe the
  recorder discarded starts at its first keyframe, and the time before it is recorded as
  `undecodable`. Nobody is told the clip is frame-exact.
- **No footage, no file.** A window no recording covers fails with `no_footage`. A window
  with holes gives a clip whose manifest lists each gap (`coverage: partial`). An evidence
  row exists only once its file has probed, been hashed and been renamed from `.part`.
- **A manifest beside every clip**, `fairplay.evidence-manifest/v1`
  ([JSON Schema](../../../services/fairplay-edge/fairplay_edge/schemas/evidence-manifest.v1.schema.json)).
  It records each original's id, path, recorded SHA-256 and its SHA-256 re-computed at the
  cut; the in/out points used; the clip's own hash, length and codec; the exact ffmpeg
  arguments and version; the calibration and uncertainty of the window; the incident
  snapshot; the requester; and every audit entry about the incident up to the cut. The
  manifest's own hash is stored in the database and in the `evidence.created` audit entry.
- **Read-only once made.** Clip and manifest are `0444`, and are re-hashed before every
  approval and export; a mismatch raises a critical alert. Originals become `0444` when
  they are finalised. An open file handle is unaffected, so this cannot cost a recording.
- **Interrupted jobs are re-run.** On start-up a job left `running` is queued again and its
  `.part` file removed. After `FAIRPLAY_CLIP_MAX_ATTEMPTS` it fails as `interrupted`.
- **Evidence protects its sources.** Each original a clip used gets an `evidence_refs`
  row, which retention already refuses to delete until it is synced.

- **Coverage is what the clip's pictures hold.** After the cut, the clip's video packet
  timestamps are read (no decode): holes, the lead-in and any shortfall are measured, and
  coverage is `full` only when the video has no hole and reaches the window's length
  within three frames. Anything ffmpeg prints at error level fails the job, whatever its
  exit code.

**Why not the concat demuxer's own in/out points**, which would be one command: Phase 3's
fixture runs found three ways it goes wrong on MediaMTX's recordings, each exiting 0. It
refused in-points before a piece's first keyframe (EPERM) and stopped mid-clip. With no
out-point, it placed the next segment after the container's length, including audio
running past the video, and opened a false gap. On a segment whose audio starts after its
video, it stopped 0.85 s before the out-point.

## Consequences

Making evidence never touches the recordings and does not load the machine for long (cut
times are in the Phase 3 report). The lead-in GOP is visible: an assessor sees up to one GOP
(2 s on the synthetic feeds) before the requested start, and the manifest's `eventAtMs`
already includes it.
Re-encoding for a frame-exact cut, burned-in captions or a lower bitrate is not offered.
Each would need the FFmpeg licence decision (OSS register) and would make the clip no longer
the camera's own pictures.

## Alternatives considered

- **Use MediaMTX `/get` output as the evidence file.** No hash check of the originals, and
  it ties evidence to MediaMTX being up.
- **Re-encode every clip** for exact cuts. Slower on a recording machine, not reproducible
  byte for byte, and it changes the pictures.
- **Pre-cut clips for every incident when it is flagged.** Wasted work for incidents nobody
  reviews, and the window may change before review.
