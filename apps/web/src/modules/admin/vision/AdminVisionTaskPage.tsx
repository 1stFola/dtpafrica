import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  fetchVisionTask,
  reviewVisionAnnotation,
  submitVisionAnnotation,
  type RejectionReason,
  type ReviewDecisionKind,
  type VisionAnnotationTask,
  type VisionTaskMedia,
} from "../../../api/vision";
import { usePageTitle } from "../../../hooks/usePageTitle";
import {
  clampToWindow,
  describePosition,

  frameStartMs,
  stepFrames,
  windowDurationMs,
} from "./annotation-time";

/**
 * The annotation workstation.
 *
 * Outside `AdminLayout` by design, following the `MatchConsoleApp` precedent: a
 * frame-accurate video tool needs the whole viewport, and a site header competing for
 * vertical space and keyboard focus makes it worse at its job.
 *
 * What this screen is responsible for, and what it is not: the drawing of dense boxes
 * and tracks belongs in a dedicated tool (CVAT, per the phase plan). This is the
 * **review workstation** — claim a window, watch exactly the right frames, record what
 * was seen, and accept or send back somebody else's work. That is the loop that exists
 * today; identity, events and merge/split arrive when there are detections to merge.
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

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [task, setTask] = useState<VisionAnnotationTask | null>(null);
  const [media, setMedia] = useState<VisionTaskMedia | null>(null);
  const [proxyMs, setProxyMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState("");
  const [uncertain, setUncertain] = useState(false);

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
          setUncertain((current) => !current);
          return;
        default:
          return;
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [media, step, togglePlay]);

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
        },
        effortMinutes: minutes,
        annotatorId: task.assignedTo ?? undefined,
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
        notes: notes.trim() || undefined,
      });
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

      <div className="vision-workstation__body">
        <section className="vision-workstation__video">
          <video
            ref={videoRef}
            src={media.url}
            preload="auto"
            onLoadedMetadata={() => seekTo(media.windowStartMs)}
            onPause={() => setPlaying(false)}
            onPlay={() => setPlaying(true)}
          />

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

          <p className="vision-footnote">
            Space play/pause · ← → one frame · Shift + ← → one second · U mark uncertain
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
                    </div>
                  ))}
                </li>
              ))}
            </ol>
          )}

          {latestVersion && (
            <>
              <h2 className="vision-subhead">Review the latest attempt</h2>
              <p className="vision-footnote">
                You cannot approve your own work — the second pair of eyes is the whole
                control.
              </p>
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
