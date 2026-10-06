## Backlog from the docs (15–49), Phases 1–6

### A1. Still open — blocked on something external
- [S0/27] Cost per match and unmeasured U1–U9 (R2→pod transfer, cold start, transcode time, inference minutes, GPU/VRAM, ball visibility %, compression damage, upload on a Nigerian link). Needs one pod run on a rights-cleared match. 11:70, 27:276–286.
- [P1/21] Neither hosted compute provider has launched for real; no credentials. 21:145.
- [P1/46] First real `vision:upload` + pipeline run on live not yet done. 46:92.
- [P3/28,45,46] Detect on a GPU; registering baseline `detector/torchvision-fasterrcnn-coco` on staging. Needs GPU pod + credentials. 28:175, 45:76, 46:93.
- [P3/28] Goalkeeper/referee classes; RF-DETR on DTP footage — licence review. 11:139, 28:172.
- [P3/30,31,34,37] Thresholds have no numbers (`2026.10.0-unset`); every promotion carries the warning. Set by first baseline on real footage. 30:130, 31:98, 34:139, 37:109.
- [P3/31] Promotion lineage checks never run on a DTP-trained model. 31:100.
- [P4/33] ByteTrack vs BoT-SORT comparison — licences. 11:146, 33:117.
- [P4/34,35,37] Jersey candidates, player accuracy, jersey top-k — no OCR/digit model in OSS register. 11:147, 34:136, 35:120, 37:108.
- [P5/38] Automatic calibration (`method: model`) — no model in register. 11:153, 38:126.
- [P5/41] Automatic clock anchoring — no licensed model. 41:111.
- [P3/P5/43] Ball: tiled ball path; ball on the minimap — no ball detector. 11:140, 43:115.
- [P6/44,49] Ball smoothing **implemented in [80](../80-PHASE-6-INCREMENT-9.md)**; original image-proximity possession candidates/Unknown artifacts **implemented in [81](../81-PHASE-6-INCREMENT-10.md)**; `VisionPossessionSegment` persistence and second-person review **implemented in [82](../82-PHASE-6-INCREMENT-11.md)**; immutable boundary/actor corrections and independent revision decisions **implemented in [83](../83-PHASE-6-INCREMENT-12.md)**; calibrated ground-plane distance/motion vetoes **implemented in [84](../84-PHASE-6-INCREMENT-13.md)**. Still open: named actor attribution, airborne-ball/control reasoning and real detector/possession evaluation. 11:160, 44:118, 49:140.
- [P6/44] Automatic weight-free carry artifact producer and original-run scoring **implemented in [85](../85-PHASE-6-INCREMENT-14.md)**. Import into `method: model` event reviewer rows, additional event types and real-footage accuracy remain open. 44:117.
- [P6/48,49] Confidence-ranked walk and queue (`,` `.` lowest first) **implemented in [76](../76-PHASE-6-INCREMENT-5.md)**. Stored scores do not establish model accuracy; manual scores tie and use age.
- [P5/P6 gates] Phase 5 coverage and Phase 6 per-event precision / actor attribution on real footage with gold events. Capture, reconciliation, freeze and candidate scoring are implemented in [77](../77-PHASE-6-INCREMENT-6.md); independent pilot labels and representative model evaluation remain outstanding. 42:144, 48:101, 49:141.
- [P4/34, P5/39] FFmpeg never run on a real proxy for identify's frame decoder or the cuts filter graph; cuts threshold 0.4 unvalidated. 34:138, 39:86, 39:88.
- [P3/31] Canary (both versions on selected matches). 31:97; 10 § canary.
- [P1/46] More than one worker; a worker that survives a deploy (a deploy re-queues a job mid-run). 46:94–95.
- NOTE: doc 43/42/45 list the R2 CORS rule as unset. It is now SET (verified 2 Oct 2026 for http://54.225.155.75 and http://localhost:5173); the docs are stale on this point. **Resolved in [62](../62-QA-FIX-12-DOCS.md):** checked again on 4 Oct 2026 and the docs say so.

### A2. Still open — buildable now
- [P1/15] Grow root EBS 20 → 100 GiB "before Phase 3"; `infra/terraform/variables.tf` still `default = 20`. 15:254, 13:156.
- [P1/19] Leader lock on the dispatcher (only past one API replica; `job-dispatcher.service.ts:27` comment). 19:143.
- [P1/20,45,47] Partner-facing resumable browser upload page; CLI is the only path. 20:127, 45:77, 47:76; component specified at 08:86–95.
- [P1/21] Automatic provider failover (deliberately manual). 21:146.
- [P2/22] Player-level revocation not resolved to assets though the identity graph exists since doc 35 (`sources.service.ts:301–307`, `datasets.service.ts:993` still warn "cannot be resolved automatically"). 22:189.
- [P2/22] Nothing machine-enforces the ban on tuning against `gold` at training time. 22:190.
- [P2/22] No label taxonomy authored (a football decision). 22:191.
- [P2/23,29] Pre-labelling from a detect artifact (`preLabelModelVersionId`). 23:174, 29:144.
- [P2/23] Dev server does not run DTO validation (workflow decision). 23:112, 23:176.
- [P2/25,26,30,37] Slices: composition (venue, camera operator, day/night, kit similarity), quality (night, crowded box, motion blur), situation (duplicate jersey, back turned, GK kit, after a substitution). 25:121, 26:165, 30:132, 37:110.
- [P2/25] Re-baselining every model on a new benchmark version not enforced. 25:122.
- [P2/25,26] CVAT import/export adapter (Q10 deferred). 11:127, 25:123, 26:167.
- [P2/26] Large exports built in memory; sharded JSONL layout reserved but unused. 26:166.
- [P3/29] No scrubber frame strip showing labelled frames; disagreement not measured by box overlap. 29:147–148.
- [P3/30] `params.frames` detect sampling only labelled frames. 30:131.
- [P4/33] HOTA; tracker covered-frame accounting (`framesScored`). 33:116, 33:119.
- [P4/36] Per-track artifacts — positions route refuses > 32 MB (`identity.service.ts:497`); track crop thumbnail strip. 36:111–112.
- [P5/39,40] Segment kinds: proposals stay `unknown`; drag/nudge a landmark. 39:87, 40:97–100. (**Resolved:** the editor asks for the contract's kinds since [58](../58-QA-FIX-8-CONTRACT-PARITY.md), and the annotation workstation uses the picture rect since [59](../59-QA-FIX-9-WORKSTATION.md).)
- [P5/41–43] Kit changes in the substitution window; which goal each side attacks per half; chunks/segments on the match clock; speed/distance/trails/smoothing (metrics phase). 41:109, 41:112, 42:141–143, 43:116–117.
- [P6/47,48,49] Drag an event boundary **implemented in [72](../72-PHASE-6-INCREMENT-4.md)**. Still open: recorder console offers no second; leakage/representation/benchmark/promotion reports shown as raw JSON `<pre>` (`AdminVisionDatasetsPage.tsx:178`, `AdminVisionModelsPage.tsx:281`). 48:98, 49:139, 47:75.

### B. Promised in plan/contract/frontend doc but never built
- `GET /vision/review/:assetId/timeline` — no route. 07:109.
- `GET /vision/assets/:id` — only the list exists (`assets.controller.ts:19`). 07:76.
- `PATCH /vision/assets/:id/match-link` — deferred 20:129; doc 46 replaced it with inheritance from the source. 07:77, 07:88, 11:113.
- `GET /vision/assets/:id/playback` (rights canAnalyze) — `GET /vision/review/:assetId/media` serves the proxy instead. 07:78.
- `GET /vision/assets/:id/duplicates`. 07:79.
- `PATCH /vision/sources/:id`. 07:20.
- **Resolved in [62](../62-QA-FIX-12-DOCS.md):** 07's tables are corrected, the routes below that were never built say so in their rows, and 07 ends with a generated table of every route. As found: Contract table drift — 07 still lists old paths: `/vision/sources/:id/rights-evidence|rights-scopes|revoke` (07:23–25) are really `/vision/partners/:id/evidence`, `/vision/rights/scopes`, `/vision/rights/scopes/:id/revoke`; `POST /vision/assets/:id/segments|jobs` (07:81–82) are `/vision/review/:assetId/camera-segments` and `POST /vision/jobs`; datasets `/split`, `/leakage-report` (07:182–183) are `/splits`, `/leakage`.
- Match ingestion wizard `/admin/vision/ingest`. 08:25, 08:66–84, 11:113.
- HLS preview. 11:111.
- Asset processing workspace `/admin/vision/assets/:id`. 08:26.
- Operations dashboard panels: 24 h failures by reason; running jobs' elapsed vs budget; GPU spend vs budget; cost-per-match trend; benchmark regression alerts; rights alerts (scopes expiring in 30 days, sources pending authorisation). 08:53–59, 06:239.
- Quality dashboard `/admin/vision/benchmarks` and failure gallery. 08:35, 08:215–221.
- Representation and source-quality dashboards (API exists 22:125; UI shows raw JSON). 11:131, 08:203.
- Workstation disagreement queue. 11:126.
- Provenance drawer on every object (partial, 24:155; data only 44:33). 08:156.
- Overlay toggles persisted per reviewer. 08:189–190.
- **Resolved in [59](../59-QA-FIX-9-WORKSTATION.md)**, all of it. As found: Keyboard map on the identity workstation: no `?` help, no `A`/`R`, no `U` (exists only on the annotation task page), no `M` merge, no `S` split, no `1`–`9` roster digits (docs 48:100 and 08:184 claim the digits exist — doc error). `AdminVisionIdentityPage.tsx:328–366`; 08:163–174.
- Single workstation `/admin/vision/review/:assetId/*` — built as separate identity and calibration screens. 08:27.

Resolved later (~37): reaper/dispatcher, worker container, stage findings on the asset, resumable upload, catalog/rights screens, partner upload routes, second compute provider, media.py tests, camera segments, annotation UI, gold disagreement, FiftyOne export (boxes and tracks), box drawing, benchmark ledger, promotion/rollback, optimal assignment, split/merge review, sides, identity metrics, match clock, calibration editor, cuts, valid-frame coverage, minimap, timeline/inspector, events page, secondInMinute, review queue, model/benchmark screens, worker on the box.
