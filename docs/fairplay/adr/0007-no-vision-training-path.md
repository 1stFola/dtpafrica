# ADR-0007 — FairPlay footage is not Vision footage

**Status**: proposed (Phase 0) · **Decides**: the boundary between FairPlay and the Vision Engine

## Context

Vision's training firewall admits only `corpus = dtp_owned` footage to datasets. FairPlay
recordings are made by DTP on DTP's equipment, so a careless import would label them
`dtp_owned` and make contested clips of minors trainable. Dispute footage is collected for
a different purpose than analysis or training, and consent for one is not consent for the
other.

## Decision

- No code path creates a `VisionVideoAsset`, `VisionSourceVideoRecord` or dataset member
  from a FairPlay segment or evidence object. A test asserts that the `fairplay` module does
  not import Vision's asset or dataset services.
- FairPlay evidence lives in its own bucket ([ADR-0006](./0006-evidence-storage.md)), which
  no Vision role can presign.
- Moving a FairPlay recording into Vision, if ever wanted, is a separate, explicit process
  through Vision's rights workflow with its own consent evidence, not a flag.
- FairPlay sends no footage to any external AI or analytics service.

## Consequences

Some useful training footage stays out of Vision. That is the intended trade.
