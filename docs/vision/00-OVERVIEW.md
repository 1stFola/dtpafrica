# 00 — Vision Engine overview

## Mission

Convert rights-cleared Nigerian grassroots and youth football footage into a **traceable
football-intelligence layer**: detections, tracks, identities, pitch coordinates, ball and
possession state, football events, evidence clips, scouting metrics, AI-assisted qualitative
observations, and eventually fusion with DTP wearable tracking data.

Every derived fact must trace back to source video, timestamps, model version, dataset version,
calculation version, and a review decision.

## What the moat actually is

Not the object detector. Anyone can fine-tune a detector. DTP's durable asset is:

- the **rights-cleared Nigerian corpus** and the rights evidence behind it;
- the **annotations and human corrections** on that corpus;
- the **identity graph** linking tracks to real registered players;
- the **football event schema** and its mapping to ScoreBoard;
- the **evaluation history** — what worked, on which slice, and why;
- the **review loop** that turns analyst corrections into the next training batch.

Design decisions that trade any of those away for a faster demo are wrong decisions.

---

## In scope

- Partner source cataloguing, rights and provenance management.
- Authorized acquisition and direct-to-R2 resumable upload of match footage.
- Deterministic normalization: proxies, frame/time mapping, checksums, fingerprints, duplicate clustering.
- Annotation, review, and immutable versioned datasets from Nigerian footage.
- Player / goalkeeper / referee / ball detection.
- Tracking, team assignment, jersey candidates, roster-assisted player identity.
- Pitch calibration, pitch coordinates, tactical minimap.
- Ball possession segments and football event candidates.
- Evidence clips, player timelines, derived scouting metrics.
- VLM-assisted qualitative scouting description over *approved* evidence.
- Wearable/video synchronization and fused features (contract only in V1 — see below).
- MLOps: model registry, benchmark gates, active learning, cost observability.
- Admin/annotation frontend plus scout and player-facing read surfaces.

## Explicitly not in V1

| Not in V1 | Why |
|---|---|
| Autonomous scouting verdicts or transfer recommendations | Football truth needs a human owner. |
| Medical or injury inference from video | Out of competence and out of scope. |
| Face recognition as the normal identity mechanism | Minors. Identity is roster + team + jersey + track evidence. |
| GPS-grade speed/distance from uncalibrated single-camera video | False precision harms players and DTP's credibility. |
| Live / real-time match analysis | Offline quality must be proven first. |
| Commercial training on SoccerNet or any research-only corpus | Licence prohibits it. See [OSS register](../licenses/OSS_REGISTER.md). |
| A black-box end-to-end VLM producing events, metrics, and identities | No provenance, no review, no recourse. |
| Automated downloading of third-party platform video | Acquisition is a rights-gated human workflow. See [03](./03-RIGHTS-AND-GOVERNANCE.md). |
| **Wearable hardware integration** | No device exists in the product yet. Phase 9 ships the *contract*, not an integration. |

---

## Product principles

1. **Evidence before prose.** Every player claim links to source timestamps and machine or human evidence.
2. **Human-in-the-loop by design.** Identities, uncertain events, and publication decisions are correctable without corrupting the original prediction.
3. **Nigeria-domain first.** Benchmark low light, handheld shake, wide shots, compressed social video, uneven pitches, inconsistent kits. European broadcast footage is not the target distribution.
4. **Provenance everywhere.** Dataset version, model version, prompt version, calculation version, reviewer — all recorded.
5. **Rights are a runtime constraint,** not a policy document. The code enforces them.
6. **Modular adapters.** Detectors, trackers, VLMs, object stores, and GPU providers are swappable.
7. **Cost-aware staging.** Cheap checks first, expensive models last, and only on selected clips.
8. **Unknown beats wrong.** `ball_unknown`, `identity_unknown`, `calibration_invalid` are correct answers.

---

## Personas and their permissions

These map onto the **existing** DTP RBAC system (`AdminRole` / `AdminPermission`), not a new one.
See [04-DATA-MODEL.md § RBAC](./04-DATA-MODEL.md#rbac-extends-the-existing-catalogue).

| Persona | Role slug | Can | Cannot |
|---|---|---|---|
| Vision Admin | `vision_admin` | Configure sources, rights, jobs, models, publication policy | — |
| Annotator | `vision_annotator` | Label frames, tracks, identities, events | Promote models, publish, approve |
| Reviewer | `vision_reviewer` | Approve/reject annotations, identities, events, highlights; resolve disagreements | Train or promote models |
| ML Engineer | `vision_ml_engineer` | Build datasets, train, evaluate, submit promotion requests | Approve own promotion; publish football facts |
| Scout (read-only) | `vision_scout_readonly` | Search approved evidence, compare players, write scouting notes | See raw training media or unapproved predictions |

Two separations of duty are deliberate and must survive implementation:

- **An ML engineer cannot define football truth.** Event taxonomy and label definitions are owned by the Football Lead.
- **A model promoter cannot be the sole approver of their own promotion.** See [10-EVALUATION-AND-GATES.md](./10-EVALUATION-AND-GATES.md).

---

## What success looks like (V1)

A DTP operator can, without engineering help:

1. Register a partner source record and attach rights evidence.
2. Get an authorized match copy uploaded directly to R2 over an unreliable Nigerian connection, resuming after interruption.
3. Link it to a competition, teams, and rosters that already exist in ScoreBoard.
4. Normalize it reproducibly, with exact frame/time mapping and duplicate detection.
5. Run an approved model on an on-demand GPU worker — with no video byte ever touching the EC2 box.
6. Review and correct detections, tracks, identities, and events.
7. Freeze an immutable, rights-clean dataset version.
8. Train and evaluate a model against a locked Nigeria benchmark.
9. Produce approved evidence clips and player-level outputs carrying full provenance.
10. Trace any public claim back to source evidence, model, calculation, and reviewer.
11. Revoke rights and have every affected asset blocked through the lineage graph.
12. State the measured cost per analyzed match, and change GPU provider without touching the data model.

---

## Where this sits in the platform

```
ScoreBoard  ──── matches, teams, squads, events ────┐
                                                     │
Player registry ──── Player, slug, roster ──────────┤
                                                     ├──► Vision Engine
SIP / calibration ──── tactical scores ─────────────┤     (consumes + enriches)
                                                     │
MVCE ──── valuation runs ───────────────────────────┘
```

The Vision Engine **reads** the existing football graph and **writes back** reviewed evidence:
approved events into `SbMatchEvent`, approved clips into the highlight surface, and derived
metrics into player profiles. It never forks the football graph. See
[04-DATA-MODEL.md](./04-DATA-MODEL.md).
