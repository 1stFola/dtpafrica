# DTP FairPlay

Venue-local match replay, shadow review and verifiable video evidence, linked to ScoreBoard
matches. **Built on the Edge through Phase 3 and in the cloud in Phase 4, tested on synthetic data only; the evidence bucket and the production deploy await approval.** Source of truth is the *DTP FairPlay
Product Implementation Document v1.0* (23 Oct 2026) and its coding-agent prompt pack; where
this folder departs from them, an ADR says why.

V1 is shadow review and post-match evidence only. It does not talk to referees, change a
decision or a score, or claim VAR/FVS status.

| Document | What it holds |
|---|---|
| [inventory.md](./inventory.md) | What exists in the repo and in production that FairPlay sits on |
| [architecture.md](./architecture.md) | Current and target data flow, components, MediaMTX hardening, browser security, time model, threat model, cost, licences |
| [equipment-audit.md](./equipment-audit.md) | The matchday-kit questionnaire; every row UNVERIFIED |
| [integration-map.md](./integration-map.md) | Extension points, schema mapping, permissions, API summary, sync contract |
| [openapi-outline.yaml](./openapi-outline.yaml) | OpenAPI 3.1 outline of the cloud and Edge routes, with the time contracts as schemas |
| [phase-plan.md](./phase-plan.md) | Gate decisions, P0 backlog with effort ranges, Phase 1 prerequisites, rollback |
| [blockers.md](./blockers.md) | Blockers, standing escalations, and the assumption register (verified with its source, or UNVERIFIED) |
| [phase-1-edge-foundation.md](./phase-1-edge-foundation.md) | **Phase 1 delivery**: the Edge media foundation, its test log and measurements (synthetic feeds; hardware acceptance pending) |
| [phase-2-replay-console.md](./phase-2-replay-console.md) | **Phase 2 delivery**: the venue console, operator sign-in, the time model and calibration, with the WAN-cut acceptance run and measured p95 |
| [phase-3-incidents-and-evidence.md](./phase-3-incidents-and-evidence.md) | **Phase 3 delivery**: the review state machine, evidence clips and their manifest, the audit chain, the sync outbox, permissions and the rights gate, with the WAN-cut fixture run |
| [phase-4-cloud.md](./phase-4-cloud.md) | **Phase 4 delivery**: the cloud module and migration, device pairing and signed bundles, the sync receiver, evidence in R2 by presigned URL, `/admin/fairplay`, the end-to-end run, cost and the approvals still needed |
| [phase-5-threat-review.md](./phase-5-threat-review.md) | **Phase 5.1**: Prompt 6's failure scenarios and security requirements against the merged code; findings F1–F20 graded, and the proposed scope for the fixes |
| [decisions.md](./decisions.md) | **Fola's decisions** on the gates, retention, rights, organiser access and Edge security (28 Oct 2026) |
| [privacy.md](./privacy.md) | What the Edge holds about people, where it goes, who sees it, and the privacy decisions still open |
| [adr/](./adr/) | 0001 shadow only · 0002 cloud in existing API · 0003 Edge stack · 0004 local console + TLS · 0005 pairing + offline identity · 0006 evidence storage · 0007 no Vision training path · 0008 single-angle mode · 0009 linking to ScoreBoard · 0010 admin placement · 0011 recording independent of the Edge · 0012 replay and live-preview delivery · 0013 evidence clips by stream copy · 0014 audit chain and sync outbox |

Code: [`services/fairplay-edge`](../../services/fairplay-edge/README.md) (the Edge) and
[`apps/fairplay-console`](../../apps/fairplay-console/) (the venue console it serves).

---

## Phase 0 delivery

**STATUS: complete for the repository; blocked on hardware facts and gate decisions.**

**Repository facts confirmed** — NestJS 10 / Prisma 6 / Postgres 16 API under `/api/v1`;
React 18 / Vite 5 web; Python 3.12 worker using ffmpeg as subprocesses; R2 behind an
`ObjectStore` port with presigning; RBAC as rows with competition scoping; a machine-identity
pattern with hashed, kind-checked tokens; `/api/v1/time` for clock correction; live match
events held in sheet JSON until approval, and recreated with new ids on every re-approval.
One `t3.small` behind Namecheap's CDN.

**Hardware facts verified** — none. The repo holds no description of the cameras,
switcher, encoder, drone or venue network.

**Implemented** — documents only, in `docs/fairplay/`. No code, schema, migration,
environment setting, cloud resource or DNS record changed.

**Security and cost** — no auth change. No new dependency installed. New recurring cost:
$0 now; Phase 3 adds a private R2 bucket, estimated at about $0.12/month for ten matches of
evidence-only storage at the PID's quoted prices, rechecked before use.

**Test evidence** — no code, so no test suite was run. What was checked: every existing
file path cited in these documents resolves in the repository; every existing route cited
was read from its controller; `openapi-outline.yaml` parses as YAML (PyYAML 6.0.3) with all
126 `$ref`s resolving and no description split by an unquoted comma; relative links between
these documents resolve. The outline was not run through an OpenAPI validator.
The upstream MediaMTX defaults this design depends on (anonymous publish/read/playback,
`playbackAllowOrigins: ["*"]`, `recordDeleteAfter: 1d`) were read from its repository on
27 Oct 2026; the PID's links to MediaMTX's recording and playback docs return 404 (the files
have been renumbered to `08-record.md` and `09-playback.md`).

**Human approvals required** — the eight gate decisions in
[phase-plan.md](./phase-plan.md#phase-0--discovery-this-folder), and the equipment audit.
Phase 1's exact entry conditions are the
[prerequisites table](./phase-plan.md#prerequisites-for-phase-1).

**Rollback** — delete this folder.

**Next phase** — Phase 1, Edge media foundation, starting on synthetic feeds.
