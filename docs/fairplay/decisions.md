# FairPlay — decisions

Decisions Fola took, with the option chosen and what it settles. Each was asked as a choice
between options, with a recommendation, on **28 October 2026**. Gate numbers refer to
[phase-plan.md](./phase-plan.md); blockers to [blockers.md](./blockers.md).

| # | Question | Decision | Settles |
|---|---|---|---|
| D1 | Private R2 bucket for evidence (≈ $0.12/month at the quoted price) | **Approved** | gate 5, B5 |
| D2 | Lost video at segment switches (MediaMTX discards late video when audio leads by > 1 s) | **Align the synthetic feed's audio and video start; keep the `segment_video_gap` alert for real encoders, which must pass equipment-audit E17; report it to MediaMTX** | Phase 3 finding |
| D3 | Build the cloud side (backlog 13–15) | **Yes, next phase**: additive migration only, behind permissions nobody holds yet; deployed only on a separate approval | B11, B13 |
| D4 | How organisers see findings and evidence | **Admin accounts holding only `fairplay.report.view`, scoped to their competition** | gate 2, B6 |
| D5 | Deleting a match that has evidence | **Keep the evidence and unlink it: `SetNull` plus a stored match snapshot** | gate 6 |
| D6 | Edge stack and local TLS | **Confirmed as built**: Python FastAPI + SQLite; HTTPS from the Edge's own CA on DTP-owned devices | gates 3, 4 |
| D7 | Where FairPlay lives in the web admin | **Its own `/admin/fairplay` area**, linked from the match center, kept out of the recorder console | gate 8 |
| D8 | Footage rights for youth pilot matches | **The competition agreement covers recording for dispute review, and parental consent is collected at player registration**; each session records the agreement and a consent reference. Needs the organisers and a legal check before the first real match | gate 7, B2 (direction set; not yet in place) |
| D9 | Raw recordings on the Edge | **14 days**, then deleted automatically; held and unsynced-evidence footage never | B7 |
| D10 | Evidence clips | Fola's rule: "If retention cost no money, end of season + 12 months; if it costs money, 90 days after finding." Applied per place: **on the Edge** (local disk, no added cost): end of season + 12 months; **in R2** (paid storage beyond the free allowance): **90 days after the finding**. Deletion is an audited action that keeps the hash and the reason | privacy decision 2 |
| D11 | Requests from a player or parent to see or erase footage | **Build an audited tool before the first real match**: export what is held about a player; withdraw a clip, removing the file and keeping hash, reason and requester | B15 |
| D12 | Edge machine security | **Full-disk encryption (BitLocker or LUKS) and a named DTP custodian**, on matchday and between matches | B14 |
| D13 | The audit log | **Kept, minimised**: for as long as any evidence it describes is kept, plus 12 months; entries hold ids, hashes and staff names, never player names or note text | privacy decision 2 |

**Still open:** gate 1 (single- or multi-angle), which needs the equipment audit answered
by the matchday crew; B8 (sheet event ids on approval); B9/B10 (licence rows); B12 (HTTPS
on a real reviewer device). D8 sets the direction for rights but needs the organisers and
a legal check before any real match.
