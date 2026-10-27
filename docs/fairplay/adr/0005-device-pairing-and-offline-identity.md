# ADR-0005 — Edge pairing copies Vision's worker identity; operators use signed offline bundles

**Status**: proposed (Phase 0) · **Decides**: machine and operator authentication

## Context

The Edge must sync with the cloud as a machine, and operators must sign in with no
internet. The repo already has a tested machine-identity pattern: a bootstrap token that
`register` exchanges for a worker token, both stored as SHA-256 hashes with a `tokenKind`,
each guard accepting exactly one kind (`services/api/src/vision/worker/`). Admin users sign
in with bcrypt passwords and a 7-day JWT; the super-admin API key has no user id.

## Decision

- **Device**: `FairPlayEdgeDevice` with the worker's bootstrap → device token exchange. The
  device also generates an Ed25519 key pair; the public key is registered. A device token
  can sync and presign only for sessions assigned to that device. Retire = revoke.
- **Operators offline**: while online before kick-off, the Edge fetches a **credential
  bundle** for its session — per member: user id, name, FairPlay permissions, session and
  match ids, expiry (default 36 h), and a hash of a matchday PIN the member set in the admin
  UI — signed by a cloud Ed25519 key whose public half the Edge received at pairing.
- The Edge verifies the bundle offline and signs people in with email + PIN; a local session
  cookie (`Secure`, `HttpOnly`, `SameSite=Strict`, idle timeout) follows.
- A local FairPlay admin can disable a member on the Edge; this is audited and synced.
- Every act needs a named person; the super-admin API key cannot be used at the venue.

## Consequences

Revocation does not reach an offline venue: a user removed in the cloud keeps access until
the bundle expires or a local admin disables them. This is stated in the runbook. On
reconnect their actions are accepted and **flagged**, never silently dropped.

## Alternatives considered

- **Reusing the 7-day admin JWT offline**: it cannot be verified without the cloud's
  symmetric secret, which must never sit on a venue laptop.
- **Local accounts created on the Edge**: no link to cloud identity; audit trails would name
  people the cloud does not know.
