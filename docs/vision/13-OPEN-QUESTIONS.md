# 13 — Decisions and remaining open questions

**Answered by DTP leadership: 24 September 2026.** All Phase 0 and Phase 1 blockers are cleared.
Two residual items remain open and are named at the bottom.

---

## Resolved

### Q1 — Partners and paperwork — **RESOLVED, Phase 1 unblocked**

| Question | Decision |
|---|---|
| Initial partner cohort | **All partners** |
| Do agreements cover model training and derivative data? | **Yes — the agreements cover all four scopes** |
| Is there a template covering the four scopes separately? | **Not yet** — to be produced. See [14-RIGHTS-EVIDENCE-REQUIREMENTS.md](./14-RIGHTS-EVIDENCE-REQUIREMENTS.md) |
| Who may authorize an acquisition? | **Team Managers** |

**Implementation consequences**

1. "The agreements cover all" becomes a **partner-level `VisionRightsScope`** with all four scopes
   granted — not a global default. The code still requires a `VisionRightsEvidence` record per
   partner, pointing at the actual agreement document in the `master` bucket. That is the design
   working as intended: the claim is recorded per partner with its evidence, so it can be
   audited and, if one partner's position turns out to be different, corrected without touching
   the others.
2. **Team Managers must be recorded as authorized signatories.** New entity
   `VisionPartnerAuthorizedSignatory` (name, role, contact, evidence of authority, active period).
   An acquisition authorization records *which* signatory authorized it.
3. **One risk worth naming:** a Team Manager is not necessarily the copyright owner of the footage.
   Where a third-party videographer or channel owner shot and published it, their authorization is
   the one that matters for the training and publication scopes. The catalog records
   `rightsOwner` separately from `partner` precisely so this is visible rather than assumed —
   worth a spot check on the first few acquisitions.

### Q2 — Consent for minors — **RESOLVED, publication and scout sharing unblocked**

| Question | Decision |
|---|---|
| Who may grant consent? | **Partners and guardians** |
| Withdrawable? | **Yes — and published material must be taken down** |
| Does analysis consent extend to model training? | **Yes** |
| Does it extend to scout sharing? | **Yes** |

**Implementation consequences**

1. **Two grantor levels, and the conflict rule matters.** Consent may attach at partner level or at
   individual player level. The existing resolution rule applies unchanged: **most specific wins,
   and deny beats allow.** A guardian's player-level withdrawal therefore overrides a partner-level
   grant. This is the single most important behaviour in the rights engine and has a dedicated test.
2. **Withdrawal is a takedown, with a clock.** On withdrawal:
   - unpublish everything covered by the withdrawn scope — **immediate and automatic**, no job required;
   - add to the retraining exclusion list — immediate;
   - create deletion requests for stored derived media (clips, crops) — **target 7 days**;
   - preserve model lineage as an auditable record that the source was used and then excluded.
   The 7-day figure is a proposed default and needs confirming — see Open item O1.
3. `Player.guardianName/Email/Phone` already exist and are the hook. Consent evidence attaches as
   `VisionRightsEvidence` with `kind = consent_form`.
4. **One flag, then we proceed:** whether a *partner* can consent on a minor's behalf is a legal
   question, not an engineering one. It is recorded as answered and the build proceeds on it; it is
   worth confirming in the same pass as O1 because it is the position most likely to be challenged.

### Q3 — NDPA posture — **PARTIALLY RESOLVED**

| Question | Decision |
|---|---|
| Cross-border transfer / R2 jurisdiction acceptable? | **Yes** |
| Data-subject access and erasure process | **Still open — see O1** |

Cross-border transfer being acceptable resolves the jurisdiction half of Q4 as well: no R2
jurisdiction restriction is required.

### Q4 — R2 configuration — **RESOLVED (default accepted, jurisdiction confirmed by Q3)**

- Versioning **on** for `master` and `models`; off for `derived` and `clips`.
- **No jurisdiction restriction** — confirmed by Q3.
- Daily metadata database backup.
- Replication: not enabled initially; R2 durability plus versioning on the irreplaceable buckets is
  the starting posture, documented in [05-STORAGE.md](./05-STORAGE.md#lifecycle-and-retention).

### Q5 — External scout accounts — **RESOLVED: yes**

This is **new scope** and worth being explicit about, because nothing in the platform supports it
today. DTP has `AdminUser` (staff) and academy users (`AcademyAuthGuard`, `AcademyScopeGuard`).
There is no scout identity.

**What "yes" requires**

| Need | Notes |
|---|---|
| Scout registration and vetting | A scout account grants access to evidence about minors. It cannot be self-service signup. |
| Scout auth | Either extend the academy portal's auth or add a parallel scout portal. Recommendation: **a third auth context modelled on the academy one**, because scout scoping is by player/competition interest rather than by academy ownership. |
| Rights filtering per row | `canShareWithScout` is checked at query time, per result. Already designed. |
| Access audit | Every scout view of a minor's evidence is logged with scout identity, player, and timestamp. Non-negotiable given Q2. |
| Scout-facing surfaces | Search, player comparison, saved shortlists, scouting notes |

**Scheduling:** the scout *identity and portal* work is platform work, not Vision work, and it is on
the critical path for Phase 8. It should be built by the platform team in parallel from roughly
Phase 5 onward rather than discovered at Phase 8. Until it exists, `vision_scout_readonly` remains
a staff role. Tracked in [11-PHASE-PLAN.md](./11-PHASE-PLAN.md).

### Q6 — First competitions — **RESOLVED: all competitions**

Catalog **all** competitions. That is the right answer and it is cheap — cataloguing is metadata
only and carries no rights or storage cost.

**Acquisition and annotation must still be ordered**, because those are what cost money and analyst
hours. The PID's own guidance applies: maximize *variation* before *volume*. Recommended order for
the first dataset, drawn from the competitions already seeded in the platform:

| Order | Competition | Why first |
|---|---|---|
| 1 | **Lagos Queens Cup 2026** | Women's football. The corpus currently has **zero** female representation, and it is the single largest missing slice. |
| 2 | **Coal City Scouting Tournament 2026** | Enugu — non-Lagos geography, different pitches, venues, and camera operators. |
| 3 | **Scout to Pro International Tournament 2026** | International sides: different kits, likely different camera setup and venue. |
| 4 | **1xCup 2026** | Multi-zone Lagos. Volume plus zone-to-zone variation once the three above are covered. |
| then | Jagaban Cup, DSL League, RAK League, Ex Internationals Cup | Depth, once the variation axes are populated. |

One or two matches from each of the first four beats ten from any single one. The
representation dashboard in [08-FRONTEND.md](./08-FRONTEND.md#dataset-registry--adminvisiondatasets)
exists to keep this honest as the corpus grows.

### Q7 — ScoreBoard and Vision events — **RESOLVED: option (b), Vision enriches**

The recorder's pitch-side `SbMatchEvent` stays **canonical**. Vision proposes candidates that
enrich it — precise timestamps, actor confirmation, evidence links, clips — and does not overwrite it.

The answer initially read ambiguously ("ScoreBoard adopt Vision events" alongside an explicit
selection of default (b)). **Re-confirmed by DTP leadership: option (b).** No further ambiguity.

Under (b), the promotion step from
[02-DECISIONS.md D10](./02-DECISIONS.md#d10--highlights-and-events-collide-with-existing-models)
becomes an *enrichment* step: it attaches Vision evidence to an existing `SbMatchEvent` where one
matches, and creates a new one only where the recorder logged nothing and a reviewer approves it.

### Q8 — Wearable hardware — **RESOLVED: in development**

Phase 9 stays **contract-only**, as designed. Two consequences:

1. This *strengthens* the decision to suppress video-derived speed and distance
   ([09-ML-PIPELINE.md](./09-ML-PIPELINE.md#metrics--phase-7)). Real wearable ground truth is
   coming; shipping false-precision video estimates now would mean publishing numbers that get
   contradicted by DTP's own hardware later.
2. **What is needed from the hardware team, when available:** sample data format, sampling rate,
   clock source and drift characteristics, device-to-player binding mechanism, and export path.
   Those five facts determine the Phase 9 schema.

### Q10, Q11, Q12 — defaults stand

- **Q10 CVAT hosting** — deferred. Native review workstation first.
- **Q11 Annotation team** — the design assumes annotators do not get `vision.media.raw.read`; safe under either answer.
- **Q12 GPU budget** — jobs queue and the dashboard alerts when the cap is hit. Nothing silently overspends or silently fails.

### Q9 — Postgres growth — resolved as a cost line

Grow the root EBS volume from 20 to 100 GiB before Phase 3: one Terraform line, about
+$6.40/month. Not an architecture decision. See [12-COST-MODEL.md](./12-COST-MODEL.md#the-existing-aws-bill-and-what-vision-does-to-it).

---

## Still open

### O1 — Data-subject request process and retention periods — **blocks nothing yet; needed before first publication**

**Owner:** counsel, with DTP operations.

Q3 left this unanswered, and Q2's "withdrawable, take the materials off" needs an operational
process behind it. Four things needed:

1. **Intake channel** — how does a guardian or player actually make the request?
2. **Response window** — a committed number. Proposed default: **acknowledge in 7 days, complete in 30**.
3. **Takedown clock** — how fast must derived media come down? Proposed default: **unpublish immediate, delete within 7 days**.
4. **Retention periods** — how long is footage kept absent a request? Youth footage specifically. Proposed default: **master footage indefinite while rights are live; derived media 24 months from last use**.

The mechanisms exist (`VisionDeletionRequest`, revocation lineage, audit logs). The four numbers
above are the policy that drives them. **The build proceeds on the proposed defaults**; they are
documented in [03-RIGHTS-AND-GOVERNANCE.md](./03-RIGHTS-AND-GOVERNANCE.md) as defaults pending
confirmation, and changing them later is a configuration change, not a redesign.

### O2 — Scout portal product definition — **blocks Phase 8**

**Owner:** DTP product.

Q5 answered "yes" to scout accounts. Still needed before Phase 8:

- Who qualifies as a scout, and who vets them?
- Is access paid, free, or tiered? (This changes the auth and entitlement model.)
- Does a scout see one competition, a region, or everything cleared for sharing?
- Extend academy auth, or a separate scout portal? (Recommendation: separate, modelled on academy auth.)

Not urgent now. Needed by roughly Phase 5 so the platform team can build it in parallel.
