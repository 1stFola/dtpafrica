# 24 — Phase 2 Increment 3: the review workstation

The phase plan puts a **DTP-native review workstation first**, with CVAT explicitly
not a Phase 2 blocker. This increment builds it for the loop that exists today.

**Scope, stated plainly.** The workstation in [08-FRONTEND](./08-FRONTEND.md) assumes
detections, tracks, identity and events. None of those exist — there is no model yet.
So this is the half that does not need one: claim a window, watch exactly the right
frames, record what was seen, and accept or send back somebody else's work. Identity,
merge/split and the event inspector arrive when there are detections to merge.

Dense box and track *drawing* is still CVAT's job. This screen is the review surface.

---

## The arithmetic came first, and it is tested

Three clocks, never interchangeable:

| | |
|---|---|
| **source time** | Milliseconds into the original match file. What the database stores, and what every label means. |
| **proxy time** | Milliseconds into the transcoded clip the annotator actually watches. Differs by the proxy's offset. |
| **match clock** | What a viewer calls it. `47:12` on the match clock is not `47:12` in the file. |

A proxy that starts five seconds into the source is the **normal** case. An ignored
offset puts every label in a task five seconds out — and the labels stay consistent
with each other, so review does not catch it and nothing downstream complains.

So the arithmetic lives in `annotation-time.ts`: pure, outside the React tree, and
tested without a DOM. Three decisions in it are load-bearing:

- **`floor`, not `round`,** for the frame index. A time is inside a frame until the
  next one begins; rounding pushes roughly half of all labels onto the following frame.
- **Seek to a frame boundary**, not an arbitrary millisecond, or the browser picks
  which neighbouring frame to show and the frame stored is not the frame seen.
- **Refuse to guess a frame rate.** With no fps the module returns `null` and the UI
  says *not frame-accurate*. A guessed 25 produces labels that look precise and are
  wrong, which is worse than labels that admit to millisecond accuracy.

All three were **mutation-tested** — `round` for `floor`, offset forced to zero, and a
guessed 25fps — and each broke tests.

## What the screen refuses to hide

| | Why |
|---|---|
| Both clocks, permanently side by side | The failure guarded against is a reviewer reading one and believing the other |
| Milliseconds always shown | Event boundaries are sub-second, so hiding them hides what is being judged |
| `U` marks uncertain, one keystroke | If marking uncertain is harder than guessing, reviewers guess — the single worst failure mode in the system |
| A pre-labelled task says so, loudly | An unmarked model suggestion is an anchoring-bias machine: the human agrees and the model's error becomes ground truth |
| Correction time measured from when footage was ready | Not from row creation, which could be days earlier. A model 5% better that doubles correction time is operationally worse, and only the minutes reveal which happened |
| Labels submitted in **source** time | The proxy is a viewing convenience; a label in proxy time is wrong the moment the clip is re-cut |

The queue page puts the **hard-case share** and **average correction time** on screen
rather than in a report. Uniform random sampling produces a corpus of easy frames, and
a number nobody looks at drifts. Below 50% the page says so in words.

## Three problems found while building it

### 1. The workstation route had no authentication at all

It mounts outside `AdminLayout` — a frame-accurate video tool needs the whole viewport,
the same reason `MatchConsoleApp` does. But a top-level route is also outside
`AdminAuthProvider`, so the first version had **no session, no guard and no permission
check**: a screen that presents youth footage, reachable by anyone with the URL.

`VisionWorkstationApp` now carries its own auth stack, exactly as `MatchConsoleApp`
does, and requires `vision.annotate` rather than `vision.read` — this screen claims
work and submits labels.

Verified by loading both routes unauthenticated and watching each redirect to the login
page.

### 2. The route pattern would have shadowed the queue

`admin/vision/annotation/*` also matches `/admin/vision/annotation`, and a top-level
route with more static segments outranks `AdminApp`'s `admin/*`. The queue page would
have become unreachable and the workstation would have rendered blank at that URL. The
workstation is on `/admin/vision/workstation/:taskId` instead.

### 3. Adding a test runner broke two unrelated files

The web app had **no tests at all**, and this increment introduces logic that must not
ship untested. Adding vitest pulled `@types/node` into the app's type scope, so bare
`setTimeout` started resolving to Node's `Timeout` while `window.setTimeout` still
returned `number` — and `MatchCenterPage` stopped compiling.

Fixed at the cause: that ref holds a handle from `window.setTimeout`, so it is typed
`number`. Correct browser code regardless of which ambient types happen to be present.
`apps/web/tsconfig.json` also now restricts `types`, so browser code cannot quietly use
a Node API and typecheck anyway.

---

## Routes

| | | |
|---|---|---|
| `/admin/vision/annotation` | Queue, mix report, active-learning list | `vision.annotate`, inside `AdminLayout` |
| `/admin/vision/workstation/:taskId` | The workstation | `vision.annotate`, full viewport, own auth stack |

Keyboard: `Space` play/pause · `←` `→` one frame · `Shift + ← →` one second ·
`U` mark uncertain.

## Verification

```
web tests     29 passed   (the web app's first)
api tests    472 passed
typecheck    clean, 7 projects
web build    clean
routes       both redirect to login when unauthenticated
CSS          every class used by the new pages is styled
```

CI now runs `pnpm --filter @dtp/web test`.

> **Not visually verified.** Signing in needs the operator's own credentials, which
> are not mine to use, so the rendered screens have not been looked at — only that the
> routes resolve, the guard holds, the bundle builds and the logic is tested. Layout
> and legibility need a human pass.

## What is not done

| | |
|---|---|
| **Drawing** | No box or polygon surface. CVAT's job, per the phase plan. |
| **Identity, events, merge/split** | Needs detections. Phase 4. |
| **The timeline and minimap** | Both plot detections; nothing to plot yet. |
| **Inter-annotator agreement** | The data exists; the metric and its screen do not. |
| **Provenance drawer** | Partial: schema version, annotator, checksum and pre-label flag are shown. Model and dataset provenance arrive with models. |
