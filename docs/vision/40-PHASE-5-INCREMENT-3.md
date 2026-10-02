# 40 — Phase 5 Increment 3: the pitch drawn back over the grass

> A calibration editor lets a human drag keypoints when the model fails — often
> enough on wide handheld footage that the editor is a requirement, not a
> convenience.
> — [09-ML-PIPELINE](./09-ML-PIPELINE.md), § Calibration and game state

[38](./38-PHASE-5-INCREMENT-1.md) fitted the homography and [39](./39-PHASE-5-INCREMENT-2.md)
proposed the segments; a person still had no way to click. This increment is the
editor: pause on a frame, click the pitch's landmarks, watch the fitted pitch
drawn back over the picture, and file the calibration on the segment at the
playhead. The fit is the API's; the screen collects clicks and draws what it is
told.

---

## What the reviewer sees

The proxy on the left, with the same transport as the other workstation screens.
The screen asks for landmarks in the order a wide shot most often shows them —
the near corners, the halfway line, the centre spot, the box corners — so four
clicks are usually enough to see the overlay, and a person may pick any landmark
from the list instead. A click on the paused frame places the landmark there in
the proxy's own pixels; clicking a placed landmark picks it up to move; a
right-click removes it. From four landmarks on, every change re-fits through the
API's preview, saved nowhere, and the readout says `good · 0.39 m over 6
landmarks`, the worst landmark, the pixel error, and the thresholds version.

**The pitch drawn back.** The preview now returns the pitch's markings —
outline, halfway line, centre circle, both boxes and goal areas — projected
through the inverse homography into proxy pixels, each polyline broken where it
crosses the horizon or leaves the picture by a wide margin, so a low camera's
far touchline does not become a line across the sky. The screen draws them as
SVG paths over the picture, and draws each click's reprojection too: a dashed
marker where the fit thinks the click should have been, with its error in
metres. Where the yellow lines disagree with the grass is where the next click
should go.

**Filing.** *File on the segment here* files the fit on the camera segment
covering the playhead, with the pitch dimensions the reviewer set; *Load the
segment's calibration* brings a filed calibration's clicks back for correction,
which is why a filed calibration now carries its `clicked` points. Segments are
declared from two marks at the playhead with a kind, removed when uncalibrated,
and — for someone who may run jobs — proposed by queueing the cuts stage.

## The picture inside the element

A `<video>` keeps its own box and letterboxes the picture into it. A fraction of
the element is not a fraction of the picture, and on this screen that is the
difference between a landmark on the corner flag and one in the letterbox bar.
The editor measures where the picture sits — the tighter of the two scales,
centred — and both the clicks and every overlay are reckoned against that
rectangle, which is re-measured when the video learns its size and whenever the
stage resizes. The identity review screen drew its boxes against the element and
gets the same rectangle in this increment. The annotation workstation's boxes
are stored as fractions of the element too; that is a defect of the same shape
and is flagged for its own change rather than touched here.

## Verification

```
api tests              1,236 passed   (was 1,234)
web tests                158 passed   (was 149)
  calibration editor      16
typecheck               api and web clean
```

The screen was driven end to end in the browser against the local API, Postgres
and R2, on the demo proxy as a signed-in reviewer: a segment declared from two
marks; six landmarks placed at the pixels a synthetic camera would have shown
them, the readout turning `good · 0.39 m over 6 landmarks` with the seven
polylines of the pitch and six reprojected markers drawn over the frame; the
calibration filed, the segment reading `good 0.39 m` and the asset `4s
calibrated of 4s segmented`; the landmarks cleared and loaded back from the
filed calibration. Two things the browser corrected before that: the picture
rectangle was measured before the video knew its size, and the stage's resize
observer never fired, so the video element is now watched directly and its
metadata event re-measures. The scratch reviewer and segment were removed
afterwards. A third came from the mutation runner: a vertex beyond the horizon
does not fail to project, it projects to a mirrored pixel that means nothing, so
the overlay now breaks a polyline where the homogeneous scale changes sign
against a landmark known to be in view, and a low camera's far corners are
proven absent.

Fifteen mutations, each caught: the letterbox scaled by the wrong side; the
picture not centred; a click reckoned from the element; a click on the bar
accepted; a one-point path drawn; the landmark order dropped; two clicks for one
landmark; a segment's ends excluded; marks only one way round; an empty segment
allowed; a segment past the footage allowed; a proposal not named as one; the
centre circle left open; the halfway line half-drawn; the horizon not breaking a
polyline.

## What is not done

| | |
|---|---|
| **Drag to adjust** | A landmark is moved by clicking it and clicking again. Dragging is a refinement for the pod era, when a real frame's corner flag is a few pixels wide. |
| **Keyboard nudging** | Arrow keys move the playhead, not the landmark. A pixel nudge for the picked landmark is small and worth doing with real footage. |
| **The annotation workstation's picture rectangle** | Flagged for its own change; its boxes are stored as fractions of the element. |
| **Kinds on proposals** | A proposed segment stays `unknown`; the editor files its calibration but does not yet ask what kind of shot it was. |
| **The match clock** | Still not anchored to the footage. Next. |
