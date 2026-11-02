# FairPlay — release notes

## 0.1.0: pilot candidate, not released

**The cloud side is on the live server; nothing else is deployed.** CD deploys every green merge on `main` to the box serving the live site, so FairPlay's API routes and both migrations, `20261028000000_fairplay_cloud` and `20261030000000_fairplay_requests`, have been there since #310 and #324 merged. Fola confirmed on 1 November 2026 that this stands ([decisions.md](./decisions.md)). As far as the repository records, no R2 bucket exists, no signing key has been made and no FairPlay role has been assigned; the live environment was not read to check. No Edge is installed at a venue and no Git tag has been cut.
Whether this goes further is on the [go/no-go checklist](./go-no-go.md). The version is the Edge's own, `0.1.0`.

**V1 is shadow review and post-match evidence only.** It does not contact referees, change a decision or a score, or claim FIFA-authorised VAR or FVS status.

### What it contains

| Part | What it does | Merged in |
|---|---|---|
| Edge foundation | MediaMTX and FastAPI on one machine: two feeds recorded separately, each segment hashed, a watchdog, holds and bounded retention | [#303](https://github.com/1stFola/dtpafrica/pull/303) |
| Replay console | live preview, replay beside it, jumps, camera offsets and their uncertainty, sign-in with a matchday PIN | [#303](https://github.com/1stFola/dtpafrica/pull/303) |
| Incidents and evidence | incidents, shadow findings, clips by stream copy with a manifest and hashes, the rights gate, an organiser's view | [#305](https://github.com/1stFola/dtpafrica/pull/305), [#307](https://github.com/1stFola/dtpafrica/pull/307) |
| Cloud | pairing, the signed operator list, idempotent sync, a checked audit chain, presigned clip uploads, reports at `/admin/fairplay` | [#310](https://github.com/1stFola/dtpafrica/pull/310) |
| Hardening | threat review and fixes, failure drills, storage limits, security tests, time-sync warnings, the request and withdrawal tool, runbook, residual risks | [#311](https://github.com/1stFola/dtpafrica/pull/311), [#313](https://github.com/1stFola/dtpafrica/pull/313), [#316](https://github.com/1stFola/dtpafrica/pull/316), [#317](https://github.com/1stFola/dtpafrica/pull/317), [#321](https://github.com/1stFola/dtpafrica/pull/321) to [#326](https://github.com/1stFola/dtpafrica/pull/326) |
| Pilot packaging | installer and controlled update, backup and restore, operator guide, hardware checklist and measuring tool, licence review and install guard, cost worksheet and rights checklist | [#327](https://github.com/1stFola/dtpafrica/pull/327) to [#332](https://github.com/1stFola/dtpafrica/pull/332) |
| This increment | the stakeholder demo, this page, the go/no-go checklist, and F27 | Phase 6.7 |

### Components

| Part | Version |
|---|---|
| Edge | 0.1.0, Python 3.12, SQLite |
| MediaMTX | 1.21.3, pinned by digest |
| FFmpeg | Debian 13's 7.1 series, reviewed at 7.1.5 |
| Every other part | [THIRD_PARTY_NOTICES.md](../../services/fairplay-edge/THIRD_PARTY_NOTICES.md) |

### What it needs if it goes further

Each is Fola's explicit approval, and none is done. A merge to `main` that passes CI is itself a production deploy, and runs any new migration.

2. **A private R2 bucket** ([phase-4-cloud.md](./phase-4-cloud.md#approvals-needed)), and `FAIRPLAY_STORAGE_BACKEND=r2` with its values.
3. **`FAIRPLAY_BUNDLE_SIGNING_KEY`,** generated on the server and never in the repository.
4. An Edge machine, installed by [edge-install.md](./edge-install.md).

Nothing changes for anyone until an admin assigns a FairPlay role.

**To roll back:** an Edge goes back by hand to its previous tag, with its backup after a schema change ([edge-install.md](./edge-install.md)). In the cloud, stop assigning FairPlay roles and set `FAIRPLAY_STORAGE_BACKEND=off`. FairPlay's audit tables are insert-only by design, so the migrations stay in place, and the routes stay on the API unless a code change removes the module.

### Known limits

- **Every test used synthetic footage.** Nothing has run on real cameras, a real venue, a Linux host's systemd units or a real R2 bucket (R22).
- **Footage around an incident is never deleted** as built, which blocks real footage (R25). Three other periods have nothing enforcing them (R26).
- **Licences:** every Edge row is still `REVIEW REQUIRED`, awaiting B9, B10 and B10a.
- **F28:** a report can say "single angle" with two cameras, until gate 1 is decided.
- **An unexplained 12 s recording gap** in one laptop rehearsal ([demo-walkthrough.md](./demo-walkthrough.md#what-the-rehearsal-found)).
- Open risks and decisions are all in [residual-risks.md](./residual-risks.md), and its signature is still Fola's.

**One more production migration:** `20261101000000_fairplay_view_original_roles` gives the existing operator and assessor roles `fairplay.evidence.view_original`. It is additive and changes no schema. A deploy runs it.
