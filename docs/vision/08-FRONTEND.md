# 08 — Frontend

## Where it lives

Inside the **existing** web app. No new application. See
[02-DECISIONS.md, D8](./02-DECISIONS.md#d8--separate-admin-app).

```
apps/web/src/modules/admin/vision/     admin screens, mounted in the existing AdminApp
apps/web/src/modules/vision/           scout + player-facing read surfaces
apps/web/src/api/vision.ts             typed client, same pattern as admin.ts / scoreboard.ts
```

Reuse, do not rebuild: `AdminAuthContext`, `AdminRequirePermission`, `AdminLayout`,
`AdminPageHeader`, `AdminTableShell`, `AdminToast`, `AdminPlayerSearchPicker`, `MediaUrlPreview`,
`useDebouncedValue`, `usePageTitle`.

## Routes

| Route | Screen | Permission | Layout |
|---|---|---|---|
| `/admin/vision` | Operations dashboard | `vision.read` | `AdminLayout` |
| `/admin/vision/sources` | Partner source catalog | `vision.read` | `AdminLayout` |
| `/admin/vision/sources/:id` | Source detail, rights, acquisition | `vision.read` | `AdminLayout` |
| `/admin/vision/ingest` | Match ingestion wizard | `vision.assets.upload` | `AdminLayout` |
| `/admin/vision/assets/:id` | Asset processing workspace | `vision.read` | `AdminLayout` |
| `/admin/vision/review/:assetId/*` | **Analysis & review workstation** | `vision.review` | **Full viewport, outside `AdminLayout`** |
| `/admin/vision/workstation/identity/:assetId` | Identity review (the roster panel of the above, as built — [36](./36-PHASE-4-INCREMENT-5.md)) | `vision.review` | Full viewport, `VisionWorkstationApp` |
| `/admin/vision/workstation/calibration/:assetId` | Calibration editor (as built — [40](./40-PHASE-5-INCREMENT-3.md)) | `vision.review` | Full viewport, `VisionWorkstationApp` |
| `/admin/vision/annotation` | Annotation queue | `vision.annotate` | `AdminLayout` |
| `/admin/vision/datasets` | Dataset registry | `vision.read` | `AdminLayout` |
| `/admin/vision/datasets/:id` | Dataset detail, leakage, representation | `vision.read` | `AdminLayout` |
| `/admin/vision/models` | Model registry | `vision.read` | `AdminLayout` |
| `/admin/vision/benchmarks` | Quality dashboard | `vision.read` | `AdminLayout` |
| `/admin/vision/highlights` | Highlight review and publish | `vision.publish` | `AdminLayout` |
| `/scouting/vision/search` | Scout semantic search | `vision.evidence.search` | `ScoutingLayout` |
| `/players/:slugOrId` → Analysis tab | Player evidence | public, approved only | `MarketingLayout` |

The review workstation is the one exception to the layout rule, following the existing
`MatchConsoleApp` precedent in `App.tsx`: a frame-accurate video tool needs the whole viewport and
should not have a site header competing for vertical space or keyboard focus.

Scout search mounts inside the existing `/scouting` module rather than a new `/scout` tree,
because that is where DTP's scouting surfaces already live.

---

## Operations dashboard — `/admin/vision`

The screen an operator leaves open. Answers, at a glance:

- Queue depth by resource class; oldest queued job age.
- Jobs running now, with stage and elapsed time against budget.
- Failures in the last 24 h, grouped by reason, each linking to its job event log.
- GPU spend this month against budget, and **cost per analyzed match** as a trend.
- Annotation backlog and review queue depth.
- Benchmark alerts: any production model whose latest run regressed on a critical slice.
- Rights alerts: scopes expiring in 30 days, sources pending acquisition authorization.

The rights-expiry panel is not decoration. A scope silently expiring mid-season is how a
compliant pipeline quietly becomes a non-compliant one.

---

## Match ingestion wizard — `/admin/vision/ingest`

Steps, in this order, because each gates the next:

1. **Source and rights.** Pick a catalogued source or create one. The step will not advance
   without valid rights evidence and an authorized acquisition method. The failure message names
   the missing scope.
2. **Match linkage.** Competition, teams, kickoff, venue — all pulled from existing ScoreBoard
   records via the existing pickers. Creating a new competition here is not allowed; that belongs
   in the ScoreBoard admin, which already does it well.
3. **Rosters and kits.** Confirm both squads from `SbTeamSquad`. Record kit colours and
   goalkeeper kit — this feeds team assignment in Phase 4 and is far cheaper to capture now than
   to infer later.
4. **Upload.** Direct-to-R2 multipart with a visible resumable progress bar, per-part retry, and a
   "resume previous upload" entry point that finds the existing session.
5. **Source and camera notes.** Camera count, fixed or handheld, approximate height and side,
   zoom behaviour, whether the full pitch is visible, day/night, floodlight quality, weather,
   surface, crowd proximity. These become benchmark slices.
6. **Processing policy.** Which stages to run, resource class, budget cap.

### The upload component

The one piece of UI most likely to be underestimated. Requirements:

- Survives a closed tab. On return, the session is found by asset and offers resume.
- Shows bytes transferred, parts complete, and an honest estimated time — not a spinner.
- Retries a failed part automatically with backoff; surfaces persistent failure clearly.
- Re-requests expired part URLs without user action.
- Warns before navigating away mid-upload.
- Works on a phone, because a club secretary in Ikorodu will use one.

---

## Analysis & review workstation — `/admin/vision/review/:assetId`

The screen the whole program depends on. Model quality determines how much correcting happens;
this screen determines how expensive each correction is. A model that is 5% better but doubles
correction time is operationally worse — so correction time is a tracked metric, not a vibe.

```
+---------------------------------------------------------------+
| MATCH | pipeline status | model version | rights | publish     |
+--------------------------------------+------------------------+
|                                      | ROSTER / IDENTITY      |
|            VIDEO PLAYER              | track -> player        |
|     boxes + ball + selected track    | jersey candidates      |
|                                      | merge / split / unknown|
+--------------------------------------+------------------------+
| TIMELINE: events | possession | low-confidence | corrections   |
+--------------------------+------------------------------------+
| PITCH / MINIMAP          | EVENT / EVIDENCE INSPECTOR         |
| tracks + ball            | actor, type, outcome, confidence   |
| calibration quality      | source links, reviewer decision    |
+--------------------------+------------------------------------+
```

**As built so far** ([36](./36-PHASE-4-INCREMENT-5.md)): the video player with every
track's box on the frame, and the roster/identity panel — sides, candidates, split, merge,
reassign and mark-unknown as one assignment over a window, a second person's accept and
reject, and the public view. It lives at `/admin/vision/workstation/identity/:assetId`
beside the annotation workstation. The calibration editor ([40](./40-PHASE-5-INCREMENT-3.md))
sits beside it: landmarks clicked on a paused frame, the fitted pitch drawn back over the
picture, segments declared and calibrations filed. Overlays on both screens are reckoned against
the letterboxed picture inside the `<video>` element, never the element itself. The timeline,
minimap and inspector wait on events and game state.

### Non-negotiable behaviours

| Requirement | Why |
|---|---|
| Frame-deterministic seek | Annotation is worthless if the frame shown is not the frame stored. Seek uses `frameIndex` on the constant-FPS proxy, and both source-time and proxy-time are displayed. |
| A box is stored at its frame's start, in source time | The scrubber stops mid-frame; the box must not. `snapSourceTimeMs` floors the position to a frame and stores that frame's first millisecond, so the export's floor lands it on the same frame after any re-transcode. A model's box is always drawn dashed and tagged. |
| Match clock and media time shown separately | `47:12` on the match clock is not `47:12` in the file. Conflating them corrupts events. |
| Milliseconds visible | Event boundaries are sub-second. |
| `Unknown` is one keystroke | If marking unknown is harder than guessing, reviewers will guess. That is the single worst failure mode in the system. |
| Confidence never encoded by colour alone | Accessibility, and colour is unreadable on a sunlit laptop pitch-side. Use text and icon states as well. |
| Every correction is undoable | And every correction is a new row, never an in-place edit. |
| Provenance drawer on every object | Model version, dataset version, confidence, source frames, reviewer, calculation formula. One click from anything on screen. |
| Keyboard-first | See below. Mouse-driven review does not scale to 90 minutes of footage. |

### Keyboard map

| Key | Action |
|---|---|
| `Space` | Play / pause |
| `←` `→` | ±1 frame |
| `Shift + ← / →` | ±1 second |
| `,` `.` | Previous / next uncertainty (the main navigation verb) |
| `A` | Accept current object |
| `R` | Reject current object |
| `U` | **Mark unknown** |
| `1`–`9` | Assign roster slot from the identity panel |
| `M` | Merge selected tracks |
| `S` | Split track at playhead |
| `[` `]` | Set event start / end |
| `?` | Shortcut help |

`,` and `.` matter most: the reviewer's job is to walk the uncertainty queue, not to scrub a
timeline hunting for problems. The system knows where it is unsure; the UI should take the
reviewer there.

### Overlays

Toggleable and independently: detections, tracks, track labels, team colour, jersey candidate,
ball, ball trail, pitch projection, camera-segment boundaries. Toggle state persists per reviewer.

---

## Dataset registry — `/admin/vision/datasets`

Per version: member count, source matches, rights coverage, class balance, split sizes, label
schema version, frozen state, and a manifest diff against the previous version.

Two screens do real work rather than just reporting:

- **Leakage checker.** Proves no match, source checksum, or duplicate cluster crosses a split.
  A dataset cannot be frozen while this fails, and the failure names the offending members.
- **Representation dashboard.** Distribution across competition, geography, camera style,
  lighting, resolution, pitch surface, kit, partner, and source-quality rank. Age and gender bands
  appear only where policy permits. This is how a corpus quietly dominated by one Lagos
  competition in daylight gets caught before a model trained on it fails everywhere else.

---

## Model registry and benchmarks

Model registry: versions, stage, dataset and commit lineage, weights checksum, model card,
licence note, and promote / canary / rollback actions gated on `vision.models.promote`.

Quality dashboard: metrics by class **and by slice**, always side by side with the current
production model. A headline number without its slice breakdown is not shown anywhere in this UI —
that is what lets a regression on night footage hide behind an improved average.

Also here: the failure gallery — low-confidence cases, detector/tracker disagreement, identity
flips, ball-lost sequences, calibration failures. Clicking one opens it in the review workstation
at that timestamp.

---

## Player-facing surfaces

The player analysis tab on the existing profile page shows **approved evidence only**. No
unreviewed prediction, no confidence-below-threshold identity, no metric whose calibration
prerequisite failed.

Where a metric is suppressed, say so plainly — "not available: camera calibration insufficient" —
rather than hiding the row. A visible, explained gap builds trust; a silent omission looks like
the number was never computed.

Provenance is available to the viewer in plain language: which match, which minute, and that a
human reviewed it.

---

## Accessibility and performance

- All interactive controls reachable by keyboard; the review workstation is keyboard-first by design.
- Never colour alone for confidence, team, or review state.
- Respect `prefers-reduced-motion` — no auto-animating overlays.
- Canvas overlays render off the React commit path; a 25 fps overlay must not trigger 25 React renders per second.
- Timeline and parquet-backed views load windowed data, never a whole match of detections into memory.
- The review workstation targets a mid-range laptop on a Nigerian connection: proxy resolution is
  chosen for reviewability, not for fidelity, and crops are lazy-loaded.
