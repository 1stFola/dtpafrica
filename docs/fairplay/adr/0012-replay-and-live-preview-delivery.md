# ADR-0012 — Replay windows come from a byte-range cache; live preview is HLS through the Edge

**Status**: proposed (Phase 2) · **Decides**: how video reaches the operator's browser

## Context

Phase 2 found two facts by testing in a browser, not by reading:

- MediaMTX's playback server (`/get`) streams a window without `Content-Length` or byte-range
  support. Chrome then reports the video as seekable only at `[0, 0]`: no scrubbing, no
  frame nudges, no calibration.
- Live preview needs a low-latency stream. MediaMTX offers WebRTC (needs extra UDP ports
  reachable from operator devices) and HLS (plain HTTP, so it can be proxied). Its HLS server
  ties a reader's requests together with a cookie set after a redirect, and a `?session=` id
  in every URL.

## Decision

- **Replay**: the Edge fetches a requested window from MediaMTX whole, into
  `<data>/replay-cache/`, and serves it with full byte-range support. Bounded at 60 files and
  2 GiB, pruned oldest-first. A window ending within 10 s of now is never reused, since it may
  still be growing. The cache holds copies of recordings, so it lives in the data volume,
  never in memory-backed `/tmp`, and the same authorisation guards it. It is not evidence:
  evidence is Phase 3's, with its own hashes and lineage.
- **Live preview**: MediaMTX's HLS (fMP4 variant) is switched on, reachable only on the
  compose network (or loopback, natively) and only with the Edge's credentials. The Edge
  proxies `/edge/v1/live/<source>/<file>` after its own check, holds MediaMTX's session cookie
  itself, and passes through only the `session` query parameter (validated as a UUID). The
  console plays it with Media Source Extensions: video only, muted, no third-party player.
  The delay behind live is measured from `EXT-X-PROGRAM-DATE-TIME`, never assumed.

## Consequences

The first load of a window waits for the whole window (a 40 s window at 2.5 Mbit/s is about
12 MB). Phase 2 measured this end to end in the browser: p95 1.5 s. Disk use for the cache
is bounded and visible. Live preview runs a few seconds behind (measured 3–7 s); it is for
orientation, and replay is the tool for review.

## Alternatives considered

- **Proxy `/get` straight through** (Phase 1): fast first byte, but unseekable in a browser.
- **WebRTC preview**: lower latency, but browsers would connect to MediaMTX directly over
  UDP, which means more open ports on a shared venue network and ICE configuration that
  depends on the hardware. Revisit if 3–7 s proves too slow at a real match.
- **hls.js**: a mature player, but a new dependency to vet for something the browser's own
  MSE does in about 150 lines here.
