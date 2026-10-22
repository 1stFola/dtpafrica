import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  fetchVisionAnnotationPayload,
  fetchVisionTask,
  fetchVisionTaskPreLabels,
  reviewVisionAnnotation,
  submitVisionAnnotation,
  type RejectionReason,
  type ReviewDecisionKind,
  type VisionAnnotationTask,
  type VisionTaskMedia,
} from "../../../api/vision";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { useAdminAuth } from "../AdminAuthContext";
import { sentBackReview } from "./annotation-access";
import { usePictureRect } from "./use-picture-rect";
import {
  clampToWindow,
  describePosition,
  frameIndexAt,
  frameStartMs,
  proxyOffsetMs,
  stepFrames,
  windowDurationMs,
} from "./annotation-time";
import {
  DETECTION_CLASSES,
  boxesOnFrame,
  countByClass,
  countTracks,
  framesWithBoxes,
  inheritTrackId,
  newBoxId,
  nextTrackId,
  parseStoredBoxes,
  pointOnPicture,
  rectFromDrag,
  snapSourceTimeMs,
  toPayloadBoxes,
  type DetectionClass,
  type DraftBox,
  type Rect,
} from "./annotation-boxes";

/**
 * The annotation workstation.
 *
 * Outside `AdminLayout` by design, following the `MatchConsoleApp` precedent: a
 * frame-accurate video tool needs the whole viewport, and a site header competing for
 * vertical space and keyboard focus makes it worse at its job.
 *
 * What this screen is responsible for: claim a window, watch exactly the right frames,
 * draw the boxes a detector will be scored against, record what was seen, and accept
 * or send back somebody else's work. Dense tracks across hundreds of frames still
 * belong in a dedicated tool (CVAT, per the phase plan); per-frame boxes on sampled
 * windows are drawn here, because Phase 3 cannot score a detector against a window.
 * Identity, events and merge/split arrive when there are detections to merge.
 *
 * Two behaviours are load-bearing:
 *
 *   - **Both clocks, always.** `47:12` on the match clock is not `47:12` in the file.
 *     The screen shows source time and proxy time side by side and never implies they
 *     are the same number.
 *   - **Keyboard-first.** Mouse-driven review does not scale to 90 minutes of footage,
 *     and if marking something uncertain is harder than guessing, reviewers guess —
 *     which is the single worst failure mode in the system.
 */

const CLASS_KEYS: Record<string, DetectionClass> = { "1": "player", "2": "goalkeeper", "3": "referee", "4": "ball" };

const REJECTION_LABELS: Record<RejectionReason, string> = {
  wrong_box: "Box is wrong",
  wrong_identity: "Wrong player",
  camera_cut: "Camera cut mid-window",
  ball_invisible: "Ball not visible",
  event_ambiguous: "Event genuinely ambiguous",
  roster_error: "Roster is wrong",
  rights_issue: "Rights problem",
};

export function AdminVisionTaskPage() {
  const { taskId = "" } = useParams();
  usePageTitle("Annotation workstation");
  const { hasPermission } = useAdminAuth();
  /* The route lets in labellers and reviewers; each sees only the controls the API will accept from them. */
  const canAnnotate = hasPermission("vision.annotate");
  const canReview = hasPermission("vision.review");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [task, setTask] = useState<VisionAnnotationTask | null>(null);
  const [media, setMedia] = useState<VisionTaskMedia | null>(null);
  const [proxyMs, setProxyMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState("");
  /** The reviewer's note to the labeller: its own box, so it never ends up in the labels' "what made this hard". */
  const [reviewNote, setReviewNote] = useState("");
  const [uncertain, setUncertain] = useState(false);

  /** The boxes, as they will be submitted, keyed for the screen. */
  const [boxes, setBoxes] = useState<DraftBox[]>([]);
  const [activeClass, setActiveClass] = useState<DetectionClass>("player");
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
  /** The rectangle being dragged out right now, in normalised coordinates. */
  const [draft, setDraft] = useState<Rect | null>(null);
  /** The track the last selected box belonged to, so L can link the next one to it. */
  const [lastTrackId, setLastTrackId] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  /** The clip's own pixel size, from its metadata: what the picture's aspect ratio is. */
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  /**
   * When this reviewer actually started.
   *
   * Correction time is a tracked metric rather than a vibe, and the clock starts when
   * the footage is first ready to watch — not when the row was created, which could
   * have been days ago.
   */
  const startedAt = useRef<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await fetchVisionTask(taskId);
      setTask(result.task);
      setMedia(result.media);
      setProxyMs(result.media.windowStartMs);
      startedAt.current = Date.now();

      /* A correction starts from the last attempt, pre-labels included -- so the
         reviewer sees the model's boxes rather than redrawing them, and sees which
         ones the model drew. */
      const latest = result.task.versions?.[0];
      if (latest) {
        try {
          const previous = await fetchVisionAnnotationPayload(latest.id);
          setBoxes(parseStoredBoxes(previous.payload));
        } catch {
          // The previous attempt's labels are missing or tampered with. The screen
          // still works; the export is what refuses such a version.
          setBoxes([]);
        }
      } else if (result.task.preLabelled) {
        /* The first attempt on a pre-labelled task starts from the detector's boxes, each
           marked as a model's, so a person corrects rather than draws (docs/vision/99). */
        try {
          const pre = await fetchVisionTaskPreLabels(taskId);
          setBoxes(parseStoredBoxes({ boxes: pre.boxes }));
        } catch {
          setBoxes([]);
        }
      } else {
        setBoxes([]);
      }
      setSelectedBoxId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  const source = useMemo(
    () => (task ? { startMs: task.startMs, endMs: task.endMs } : { startMs: 0, endMs: 0 }),
    [task]
  );
  const position = useMemo(
    () => (media ? describePosition(proxyMs, source, media) : null),
    [media, proxyMs, source]
  );
  const offsetMs = useMemo(() => (media ? proxyOffsetMs(source, media) : 0), [media, source]);
  const boxesHere = useMemo(
    () => (media ? boxesOnFrame(boxes, proxyMs, media.fps, offsetMs) : []),
    [boxes, media, offsetMs, proxyMs]
  );
  const boxedFrames = useMemo(
    () => (media ? framesWithBoxes(boxes, media.fps, offsetMs) : []),
    [boxes, media, offsetMs]
  );
  const classCounts = useMemo(() => countByClass(boxes), [boxes]);
  const trackCount = useMemo(() => countTracks(boxes), [boxes]);

  const selectBox = useCallback(
    (id: string) => {
      setSelectedBoxId((current) => {
        const previous = current ? boxes.find((b) => b.id === current) : undefined;
        if (previous?.trackId) setLastTrackId(previous.trackId);
        return id;
      });
    },
    [boxes]
  );

  const removeSelectedBox = useCallback(() => {
    if (!selectedBoxId) return;
    setBoxes((current) => current.filter((b) => b.id !== selectedBoxId));
    setSelectedBoxId(null);
  }, [selectedBoxId]);

  /* Where the picture sits inside the stage. On a wide window the video is letterboxed, and
     a box is a fraction of the picture, not of the element (docs/vision/50 C6). */
  const picture = usePictureRect(stageRef, natural, Boolean(media));

  /** Pointer position on the picture, in the picture's own pixels, with the picture's size. */
  const stagePoint = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const el = stageRef.current;
      if (!el || picture.width <= 0 || picture.height <= 0) return null;
      const rect = el.getBoundingClientRect();
      return pointOnPicture({ x: event.clientX - rect.left, y: event.clientY - rect.top }, picture);
    },
    [picture]
  );

  const onStagePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // Drawing while the clip plays would put the box on whichever frame the
      // scrubber reached by the time the pointer came up.
      if (playing || event.button !== 0) return;
      const point = stagePoint(event);
      if (!point) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      dragStart.current = { x: point.x, y: point.y };
      setSelectedBoxId(null);
      setDraft(null);
    },
    [playing, stagePoint]
  );

  const onStagePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragStart.current) return;
      const point = stagePoint(event);
      if (!point) return;
      setDraft(rectFromDrag(dragStart.current, point, point));
    },
    [stagePoint]
  );

  const onStagePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const start = dragStart.current;
      dragStart.current = null;
      setDraft(null);
      if (!start || !media) return;
      const point = stagePoint(event);
      if (!point) return;
      const rect = rectFromDrag(start, point, point);
      if (!rect) return;
      setBoxes((current) => {
        /* Link to the previous frame's box if one of the same class sits where
           this one is; otherwise this is a new track. Shown on the tag, and N
           undoes it, so a wrong link is a glance away rather than a silent merge. */
        const previous = frameStartMs(Math.max(0, (frameIndexAt(proxyMs, media.fps) ?? 1) - 1), media.fps);
        const onPreviousFrame = previous === null ? [] : boxesOnFrame(current, previous, media.fps, offsetMs);
        const trackId = inheritTrackId(rect, activeClass, onPreviousFrame) ?? nextTrackId(current);
        return [
          ...current,
          {
            id: newBoxId(),
            // The start of the frame on screen, in source time: the frame the
            // reviewer is looking at, and the frame the export will put it on.
            sourceTimeMs: snapSourceTimeMs(proxyMs, media.fps, offsetMs),
            class: activeClass,
            trackId,
            ...rect,
          },
        ];
      });
      // Deliberately NOT selected: a reviewer who draws and then presses 4 to arm
      // the next box would otherwise silently re-class the one they just drew.
      // Selecting is a click on the box, and nothing else.
      setSelectedBoxId(null);
    },
    [activeClass, media, offsetMs, proxyMs, stagePoint]
  );

  /** Seeks the element to an exact frame start, so the frame shown is the frame stored. */
  const seekTo = useCallback(
    (nextProxyMs: number) => {
      if (!media) return;
      const clamped = clampToWindow(nextProxyMs, media);
      setProxyMs(clamped);
      const el = videoRef.current;
      if (el) el.currentTime = clamped / 1000;
    },
    [media]
  );

  const step = useCallback(
    (frames: number) => {
      if (!media) return;
      seekTo(stepFrames(proxyMs, frames, media.fps, media));
    },
    [media, proxyMs, seekTo]
  );

  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play();
      setPlaying(true);
    } else {
      el.pause();
      setPlaying(false);
    }
  }, []);

  // Keyboard map, per docs/vision/08-FRONTEND.md. Bound to the document rather than a
  // focused element so review never stalls because focus drifted into a text field.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      switch (event.key) {
        case " ":
          event.preventDefault();
          togglePlay();
          return;
        case "ArrowLeft":
          event.preventDefault();
          step(event.shiftKey ? -Math.round(media?.fps ?? 10) : -1);
          return;
        case "ArrowRight":
          event.preventDefault();
          step(event.shiftKey ? Math.round(media?.fps ?? 10) : 1);
          return;
        case "u":
        case "U":
          // One keystroke, deliberately. If marking something uncertain is harder
          // than guessing, reviewers guess.
          event.preventDefault();
          if (selectedBoxId) {
            setBoxes((current) =>
              current.map((b) => (b.id === selectedBoxId ? { ...b, uncertain: !b.uncertain } : b))
            );
          } else {
            setUncertain((current) => !current);
          }
          return;
        case "Delete":
        case "Backspace":
          if (!selectedBoxId) return;
          event.preventDefault();
          removeSelectedBox();
          return;
        case "Escape":
          setSelectedBoxId(null);
          setDraft(null);
          dragStart.current = null;
          return;
        case "n":
        case "N":
          // A new track for the selected box: the link the drag inherited was wrong.
          if (!selectedBoxId) return;
          event.preventDefault();
          setBoxes((current) => {
            const fresh = nextTrackId(current);
            return current.map((b) => (b.id === selectedBoxId ? { ...b, trackId: fresh } : b));
          });
          return;
        case "l":
        case "L":
          // Link the selected box to the track of the box selected before it.
          if (!selectedBoxId || !lastTrackId) return;
          event.preventDefault();
          setBoxes((current) => current.map((b) => (b.id === selectedBoxId ? { ...b, trackId: lastTrackId } : b)));
          return;
        default:
          if (CLASS_KEYS[event.key]) {
            event.preventDefault();
            const next = CLASS_KEYS[event.key]!;
            setActiveClass(next);
            // With a box selected, the keys re-class it; otherwise they arm the next drag.
            if (selectedBoxId) {
              setBoxes((current) =>
                current.map((b) => (b.id === selectedBoxId ? { ...b, class: next } : b))
              );
            }
          }
          return;
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [lastTrackId, media, removeSelectedBox, selectedBoxId, step, togglePlay]);

  /** Keeps the readout in step with playback without re-rendering per frame. */
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !media) return;
    let raf = 0;
    let last = -1;
    const tick = () => {
      const ms = el.currentTime * 1000;
      // Only re-render on a ~40ms change: a 25fps overlay must not cause 25 React
      // commits a second on a mid-range laptop.
      if (Math.abs(ms - last) >= 40) {
        last = ms;
        setProxyMs(ms);
        if (ms >= media.windowEndMs) {
          el.pause();
          setPlaying(false);
        }
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [media]);

  const latestVersion = task?.versions?.[0] ?? null;
  const sentBack = sentBackReview(task);

  async function submit() {
    if (!task || !media) return;
    setBusy(true);
    setError(null);
    try {
      const minutes =
        startedAt.current === null
          ? undefined
          : Math.max(0, Math.round(((Date.now() - startedAt.current) / 60_000) * 10) / 10);

      await submitVisionAnnotation(task.id, {
        payload: {
          // Deliberately recorded in SOURCE time. The proxy is a viewing convenience;
          // a label stored in proxy time is wrong the moment the clip is re-cut.
          windowSourceStartMs: task.startMs,
          windowSourceEndMs: task.endMs,
          reviewedAtSourceMs: position?.sourceMs ?? task.startMs,
          labelSchemaVersion: task.labelSchemaVersion?.version ?? null,
          uncertain,
          notes: notes.trim() || null,
          // Every box, in source time and normalised to the frame. The API refuses a
          // box outside the window or crediting a model that never pre-labelled here.
          boxes: toPayloadBoxes(boxes),
        },
        // No annotatorId: the API takes the signed-in person (docs/vision/54).
        effortMinutes: minutes,
      });
      setNotice("Submitted. The previous attempt is kept, not replaced.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function review(decision: ReviewDecisionKind, rejectionReason?: RejectionReason) {
    if (!latestVersion) return;
    setBusy(true);
    setError(null);
    try {
      await reviewVisionAnnotation(latestVersion.id, {
        decision,
        rejectionReason,
        notes: reviewNote.trim() || undefined,
      });
      setReviewNote("");
      setNotice(
        decision === "rejected"
          ? "Sent back, and the window has been re-queued for another look."
          : "Recorded."
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  if (error && !task) {
    return (
      <main className="vision-workstation">
        <div className="vision-panel vision-panel--error" role="alert">
          {error}
        </div>
        <Link to="/admin/vision/annotation">Back to the queue</Link>
      </main>
    );
  }

  if (!task || !media || !position) {
    return (
      <main className="vision-workstation">
        <p className="vision-footnote">Loading the window…</p>
      </main>
    );
  }

  return (
    <main className="vision-workstation">
      <header className="vision-workstation__bar">
        <Link to="/admin/vision/annotation">← Queue</Link>
        <span className="vision-pill">{task.state.replace(/_/g, " ")}</span>
        <span>
          Schema <strong>{task.labelSchemaVersion?.version ?? "unknown"}</strong>
        </span>
        <span>
          Window <strong>{Math.round(windowDurationMs(source) / 1000)}s</strong>
        </span>
        {task.preLabelled && (
          // Marked loudly: an unmarked model suggestion is an anchoring-bias machine,
          // because the reviewer agrees with it and its error becomes ground truth.
          <span className="vision-pill vision-pill--warn">
            Pre-labelled by a model — check, do not assume
          </span>
        )}
      </header>

      {error && (
        <div className="vision-panel vision-panel--error" role="alert">
          {error}
        </div>
      )}
      {notice && <div className="vision-panel">{notice}</div>}
      {sentBack && (
        <div className="vision-panel" role="status">
          <strong>Sent back: {sentBack.rejectionReason ? REJECTION_LABELS[sentBack.rejectionReason] ?? sentBack.rejectionReason : "no reason given"}.</strong>{" "}
          {sentBack.notes ? <>Reviewer&apos;s note: &ldquo;{sentBack.notes}&rdquo;.</> : "The reviewer left no note."} Fix it, then submit again.
        </div>
      )}

      <div className="vision-workstation__body">
        <section className="vision-workstation__video">
          {/* The stage: the video, and over it the boxes on this frame. Drawing is a
              drag on the stage; the boxes are plain positioned elements in
              percentages, so they follow the picture at any size without a canvas
              repaint per frame. */}
          <div
            ref={stageRef}
            className={`vision-stage${playing ? " vision-stage--playing" : ""}`}
            onPointerDown={onStagePointerDown}
            onPointerMove={onStagePointerMove}
            onPointerUp={onStagePointerUp}
            onPointerCancel={() => {
              dragStart.current = null;
              setDraft(null);
            }}
          >
            <video
              ref={videoRef}
              src={media.url}
              preload="auto"
              onLoadedMetadata={(event) => {
                setNatural({ width: event.currentTarget.videoWidth, height: event.currentTarget.videoHeight });
                seekTo(media.windowStartMs);
              }}
              onPause={() => setPlaying(false)}
              onPlay={() => setPlaying(true)}
            />
            {/* The boxes are fractions of the picture, so they are laid out inside an element
                that is exactly the picture: not the stage, which has bars on a wide window. */}
            <div className="vision-stage__picture" style={{ left: picture.x, top: picture.y, width: picture.width, height: picture.height }}>
            {boxesHere.map((box) => (
              <div
                key={box.id}
                role="button"
                tabIndex={0}
                aria-label={`${box.class} box`}
                className={[
                  "vision-box",
                  `vision-box--${box.class}`,
                  box.id === selectedBoxId ? "vision-box--selected" : "",
                  box.fromModelVersionId ? "vision-box--model" : "",
                  box.uncertain ? "vision-box--uncertain" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{
                  left: `${box.x * 100}%`,
                  top: `${box.y * 100}%`,
                  width: `${box.width * 100}%`,
                  height: `${box.height * 100}%`,
                }}
                onPointerDown={(event) => {
                  // Selecting, not drawing: the stage must not start a drag.
                  event.stopPropagation();
                  selectBox(box.id);
                }}
                onKeyDown={(event) => {
                  /* A box is a button: Enter or Space selects it, as a click does. Stopped here
                     so Space does not also play the clip. Delete on the selected box is the
                     page's own shortcut. */
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    selectBox(box.id);
                  }
                }}
              >
                <span className="vision-box__tag">
                  {box.class}
                  {box.trackId && ` #${box.trackId}`}
                  {box.fromModelVersionId && " · model"}
                  {box.uncertain && " · ?"}
                </span>
              </div>
            ))}
            {draft && (
              <div
                className={`vision-box vision-box--draft vision-box--${activeClass}`}
                style={{
                  left: `${draft.x * 100}%`,
                  top: `${draft.y * 100}%`,
                  width: `${draft.width * 100}%`,
                  height: `${draft.height * 100}%`,
                }}
              />
            )}
            </div>
          </div>

          <div className="vision-clocks">
            {/* Both clocks, side by side, always. Conflating them corrupts events. */}
            <div>
              <span className="vision-clocks__label">Match / source</span>
              <strong className="vision-mono">{position.sourceClock}</strong>
            </div>
            <div>
              <span className="vision-clocks__label">In this clip</span>
              <strong className="vision-mono">{position.proxyClock}</strong>
            </div>
            <div>
              <span className="vision-clocks__label">Frame</span>
              <strong className="vision-mono">
                {position.frameIndex ?? "—"}
                {!position.frameAccurate && (
                  <em title="The proxy reported no frame rate, so stepping moves by 100ms.">
                    {" "}
                    not frame-accurate
                  </em>
                )}
              </strong>
            </div>
          </div>

          <input
            type="range"
            min={media.windowStartMs}
            max={media.windowEndMs}
            step={frameStartMs(1, media.fps) ?? 1}
            value={proxyMs}
            onChange={(event) => seekTo(Number(event.target.value))}
            aria-label="Position within the task window"
          />

          <div className="vision-transport">
            <button type="button" onClick={() => step(-Math.round(media.fps ?? 10))}>
              −1s
            </button>
            <button type="button" onClick={() => step(-1)}>
              −1 frame
            </button>
            <button type="button" onClick={togglePlay}>
              {playing ? "Pause" : "Play"}
            </button>
            <button type="button" onClick={() => step(1)}>
              +1 frame
            </button>
            <button type="button" onClick={() => step(Math.round(media.fps ?? 10))}>
              +1s
            </button>
          </div>

          <div className="vision-classes" role="radiogroup" aria-label="Class for the next box">
            {DETECTION_CLASSES.map((cls, index) => (
              <button
                key={cls}
                type="button"
                role="radio"
                aria-checked={activeClass === cls}
                className={`vision-classes__pick vision-box--${cls}${activeClass === cls ? " is-active" : ""}`}
                onClick={() => setActiveClass(cls)}
              >
                <kbd>{index + 1}</kbd> {cls} <em>{classCounts[cls]}</em>
              </button>
            ))}
            <span className="vision-footnote">
              {boxesHere.length} on this frame · {boxes.length} in the window
              {boxedFrames.length > 0 && ` · ${boxedFrames.length} frame(s) boxed`}
              {trackCount > 0 && ` · ${trackCount} track(s)`}
            </span>
          </div>

          <p className="vision-footnote">
            Space play/pause · ← → one frame · Shift + ← → one second · 1–4 pick a class ·
            drag to draw · click a box, then Delete removes it, U marks it uncertain, 1–4
            re-class it · U with nothing selected marks the whole window uncertain · a new box
            joins the track of the box it overlaps on the previous frame; N gives it a new
            track, L links it to the track of the box you selected before
          </p>
        </section>

        <aside className="vision-workstation__side">
          <h2 className="vision-subhead">What to label</h2>
          {task.labelSchemaVersion ? (
            <ul className="vision-schema">
              {Object.entries(task.labelSchemaVersion.definitions).map(([name, definition]) => (
                <li key={name}>
                  <strong>{name}</strong>
                  <span className="vision-footnote">
                    {typeof definition === "string" ? definition : JSON.stringify(definition)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="vision-footnote">No schema loaded.</p>
          )}

          {canAnnotate && <>
          <h2 className="vision-subhead">Your note</h2>
          <label className="vision-check">
            <input
              type="checkbox"
              checked={uncertain}
              onChange={(event) => setUncertain(event.target.checked)}
            />
            <span>Uncertain — do not treat as ground truth (U)</span>
          </label>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={4}
            placeholder="What made this hard?"
          />

          <div className="vision-actions">
            <button type="button" onClick={submit} disabled={busy}>
              {busy ? "Saving…" : "Submit labels"}
            </button>
          </div>
          </>}

          <h2 className="vision-subhead">Attempts</h2>
          {!task.versions?.length ? (
            <p className="vision-footnote">Nothing submitted yet.</p>
          ) : (
            <ol className="vision-versions">
              {task.versions.map((version, index) => (
                <li key={version.id}>
                  <div>
                    <strong>{index === 0 ? "Latest" : `Earlier (#${task.versions!.length - index})`}</strong>{" "}
                    <span className="vision-footnote">
                      {new Date(version.createdAt).toLocaleString()}
                      {version.effortMinutes !== null && ` · ${version.effortMinutes} min`}
                    </span>
                  </div>
                  {/* The provenance that matters: which bytes, and by whom. */}
                  <div className="vision-footnote vision-mono">
                    {version.annotatorId ?? "unattributed"} · {version.payloadChecksum.slice(0, 12)}
                  </div>
                  {version.reviews.map((r) => (
                    <div key={r.id}>
                      {r.decision}
                      {r.rejectionReason && ` — ${REJECTION_LABELS[r.rejectionReason] ?? r.rejectionReason}`}
                      {r.notes && <div className="vision-footnote">{r.notes}</div>}
                    </div>
                  ))}
                </li>
              ))}
            </ol>
          )}

          {canReview && latestVersion && task.state !== "submitted" && (
            /* A verdict stays put: the buttons used to stay live after one, so a second click
               recorded a second approval of the same attempt. */
            <p className="vision-footnote">
              {task.state === "approved" ? "Approved. Nothing left to review here." : task.state === "rejected" ? "Sent back; it returns here when the labeller submits again." : "Nothing to review until the labeller submits."}
            </p>
          )}
          {canReview && latestVersion && task.state === "submitted" && (
            <>
              <h2 className="vision-subhead">Review the latest attempt</h2>
              <p className="vision-footnote">
                You cannot approve your own work — the second pair of eyes is the whole
                control.
              </p>
              <textarea
                value={reviewNote}
                onChange={(event) => setReviewNote(event.target.value)}
                rows={3}
                placeholder="Note for the labeller: what to fix (shown to them when it comes back)"
                aria-label="Note for the labeller"
              />
              <div className="vision-actions">
                <button type="button" onClick={() => review("approved")} disabled={busy}>
                  Approve
                </button>
              </div>
              <h3 className="vision-subhead">Send back because</h3>
              <div className="vision-reasons">
                {(Object.keys(REJECTION_LABELS) as RejectionReason[]).map((reason) => (
                  <button
                    key={reason}
                    type="button"
                    onClick={() => review("rejected", reason)}
                    disabled={busy}
                  >
                    {REJECTION_LABELS[reason]}
                  </button>
                ))}
              </div>
            </>
          )}

          <p className="vision-footnote">
            Media link expires in {Math.round(media.expiresInSeconds / 60)} min. It is the
            proxy, never the original.
          </p>
        </aside>
      </div>
    </main>
  );
}
