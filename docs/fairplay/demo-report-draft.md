# DRAFT: FairPlay demonstration report for organisers

> **DRAFT, for Fola to review before anyone outside DTP sees it. Made entirely from synthetic test
> feeds. No real match, player or official appears. Every incident, decision and finding below is made up.**

This is what the report looks like, taken from the demo on 1 November 2026
([walk-through](./demo-walkthrough.md)). An organiser with a report account would see it on the FairPlay
page, or print it.

## What FairPlay is

FairPlay records a match's cameras at the venue, separately from the livestream. After the match, DTP's
staff can review a marked moment and record what the footage shows.

**Shadow review only. These findings are not decisions of the match officials, do not change the match
record, and are not a FIFA-authorised VAR or FVS review.** Nothing reaches a referee during a match. Nothing
is published. Clips go only to people the competition's agreement names.

## Demonstration: Demo Lions v Demo Eagles

| | |
|---|---|
| Competition | FairPlay demo (synthetic) |
| Mode | Shadow review, multi angle |
| Footage | synthetic test patterns |
| Incidents | 4, with a finding on each |
| Clips released | 6, each with its SHA-256 |

### Incident 1: foul, 12'

- **On-field decision, as recorded:** DEMO: pretend free kick awarded
- **Finding:** The footage supports the on-field decision.
- **What the footage shows:** DEMO, synthetic feed. The test pattern is visible on both cameras throughout the window.

| Evidence | Length | Coverage | SHA-256 |
|---|---|---|---|
| ground, synthetic | 30 s | full | `1cbb9a3211cf2771…` |
| drone, synthetic | 30 s | full | `8d3553ba5ae2ef7b…` |

### Incident 2: goal, 27'

- **On-field decision, as recorded:** DEMO: pretend goal not given
- **Finding:** The footage supports a different outcome from the on-field decision.
- **What the footage shows:** DEMO, synthetic feed. Shown only to demonstrate this result. A finding changes no decision or score.

| Evidence | Length | Coverage | SHA-256 |
|---|---|---|---|
| ground, synthetic | 30 s | full | `545a5216b7608ce4…` |
| drone, synthetic | 30 s | full | `89540c6fb93f2a76…` |

### Incident 3: penalty, 38'

- **On-field decision, as recorded:** DEMO: pretend penalty not given
- **Finding:** The footage is inconclusive.
- **What the footage shows:** DEMO, synthetic feed. The drone has no footage of this moment and the gap is shown. The ground camera alone does not settle it.

| Evidence | Length | Coverage | SHA-256 |
|---|---|---|---|
| ground, synthetic | 30 s | full | `68a47f98df9a17fd…` |

### Incident 4: other, flagged during the demonstration

- **Finding:** The footage is inconclusive.
- **What the footage shows:** DEMO, synthetic feed. The test pattern alone does not show what happened, so this stays inconclusive.

| Evidence | Length | Coverage | SHA-256 |
|---|---|---|---|
| ground, synthetic | 30 s | full | `f1cfced40985659c…` |

## What an organiser would be asked for

Before any real match, in a written agreement ([rights checklist](./rights-checklist.md)):

- the basis for recording the competition's matches for dispute review;
- consent arrangements, if players may be minors. **No match with minors will be recorded until this is settled with legal advice;**
- who may see findings and clips;
- how long recordings, clips and records are kept;
- who answers a request from a player or a parent;
- permission from whoever owns the footage, if DTP's own cameras do not supply it.

## What this does not show

- **Real cameras, a real venue or a real match.** None has been tested. The pilot's minimum is three full shadow-review matches.
- **Timings a venue would see.** They are not quoted here for that reason.
- **Legal advice.** The questions above need the organiser's and DTP's own advisers.
- **A finished product.** This is a pilot candidate, and the checks that remain are on the [go/no-go checklist](./go-no-go.md).

## For Fola, before this goes anywhere (remove this section)

1. **Do you want Incident 2 in a stakeholder's copy?** It shows a finding against an on-field decision. It is plainly labelled as made up, and it shows the product's real range, but a reader could take it the wrong way. Removing it loses nothing technical.
2. This draft leaves out the reviewer's name, the operator's notes and the retention dates, which Phase 4 keeps from organisers or which are not settled (R25). Its text is copied by hand from the admin report page; it is not an export.
3. **Nothing has been sent to anyone.**
