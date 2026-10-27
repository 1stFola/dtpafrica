# ADR-0003 — Edge: MediaMTX + Python FastAPI + SQLite (WAL)

**Status**: proposed (Phase 0) · **Decides**: what runs at the venue

## Context

The Edge must ingest, record, hash, serve recorded windows, clip, run a durable outbox and
authenticate operators — offline. The PID suggests FastAPI + SQLite WAL unless the repo
establishes a better standard. The repo has two runtimes: TypeScript (web, API) and Python
3.12 (`services/vision-worker`: ffmpeg/ffprobe as subprocesses, pytest in CI, a contract
parity check against `@dtp/vision-contracts`).

## Decision

- **MediaMTX** (MIT, pinned version and archive checksum) does ingest, recording (fMP4) and
  recorded playback (`/list`, `/get`). Its API and playback listen on loopback only. We do
  not write a media server.
- **`services/fairplay-edge`**: Python 3.12, FastAPI, Uvicorn, SQLite in WAL mode with
  `synchronous=FULL` for the outbox and audit tables. Packaged like the worker
  (`pyproject.toml`, setuptools, pytest).
- **ffmpeg/ffprobe** as subprocesses from the distribution package, never linked.
- Sync payloads defined once in a new `packages/fairplay-contracts` (TS), mirrored in
  Python, with a parity test — the vision-contracts precedent.

## Consequences

Same Python toolchain and CI job shape the team already runs; FastAPI generates the Edge's
OpenAPI document for free. The cost is a second language at the API boundary, paid for by
the parity test.

## Alternatives considered

- **Node + better-sqlite3 + Fastify/Nest on the Edge**: would share TS types directly and
  match the API. Lost because the media-handling code the team has written and tested is
  Python, and a native SQLite module on an unknown Windows/Linux laptop is the harder build.
  Revisit if the Edge machine turns out to be one where Python packaging is the problem.
- **Postgres on the Edge**: heavier to run and back up on a laptop than one SQLite file.
