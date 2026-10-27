# ADR-0004 — The review console is served by the Edge over local HTTPS

**Status**: proposed (Phase 0) · **Decides**: how operators reach replay at the venue

## Context

`https://www.dtp.africa` cannot load `http://` media from a LAN address (mixed content),
and its CSP allows `media-src` from `https:` only. The venue may have no internet, so the
console cannot depend on the cloud. Browsers need a secure context for `Secure` cookies and
several media APIs; `https://localhost` is one, `http://192.168.x.x` is not.

## Decision

- A separate Vite/React app, `apps/fairplay-console`, reusing `@dtp/ui`, built to static
  files and served by the Edge. It talks only to the Edge API on its own origin.
- **Caddy** terminates TLS with its internal CA. On the Edge machine the console is
  `https://localhost`. Any second device (assessor laptop) must be DTP-owned and have the
  Edge's root certificate installed once, at provisioning.
- Media reaches the browser only through the Edge API's authorised proxy of MediaMTX `/get`
  (`format=mp4`), with the session cookie. No media URL works without it.
- The cloud admin page links to the console and shows pairing state; it never embeds it.

## Consequences

No DNS change and no internet needed at the venue. The cost: certificate installation on
each reviewer device, and an untrusted-certificate warning if someone skips it, which
operators must be trained never to click through.

## Alternatives considered

- **Public certificate for a DTP subdomain resolving to a private IP**, issued by DNS-01
  before the match: no CA installation, works on any device. Needs a change to live DNS
  and a renewal path; out of scope without approval. Worth revisiting if organisers' own
  devices must view at the venue.
- **Plain HTTP on the LAN for the pilot**: rejected; it fails the PID's "block untrusted
  attendees" requirement on a shared venue Wi-Fi.
