# 14 — Rights evidence requirements

Q1 established that existing partner agreements cover all four scopes, but that **no template
exists** for new partners. This document specifies what a DTP footage-rights document must capture
so that the four scopes can be recorded, audited, and revoked in the system.

> This is a **requirements checklist for counsel to draft against**, not a contract and not legal
> advice. It says what the system needs to be able to read out of the paperwork. The wording is
> counsel's job.

---

## Why a template matters even though the current agreements "cover all"

The rights engine grants four independent scopes. If the paperwork grants them as an undifferentiated
bundle, then three things become impossible:

1. **Partial revocation.** A partner who wants to stop public highlights but continue internal analysis
   has no way to express that, so the only available action is to revoke everything.
2. **Expiry per scope.** Publication rights commonly have a shorter life than analysis rights.
3. **Honest answers under audit.** "It was covered by the agreement" is not a position DTP can defend
   if the agreement never named the use.

The existing agreements are recorded as they are — a partner-level grant of all four scopes with the
document attached. The template is for everything signed from here on.

---

## The four scopes, in the language the document must distinguish

| System scope | What the document must permit |
|---|---|
| `canAnalyze` | DTP may process the footage with automated systems for internal analysis, producing derived data, and store that data. |
| `canTrain` | DTP may use the footage and its derived annotations to train, evaluate, and improve machine-learning models, **including models that continue to operate after the footage itself is deleted**. |
| `canPublishHighlight` | DTP may publish clips and stills derived from the footage on DTP surfaces and, where stated, in marketing. |
| `canShareWithScout` | DTP may disclose derived evidence, clips, and metrics to third-party scouts, clubs, and agents through DTP's platform. |

Each needs its own grant, its own expiry, and its own withdrawal mechanism. The `canTrain` clause
needs particular care — model weights are not deletable in the way a video file is, which is why
the system preserves lineage and excludes from *future* training rather than promising unlearning.
The paperwork should say that plainly rather than implying otherwise.

---

## Required fields

### Parties and authority

| Field | Why the system needs it |
|---|---|
| Partner legal name | `VisionSourcePartner` |
| **Rights owner**, if different from the partner | The partner may not own the footage. A club can authorize access to a match a third-party videographer owns and published. This field prevents that being assumed away. |
| Authorized signatory: name, role, contact | `VisionPartnerAuthorizedSignatory`. Q1 established this is the **Team Manager**. |
| Evidence of that person's authority | So an acquisition authorization is defensible later |
| Effective date, term, renewal or expiry | `VisionRightsScope.grantedAt` / `expiresAt` |

### Scope of footage

| Field | Why |
|---|---|
| Which competitions, seasons, teams | Bounds the grant. An open-ended grant is harder to defend than a bounded one. |
| Whether it covers footage already recorded, footage yet to be recorded, or both | Determines whether back-catalogue acquisition is covered |
| Source types covered: camera masters, exports, platform copies | Feeds `sourceQualityRank` and the acquisition method |

### The four scopes

For each of the four, separately: granted yes/no, any restriction, expiry, and territory if limited.

### Minors

Q2 established that **partners and guardians** may both grant consent, and that consent extends to
training and scout sharing. The document must therefore record:

| Field | Why |
|---|---|
| Whether the partner warrants it has authority to consent on behalf of minor players | This is the position most likely to be challenged. It belongs in writing, not in an assumption. |
| Whether guardian consent is collected separately, and by whom | Determines whether DTP needs its own guardian consent flow per player or relies on the partner's |
| That player-level withdrawal overrides the partner-level grant | Matches the system's behaviour: most specific wins, deny beats allow |
| Any restriction on publishing identifiable minors | Feeds `VisionRightsScope.restrictions` |

### Withdrawal and deletion

| Field | Why |
|---|---|
| How withdrawal is communicated, and to whom | Intake channel for O1 |
| Takedown window | Proposed default: unpublish immediately, delete derived media within 7 days |
| Acknowledgement that model lineage is retained as an audit record | So the retained-lineage behaviour is contractually expected rather than a surprise |
| What happens to derived data on term expiry | Distinct from withdrawal |

### Operational

| Field | Why |
|---|---|
| How footage is handed over: upload link, physical media, export | Feeds the acquisition method |
| Warranty that the partner has the right to grant what it is granting | Standard, and the thing that matters most if it turns out to be untrue |
| Governing law and dispute forum | Counsel's call |

---

## How a signed document becomes system state

```
1. Counsel-approved agreement signed
        │
2. PDF uploaded → master bucket → VisionRightsEvidence
        │           kind = contract
        │
3. Signatory recorded → VisionPartnerAuthorizedSignatory
        │
4. Scopes granted → VisionRightsScope (partner level)
        │           canAnalyze / canTrain / canPublishHighlight / canShareWithScout
        │           each with its own expiresAt and restrictions
        │
5. Per-player consent, where collected → VisionRightsScope (player level)
        │
6. Acquisition authorized, naming the signatory → VisionSourceVideoRecord
        │
7. Upload grant issued → partner uploads master → VisionVideoAsset
        │
8. Rights checks now pass. Analysis may begin.
```

Steps 2–4 are the Phase 1 admin screens. Nothing downstream works until they are complete, which is
the intended behaviour — see [03-RIGHTS-AND-GOVERNANCE.md](./03-RIGHTS-AND-GOVERNANCE.md).

---

## Backfilling the existing partners

Q1 answered "all partners" and "the agreements cover all". To get from that to working system state:

1. Collect the signed agreement for each partner as a PDF.
2. Upload each as `VisionRightsEvidence`, `kind = contract`.
3. Create a partner-level `VisionRightsScope` granting all four scopes, referencing that evidence.
4. Record each partner's Team Manager as the authorized signatory.
5. For the first three or four acquisitions, **spot-check that the partner is actually the rights
   owner** of the specific footage — particularly where it was published on a third-party channel.
   If the pattern holds, stop checking. If it does not, that is worth knowing after three matches
   rather than after three hundred.

This is a data-entry task that can run in parallel with Phase 0 engineering. It is on the critical
path for Phase 1: no agreement PDF, no acquisition.
