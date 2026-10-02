# @dtp/vision-contracts

One source of truth for the Vision Engine's cross-boundary shapes: rights decisions, media
enums, object keys, job specs and the prediction envelope.

Three consumers, two languages:

| Consumer | How it uses this |
|---|---|
| `@dtp/api` (TypeScript) | Imports the types directly |
| `@dtp/web` (TypeScript) | Imports the types directly |
| `services/vision-worker` (Python) | Validates against generated JSON Schema — **not yet, see below** |

## Why no Zod in Phase 0

[docs/vision/01-ARCHITECTURE.md](../../docs/vision/01-ARCHITECTURE.md) specifies Zod schemas here,
emitting JSON Schema for the Python worker to validate against.

Phase 0 ships **plain TypeScript types and constants instead**, for two reasons:

1. There is no worker yet. A codegen step with no consumer is a build step that rots.
2. The API validates inbound payloads with `class-validator`, like the rest of this codebase.
   Adding Zod alongside it would mean two validation libraries and two ways to describe the same
   DTO.

**Phase 1 adds the runtime schemas and the JSON Schema emitter**, when the worker exists to consume
them. The constants here are deliberately `as const` arrays rather than bare unions so that
generating schemas from them later is mechanical.

`VISION_CONTRACT_VERSION` is already exported and already carried on every job spec, so the worker
handshake works from day one.

## Rules

- **No provider names.** Nothing in here may mention RunPod, Cloudflare, R2, or Lambda. Those live
  in their adapters. A job spec that carries a provider-specific field has leaked, and there is a
  test asserting it has not.
- **Additive changes only** within a major version. The worker and the control plane deploy
  independently, so a removed field breaks a running worker.
- **Bump `VISION_CONTRACT_VERSION`** on any change to the job spec or the prediction envelope.

## Versions

| Version | Change |
|---|---|
| `1.0.0` | Phase 0 through Spike S0. |
| `1.1.0` | A model-bound job (`MODEL_TASK_BY_JOB_TYPE`) is dispatched with exactly one `modelVersionIds` entry, and any stage downstream of `transcode` receives the proxy's clock under `params.proxy`. The `detect` artifact is `DetectionArtifact`: contract classes, both clocks, `ball_unknown`, the model version and the weights checksum. A worker reports `modelVersionIds` on completion. A 1.0.0 worker is refused at the handshake: it would run `detect` and write predictions nobody can attribute. |
