# FairPlay — pilot go/no-go checklist

Phase 6.7. What must be true before FairPlay records a real match. **The decision is Fola's.** This page
says where each item stands today, from the repository's own records, and proposes nothing beyond them.

## Where it stands, 1 November 2026

| Question | Proposed answer | Why |
|---|---|---|
| Show the synthetic demo to a stakeholder? | **Go, once Fola has read the draft report** | it uses no real footage, and nothing leaves DTP unless Fola sends it |
| Record a real match, even privately? | **No-go** | sections A to E below are open, starting with rights, legal advice and the kit |
| Deploy the cloud side to production? | **Already done; it stands** | CD put it on the live box when it merged, and Fola confirmed this on 1 November 2026. Using it still needs the approvals in section D, and does not by itself allow real footage |

The acceptance review (Phase 7) comes next, and is run by a reviewer who did not build this. Its verdict goes beside this page, not in place of it.

**Key:** ✅ done and evidenced · 🟡 done on synthetic data only · ⬜ not done · 🔒 waiting for a person's decision.

## A. Rights and people

Nothing here can be done by software.

| # | Item | Owner | Today |
|---|---|---|---|
| A1 | Lawful basis and consent model, with legal advice (B2, R16) | Fola, organisers | ⬜ |
| A2 | A signed competition agreement; the [rights sheet](./rights-checklist.md#before-any-real-match-fill-this-in) approved | Fola, organisers | ⬜ |
| A3 | No minors until A1 is settled (R16's decision) | Fola | 🔒 in force |
| A4 | Decisions RC1 to RC8 in the [rights checklist](./rights-checklist.md#decisions-for-fola) | Fola | 🔒 |
| A5 | A named person for each job, and a named watcher for each match (R7) | Fola | ⬜ |
| A6 | Operators trained ([operator guide](./operator-guide.md#training)), and a rehearsal with no real players | session lead | ⬜ |
| A7 | [residual-risks.md](./residual-risks.md) signed, with R23 to R26 decided | Fola | 🔒 |

## B. The kit

| # | Item | Owner | Today |
|---|---|---|---|
| B1 | [Equipment audit](./equipment-audit.md) answered; gate 1, single or two angles, decided (and so F28) | matchday crew, Fola | ⬜ |
| B2 | [Hardware validation](./hardware-validation.md) run and its sheet accepted, including the unexplained gap in [the demo's rehearsal](./demo-walkthrough.md#what-the-rehearsal-found) | crew, Fola | ⬜ |
| B3 | [Cost sheet](./cost-worksheet.md#the-sheet-for-each-venue) filled in from measured bitrates | crew, Fola | ⬜ |
| B4 | Anything bought, and any new monthly charge | Fola | 🔒 |

## C. Fixes that must land before real footage

From Fola's sign-off in [residual-risks.md](./residual-risks.md#sign-off), and what has been added since.

| # | Item | Today |
|---|---|---|
| R1 | A closed camera network, with the venue | ⬜ |
| R4 | Name constraints on the venue CA, and its key off the Edge | ⬜ |
| R8 | The other low findings, in one or two PRs | ⬜ |
| R16 | Lawful basis and request handling (A1) | ⬜ |
| R19 | Disk encryption and a named custodian | ⬜ |
| R25 | A rule for when incident footage is deleted, built, and the request document corrected. Needs RC1 and RC2 | 🔒 |
| R11 | Power loss tested on the venue kit (R10's boot units with it) | ⬜ |

## D. Approvals (R20, R21)

Each is Fola's, one by one. The [release notes](./release-notes.md#what-it-needs-if-it-goes-further) say what each does.

| # | Item | Today |
|---|---|---|
| D1 | The R2 bucket, and its checks that the stand-in S3 server cannot prove | 🔒 |
| D2 | The production migrations | ✅ applied by CD; Fola confirmed it stands, 1 Nov 2026 |
| D3 | The production deploy | ✅ done by CD; Fola confirmed it stands, 1 Nov 2026 |
| D4 | `FAIRPLAY_BUNDLE_SIGNING_KEY` | 🔒 |
| D5 | Licences: B9, B10, B10a, and whether an organiser's staff operating DTP's machine stays inside DTP ([licences.md](./licences.md)) | 🔒 |
| D6 | A hardware time source (B5), and HTTPS on a real reviewer device (B12) | ⬜ |
| D7 | Python package hashes (F20), which need an approved download | 🔒 |

## E. The product's targets

From the PID's section 14. Synthetic results show the software can do it. **Only the field pilot can pass these.**

| Target | Best result so far | Today |
|---|---|---|
| At least 99.5% of intended recording across a shadow match | 100% over 6 minutes; 97.17% in one demo rehearsal, unexplained | 🟡 |
| Replay: p95 at most 15 s on the reference laptop and LAN | 1.5 s, same machine as the Edge | 🟡 |
| A 30 s clip usually ready within 30 s | from the flag: p50 22 to 24 s, p95 34 to 36 s, 68 of 92 within 30 s, on synthetic feeds with 20-second files. Not measured at a venue | 🟡 |
| Two angles within 500 ms after calibration, or the uncertainty flagged | offset steady to 25 ms on synthetic feeds; uncertainty flagged when uncalibrated | 🟡 |
| Offline: a 30-minute WAN outage, with review carrying on and no corruption | passed in the failure drills | 🟡 |
| Data fidelity: every final original has a hash, source and time range | every file re-hashed clean in each run | 🟡 |
| Idempotency: the same batch 10 times, no duplicates or lost reviews | one batch ten times in the Edge's unit tests; a new item sent six times at once applied once in the cloud checks | 🟡 |
| Broadcast independence: kill the Edge and the livestream carries on | hardware validation G, not run | ⬜ |
| Security: unauthorised roles reach no private evidence; no public MediaMTX control | passed in `fairplay:securitycheck`; **a real bucket's privacy is not tested** | 🟡 |
| **Field pilot minimum: three full shadow-review matches,** covering normal play, disrupted internet, drone disconnect, storage alerts, late clip export and calibration corrections. Record p50 and p95 timings and failures | none | ⬜ |

## F. Always true

These are not gates. If any stops being true, stop.

- Shadow review and post-match evidence only. Nothing reaches a referee, and no decision or score changes.
- Not VAR, and not FIFA-authorised VAR or FVS.
- No public or anonymous access to footage, and no dispute clip published.
- No real youth video sent to a third-party AI service.
- No new recurring cloud charge, EC2 change, paid GPU, DNS change or production deploy without Fola's approval. A merge to `main` that passes CI is a production deploy, and runs any new migration.

## The decision

```text
FAIRPLAY PILOT GO/NO-GO
Date: __________   Match or rehearsal: ____________________   Venue: ____________
Sections A to E reviewed, with their sheets attached: ______
Open items accepted, and why: ___________________________________________________
Phase 7 review's verdict: ____________
Decision:  GO / NO-GO

Decided by: ____________________ (Fola Sanni)   Date: __________
```

## Handover for 6.7 (prompt pack section K)

```text
DTP FAIRPLAY | PHASE 6.7 DELIVERY
STATUS: demo, draft report, release notes and this checklist complete; Phase 6 complete on synthetic data; the proposed answer for real footage is NO-GO today, and the decision is Fola's

REPOSITORY FACTS CONFIRMED
- Existing patterns used: the fixture driver; the e2e check's cloud setup and scratch-database guard; the 6.3 console QA; the admin report page
- Hardware facts actually verified: none
- Unknowns remaining: everything in sections A and B; the cause of a 12 s recording gap on the laptop

IMPLEMENTED
- Code paths changed: fixtures/run_demo.py, compose.demo.yaml, services/api/scripts/fairplay-demo-cloud.ts (new, all test only); fairplay_edge/cloud.py (F27: wait 2 minutes, not 15, after NotReleasable)
- APIs and migrations: none
- Local/Cloud config: a package script, fairplay:democloud

SECURITY + COST
- Auth and evidence changes: none. The demo runs on its own Compose project and a scratch database, and refuses another. Its stand-in S3 server checks no signature, which the page says
- New dependencies and license: none
- New recurring cost: $0

TEST EVIDENCE
- Commands actually run: run_demo.py up twice (29/29 each), wan, check, estimate, down; the 12 steps in a browser; tests/test_demo_and_gonogo.py, tests/test_cloud.py, the Edge suite; the API typecheck, which does not cover scripts/, though the demo's cloud script ran
- Passed / failed / untested: a real audience, Ctrl-C in an interactive terminal, a Linux host, real footage untested
- Measured replay/CPU/RAM/SSD outcomes: replay 0.6 to 1.5 s; clips p50 2.0 s, p95 11 s over 6; one laptop, synthetic feeds, not results

RISKS, ROLLBACK, NEXT GATE
- Blocking defects: for real footage, sections A to E. None for the synthetic demo
- Steps to revert safely: revert the commit
- Human approvals required: section D, and reading the draft report before it leaves DTP
- Proposed next phase: Phase 7, the acceptance review, by a reviewer that did not build it
```
