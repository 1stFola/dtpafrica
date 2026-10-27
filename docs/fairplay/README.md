# DTP FairPlay

Venue-local match replay, shadow review and verifiable video evidence, linked to ScoreBoard
matches. **A proposed feature: none of it is built.** Source of truth is the *DTP FairPlay
Product Implementation Document v1.0* (23 Oct 2026) and its coding-agent prompt pack; where
this folder departs from them, an ADR says why.

V1 is shadow review and post-match evidence only. It does not talk to referees, change a
decision or a score, or claim VAR/FVS status.

| Document | What it holds |
|---|---|
| [inventory.md](./inventory.md) | What exists in the repo and in production that FairPlay sits on |
| [architecture.md](./architecture.md) | Current and target data flow, components, MediaMTX hardening, browser security, time model, threat model, cost, licences |
| [equipment-audit.md](./equipment-audit.md) | The matchday-kit questionnaire; every row UNVERIFIED |
| [integration-map.md](./integration-map.md) | Extension points, schema mapping, permissions, API outline, sync contract |
| [phase-plan.md](./phase-plan.md) | Gate decisions, P0 backlog with effort ranges, blockers, rollback |
| [adr/](./adr/) | 0001 shadow only · 0002 cloud in existing API · 0003 Edge stack · 0004 local console + TLS · 0005 pairing + offline identity · 0006 evidence storage · 0007 no Vision training path · 0008 single-angle mode · 0009 linking to ScoreBoard |

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

**Test evidence** — none to report: Phase 0 wrote documents only, and no test was run.
The upstream MediaMTX defaults this design depends on (anonymous publish/read/playback,
`playbackAllowOrigins: ["*"]`, `recordDeleteAfter: 1d`) were read from its repository on
27 Oct 2026; the PID's links to MediaMTX's recording and playback docs return 404 (the files
have been renumbered to `08-record.md` and `09-playback.md`).

**Human approvals required** — the seven gate decisions in
[phase-plan.md](./phase-plan.md#phase-0--discovery-this-folder), and the equipment audit.

**Rollback** — delete this folder.

**Next phase** — Phase 1, Edge media foundation, starting on synthetic feeds.
