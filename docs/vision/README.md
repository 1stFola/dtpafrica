# DTP Vision Engine — documentation set

Football video intelligence for DTP Africa: turning rights-cleared Nigerian match footage into
reviewed, reproducible player evidence.

**Status:** Phase 0 complete ([gate: PASS](./15-PHASE-0-IMPLEMENTED.md)). **Phase 1 functionally complete** — job spine ([PASS](./16-PHASE-1-INCREMENT-1.md)), worker container ([PASS](./17-PHASE-1-INCREMENT-2.md)), asset projection ([PASS](./18-PHASE-1-INCREMENT-3.md)), resumable upload ([PASS](./19-PHASE-1-INCREMENT-4.md)) and the catalog with partner links ([PASS](./20-PHASE-1-INCREMENT-5.md)). Both hosted compute providers now exist with a shared conformance suite ([21](./21-COMPUTE-PROVIDERS.md)), unverified against live services until Spike S0. **Phase 2 Increment 1 complete** — the dataset factory's eligibility firewall and leakage checker ([PASS](./22-PHASE-2-INCREMENT-1.md)). **Increment 2 complete** — annotation: supersede-never-overwrite, the claim race, and proxy-only access ([PASS](./23-PHASE-2-INCREMENT-2.md)). **Increment 3 complete** — the review workstation, and the frame arithmetic under it ([PASS](./24-PHASE-2-INCREMENT-3.md)). **Increment 4 complete** — the Nigeria gold benchmark: two independent reviewers, measured disagreement, and gold that cannot be trained on across versions ([PASS](./25-PHASE-2-INCREMENT-4.md)). **Increment 5 complete** — the FiftyOne export and its QA report: seven refusals at the last door, and the source-to-proxy frame conversion under them ([PASS](./26-PHASE-2-INCREMENT-5.md)). **Phase 2 build list is complete** apart from the CVAT adapter, which was never a blocker. Next: Spike S0, which needs a GPU credential.
**Source documents reconciled:** PID v2.0, Infrastructure Architecture & Build Handoff v1, Master Coding Agent Prompt v2.0 (all 24 Sep 2026).
**Conforms to:** Architecture Freeze v1 — see [the mapping](./01-ARCHITECTURE.md#conformance-to-architecture-freeze-v1).
**Last updated:** 24 September 2026.

---

## Read in this order

| # | Document | Read it when |
|---|----------|--------------|
| — | [00-OVERVIEW.md](./00-OVERVIEW.md) | You need to know what the Vision Engine is and is not. **Start here.** |
| — | [01-ARCHITECTURE.md](./01-ARCHITECTURE.md) | You need the system topology and where code goes. |
| — | [02-DECISIONS.md](./02-DECISIONS.md) | You hit a contradiction between the source documents, or want to know why something differs from them. |
| — | [03-RIGHTS-AND-GOVERNANCE.md](./03-RIGHTS-AND-GOVERNANCE.md) | Before touching any footage, dataset, or publication path. |
| — | [04-DATA-MODEL.md](./04-DATA-MODEL.md) | You are writing a migration or a Prisma model. |
| — | [05-STORAGE.md](./05-STORAGE.md) | You are writing anything that reads or writes an object. |
| — | [06-JOBS-AND-COMPUTE.md](./06-JOBS-AND-COMPUTE.md) | You are writing a worker, a queue, or a GPU provider adapter. |
| — | [07-API-CONTRACTS.md](./07-API-CONTRACTS.md) | You are adding an endpoint. |
| — | [08-FRONTEND.md](./08-FRONTEND.md) | You are adding a screen. |
| — | [09-ML-PIPELINE.md](./09-ML-PIPELINE.md) | You are wiring a model, tracker, or annotation flow. |
| — | [10-EVALUATION-AND-GATES.md](./10-EVALUATION-AND-GATES.md) | You are about to claim a model is good enough. |
| — | [11-PHASE-PLAN.md](./11-PHASE-PLAN.md) | You are planning a sprint or asking "what's next". |
| — | [12-COST-MODEL.md](./12-COST-MODEL.md) | You need the cost-per-match number or a GPU choice. |
| — | [13-OPEN-QUESTIONS.md](./13-OPEN-QUESTIONS.md) | **Decisions record** — what leadership answered on 24 Sep 2026, and the two items still open. |
| — | [14-RIGHTS-EVIDENCE-REQUIREMENTS.md](./14-RIGHTS-EVIDENCE-REQUIREMENTS.md) | You are onboarding a partner, or drafting the rights template. |
| — | [15-PHASE-0-IMPLEMENTED.md](./15-PHASE-0-IMPLEMENTED.md) | **What is actually built** in Phase 0, gate evidence, and what is deferred. |
| — | [16-PHASE-1-INCREMENT-1.md](./16-PHASE-1-INCREMENT-1.md) | The job spine: queue, worker API, credential model. |
| — | [17-PHASE-1-INCREMENT-2.md](./17-PHASE-1-INCREMENT-2.md) | The worker container: probe, fingerprint, transcode. |
| — | [18-PHASE-1-INCREMENT-3.md](./18-PHASE-1-INCREMENT-3.md) | Stage findings reaching the asset, and duplicate clustering. |
| — | [19-PHASE-1-INCREMENT-4.md](./19-PHASE-1-INCREMENT-4.md) | Resumable upload, and the dispatcher that reaps abandoned work. |
| — | [20-PHASE-1-INCREMENT-5.md](./20-PHASE-1-INCREMENT-5.md) | The catalog, the operator screens, and partner upload links. |
| — | [21-COMPUTE-PROVIDERS.md](./21-COMPUTE-PROVIDERS.md) | Both hosted providers, the conformance suite, and what the second one revealed. |
| — | [22-PHASE-2-INCREMENT-1.md](./22-PHASE-2-INCREMENT-1.md) | The dataset factory: why footage cannot enter a corpus, and why a leaking dataset cannot be frozen. |
| — | [23-PHASE-2-INCREMENT-2.md](./23-PHASE-2-INCREMENT-2.md) | Annotation: why a correction is never lost, and why the dev server was not validating anything. |
| — | [24-PHASE-2-INCREMENT-3.md](./24-PHASE-2-INCREMENT-3.md) | The review workstation: three clocks that must never be confused, and a route that had no auth. |

Also: [`docs/licenses/OSS_REGISTER.md`](../licenses/OSS_REGISTER.md) — every third-party
component, with its code / weights / dataset licence tracked separately. Nothing ships without
an entry.

---

## The five rules that override everything else

If you remember nothing else from this documentation set:

1. **Rights gate every action.** No analysis, training, or publication happens unless the
   relevant scope on that source is valid *right now*. A public YouTube URL is not permission.
2. **Unknown beats wrong.** Never force a player identity, a ball coordinate, or a speed metric
   when the evidence is weak. `unknown` is a first-class value throughout.
3. **Never overwrite raw evidence.** Source media, original model outputs, and approved dataset
   versions are immutable. Corrections are new rows that supersede, never edits in place.
4. **Provenance or it didn't happen.** Every derived fact carries source video, timestamp, model
   version, dataset version, calculation version, and review state.
5. **EC2 never touches video bytes.** The control plane is a 2 vCPU / 2 GB t3.small running the
   whole existing platform. It issues signed URLs and coordinates jobs. It does not upload,
   transcode, or infer.

---

## Relationship to the existing DTP platform

The Vision Engine is a **subsystem of the existing monorepo**, not a separate product. It reuses
the existing NestJS API, Prisma schema, React admin shell, and RBAC. It binds to the existing
football graph (`Player`, `SbMatch`, `SbTeam`, `SbCompetition`, `SbTeamSquad`) rather than
creating a parallel one.

A GPU pipeline failure must never take down `dtp.africa`. See
[01-ARCHITECTURE.md § Failure isolation](./01-ARCHITECTURE.md#failure-isolation).
