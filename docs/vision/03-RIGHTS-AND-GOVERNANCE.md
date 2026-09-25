# 03 — Rights, governance and security

Rights are a **runtime constraint**, not a policy document. If the code does not enforce it, it is
not a rule. Every pipeline entry point calls the rights policy service and refuses on failure.

> This document is engineering guidance, not legal advice. Items marked **[COUNSEL]** need review
> by a qualified adviser before the relevant code ships.

---

## The four independent scopes

A source does not have "rights". It has four scopes that are granted separately, expire
separately, and are revoked separately.

| Scope | Question it answers | Blocks what |
|---|---|---|
| `canAnalyze` | May DTP run models over this footage internally? | All inference jobs |
| `canTrain` | May this footage enter a training corpus? | `VisionDatasetMember` insertion |
| `canPublishHighlight` | May a clip derived from this be shown publicly? | Highlight publication |
| `canShareWithScout` | May derived evidence be shown to external scouts or clubs? | Scout search results |

They are genuinely independent. A partner may permit internal analysis but not public clips. A
competition may permit recording but not model training. A player's guardian may consent to
DTP-internal development but not to the player appearing in marketing.

Each scope carries `grantedAt`, `expiresAt`, `restrictions` (free text plus structured flags),
`evidenceId`, and `revokedAt`.

### The policy service

```ts
interface RightsPolicy {
  canAnalyze(assetId: string): Promise<RightsDecision>;
  canTrain(assetId: string): Promise<RightsDecision>;
  canPublishHighlight(assetId: string, playerId?: string): Promise<RightsDecision>;
  canShareWithScout(assetId: string, playerId?: string): Promise<RightsDecision>;
}

type RightsDecision =
  | { allowed: true;  scopeId: string; expiresAt: Date | null }
  | { allowed: false; reason: RightsDenialReason; detail: string };
```

`RightsDecision` is never a bare boolean. A denial must say *why*, because the UI has to tell an
operator what to fix and the audit log has to record it. Denial reasons are an enum:
`no_scope`, `expired`, `revoked`, `pending_acquisition`, `restriction_violated`,
`minor_consent_missing`, `research_corpus`.

**Rule: a `false` return is a hard refusal, never a warning.** No code path may proceed past a
denial with a logged caveat.

---

## Public availability is not permission

The single most likely way this program goes wrong.

More than 60% of likely training footage already sits on partner YouTube channels. That is a
discovery advantage and nothing more.

| YouTube is | YouTube is not |
|---|---|
| A way to find candidate matches | A training data lake |
| Provenance and catalog metadata | A permission grant |
| A searchable archive reference | A reproducible source |

**A URL alone can never become a `VisionDatasetMember`.** The dataset member insert path checks:

1. The asset has an immutable object in R2 under DTP control, with a recorded SHA-256.
2. `corpus = dtp_owned`.
3. `canTrain` resolves to `allowed: true` right now.
4. Acquisition status is `acquired`, with a recorded method and authorization.

All four, in a transaction, every time. Not a validation warning — a foreign-key-level and
service-level refusal with a test proving it.

### Source preference order

For a match selected for training, obtain the best authorized copy available:

1. **Partner camera master / original** — best pixels, best jersey legibility, best ball visibility.
2. **Owner-authorized export** — when the original no longer exists.
3. **Approved platform copy** — only when both the rights and the *acquisition method* are explicitly cleared in writing.

`sourceQualityRank` records which tier was obtained, and it becomes a **benchmark slice**: model
performance on platform copies versus originals must be measured separately, because platform
compression degrades exactly the small-object detail (ball, jersey digits) the engine depends on.

### Acquisition methods

Exactly three, recorded on every acquisition:

- `partner_direct_upload` — partner uploads via a tokenized grant (see below)
- `partner_authorized_export` — owner supplies a file; DTP staff uploads it
- `platform_copy_authorized` — platform copy with written owner authorization attached as evidence

**V1 ships no automated downloader.** Catalog connectors read metadata only.

---

## Partner upload grants

Grassroots partners do not have DTP admin accounts, and creating one for every club secretary is
neither realistic nor safe. `VisionPartnerUploadGrant` issues a scoped upload link:

| Field | Purpose |
|---|---|
| `token` | Single-use, high-entropy, hashed at rest |
| `partnerId`, `sourceVideoRecordId` | What this grant is for |
| `expiresAt` | Short — days, not months |
| `maxBytes`, `allowedMimeTypes` | Abuse and cost control |
| `usedAt`, `uploadSessionId` | One grant, one upload |
| `createdByAdminUserId` | Audit |

The grant holder can initiate and resume a multipart upload to one pre-agreed object key and do
nothing else. They cannot list, read, or overwrite. Rights evidence must already be attached
before a grant can be issued.

---

## Minors

DTP is a grassroots and youth platform. Most subjects are under 18. This is a Phase 0
requirement, not a Phase 10 risk row.

**Decided 24 Sep 2026** ([Q2](./13-OPEN-QUESTIONS.md#q2--consent-for-minors--resolved-publication-and-scout-sharing-unblocked)):
**partners and guardians** may both grant consent; consent **extends to model training and scout
sharing**; it is **withdrawable, and published material must be taken down**.

`Player.dateOfBirth` already exists in the schema. Derived minor status drives:

| Control | Behaviour |
|---|---|
| Footage access | Raw media involving minors is visible only to roles holding `vision.media.raw.read`. Every access is written to the audit log with actor, asset, and reason. |
| Publication | Permitted under a valid `canPublishHighlight` scope from either grantor, and still requires reviewer approval of the specific clip. |
| Scout sharing | Permitted under `canShareWithScout`. **Every scout view of a minor's evidence is logged** with scout identity, player, and timestamp. |
| Training | Permitted under `canTrain`. |
| Retention | Youth footage carries its own retention clock, independent of the partner's rights window. |

### Two grantors, one resolution rule

Consent may attach at **partner level** or at **individual player level**. The rule is the same one
the whole rights engine uses: **most specific wins, and deny beats allow.**

So a guardian's player-level withdrawal overrides a partner-level grant. This is the single most
important behaviour in the rights engine and carries a dedicated test.

### Withdrawal is a takedown, with a clock

On withdrawal, in this order:

| Step | Timing |
|---|---|
| Flip the affected scopes to denied — every future rights check fails | **Immediate, synchronous** |
| Unpublish everything covered by the withdrawn scope, including promoted `SbHighlight` and `SbMatchEvent` rows | **Immediate, automatic** — no job required |
| Add to the retraining exclusion list | **Immediate** |
| Create deletion requests for stored derived media (clips, crops, proxies) | **Target 7 days** — default pending confirmation, see O1 |
| Preserve model lineage as an auditable record that the source was used and then excluded | Permanent |

The 7-day window is a proposed default recorded in
[13-OPEN-QUESTIONS O1](./13-OPEN-QUESTIONS.md#o1--data-subject-request-process-and-retention-periods--blocks-nothing-yet-needed-before-first-publication)
and is a configuration value, not a hard-coded constant.

**[COUNSEL]** One position is recorded as answered and the build proceeds on it: whether a *partner*
may consent on a minor's behalf. That is a legal question rather than an engineering one, and it is
the position most likely to be challenged. Worth confirming in the same pass as O1.

---

## Data protection

Nigeria's Data Protection Act 2023 establishes data-subject rights including access, rectification,
and erasure, and imposes obligations on controllers. None of the three source documents mention it.
Video of an identifiable player is personal data, and a player identity assignment is a processing
decision about a named individual.

**Decided 24 Sep 2026** ([Q3](./13-OPEN-QUESTIONS.md#q3--ndpa-posture--partially-resolved)):
**cross-border transfer is acceptable**, so no R2 jurisdiction restriction is applied.

Design implications already built into the model:

- `VisionDeletionRequest` exists as a first-class entity, not an ad-hoc process.
- Revocation lineage (below) is the mechanism that makes an erasure request executable.
- Audit logs record who accessed raw footage and who assigned an identity.
- R2 versioning is on for `master` and `models`, off elsewhere — a recorded decision, not a default.

### Defaults the build proceeds on, pending confirmation

**[COUNSEL]** These four numbers are the policy behind the mechanisms. They are configuration
values, so confirming or changing them later is a config change, not a redesign. Tracked as
[O1](./13-OPEN-QUESTIONS.md#o1--data-subject-request-process-and-retention-periods--blocks-nothing-yet-needed-before-first-publication).

| Item | Default in use |
|---|---|
| Data-subject request acknowledgement | 7 days |
| Data-subject request completion | 30 days |
| Takedown on withdrawal | Unpublish immediate; derived media deleted within 7 days |
| Retention absent a request | Master footage indefinite while rights are live; derived media 24 months from last use |

Still genuinely undecided and needed before the first publication: the **intake channel** for a
request, and the **controller/processor split** between DTP and partners.

---

## Revocation and deletion lineage

When rights are revoked — or a guardian withdraws consent, or a partner relationship ends — DTP
must be able to answer, in one query: *what is affected?*

```
VisionSourceVideoRecord
   └─ VisionVideoAsset (master object)
        ├─ VisionVideoVariant (proxy, HLS, thumbnails)
        ├─ VisionCrop / tracklet images
        ├─ VisionClip / VisionHighlight  ──► promoted SbHighlight
        ├─ VisionAnnotationTask / AnnotationVersion
        ├─ VisionDatasetMember ──► VisionDatasetVersion
        │                              └─ VisionModelVersion (trained from)
        ├─ VisionInferenceJob artifacts
        └─ VisionEventCandidate ──► promoted SbMatchEvent
```

Behaviour on revocation, in order:

1. **Immediately** flip the affected scopes to denied. Every future rights check fails. This is
   synchronous and requires no cleanup job.
2. **Immediately** unpublish derived public artifacts covered by the revoked scope (highlights,
   scout-visible evidence). Promoted `SbHighlight` / `SbMatchEvent` rows are unpublished, not
   deleted, and are marked with the revocation reference.
3. **Immediately** add the asset to the retraining exclusion list. Existing dataset versions are
   *not* mutated — they are immutable by design — but they are marked `containsRevokedMembers`
   and cannot be used for new training runs.
4. **On policy** (not automatically) create `VisionDeletionRequest` records for the stored objects,
   routed for approval according to the retention and legal policy.
5. **Never** delete model lineage. The auditable record that a source *was* used and *was then
   excluded* is itself the compliance artifact. Deleting history to look clean makes DTP unable to
   answer the question that matters.

There is a required integration test for this (PROMPT §8F): revoke one source, assert every layer
above is blocked or unpublished, and assert model lineage survives.

---

## Ground-truth hierarchy

Four distinct kinds of claim. They must never share a mutable row.

| Layer | Written by | Mutable | Example |
|---|---|---|---|
| **Machine prediction** | A model | **Never** | "box at frame 12 940, confidence 0.71" |
| **Annotator label** | A human annotator | Superseded, not edited | "this is player #9, not #6" |
| **Reviewer-approved label** | A reviewer with approval rights | Superseded, not edited | "approved: shot by Chinedu O., 47:12.340" |
| **Published fact** | A promotion step | Unpublished, not deleted | `SbMatchEvent` on the public site |

A correction creates a **new row** referencing the one it supersedes. `supersededBy` is a field on
every prediction. Nothing is ever `UPDATE`d in place, because the corrections are the training
signal — overwriting them throws away the most valuable data DTP generates.

---

## Security

| Control | Requirement |
|---|---|
| Object access | Short-lived signed URLs only. R2 buckets are never publicly readable. |
| Worker credentials | Job-scoped token, short TTL. **No long-lived R2 credentials and no database connection on worker hardware.** Workers request a presigned PUT per output key; the control plane validates the key falls under that job's prefix. |
| Upload URLs | Multipart part URLs scoped to one key, expiring in minutes; session resumable for days. |
| Playback | Signed, short-lived, and rights-checked at issue time. A previously issued URL is not a standing grant — TTL is minutes. |
| Secrets | Existing AWS Secrets Manager path (`dtp/staging/app`). R2 and provider credentials join it. Never in the repository. |
| File validation | Server-side MIME and container validation on finalize, by the worker during FFprobe, not by trusting the client. |
| Rate limits | Per-token on upload initiation and per-job on worker progress. |
| Audit log | Raw youth footage access, identity assignment, annotation approval, model promotion, publication, rights change, deletion request. Actor, target, timestamp, reason. |
| Youth footage | Access-controlled as above, and excluded from any bulk export or general scout surface. |
| Prompt injection | Overlays, scoreboards, and audio in footage are attacker-controllable input to a VLM. VLM output is schema-validated and can never write a numeric fact. See [09-ML-PIPELINE.md](./09-ML-PIPELINE.md). |
| Incident path | Defined for: wrong identity published, footage leak, consent withdrawn after publication, credential compromise. |

---

## Operational ownership

Who decides what, written down before the first dispute:

| Decision | Owner |
|---|---|
| Event taxonomy and label definitions | Football Lead |
| Whether a model may be promoted | Reviewer + ML Engineer, jointly; never the promoter alone |
| Whether a highlight may be published | Reviewer, subject to rights |
| Whether a source may be acquired | Vision Admin, subject to rights evidence |
| Resolution of a football-label dispute | Football Lead |
| Whether a rights position is sufficient | Vision Admin, escalating to counsel |

**ML engineers do not define football truth.** This is stated in the PID and is worth repeating
because it is the separation most likely to erode under delivery pressure.
