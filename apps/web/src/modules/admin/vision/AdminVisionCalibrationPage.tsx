import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CAMERA_SEGMENT_KINDS } from "@dtp/vision-contracts";
import {
  anchorVisionClock,
  calibrateVisionSegment,
  declareVisionCameraSegment,
  fetchVisionClock,
  fetchVisionCameraSegments,
  fetchVisionPitchLandmarks,
  fetchVisionReviewMedia,
  previewVisionCalibration,
  queueVisionJob,
  removeVisionCameraSegment,
  type VisionCalibrationPoint,
  type VisionCalibrationPreview,
  type VisionCameraSegments,
  type VisionClockAnchor,
  type VisionPitchDimensions,
  type VisionPitchLandmark,
  type VisionReviewMedia,
} from "../../../api/vision";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { useAdminAuth } from "../AdminAuthContext";
import { formatClock, frameIndexAt, frameStartMs, stepFrames } from "./annotation-time";
import { HALF_NAMES, describeClock, nextHalfToAnchor } from "./match-clock";
import { usePictureRect } from "./use-picture-rect";
import {
  SEGMENT_KIND_WORDS,
  clickToProxyPixel,
  describeQuality,
  describeSegment,
  fitReason,
  nextLandmark,
  overlayPaths,
  placePoint,
  removePoint,
  segmentAt,
  segmentFromMarks,
  toFraction,
} from "./calibration-editor";

/**
 * The calibration editor: a person pauses on a frame, clicks the pitch's
 * landmarks, watches the fitted pitch drawn back over the grass, and files the
 * calibration for the camera segment at the playhead. Segments are declared here
 * too, from two marks, or proposed by the cuts stage and kept or removed.
 *
 * The fit is the API's; this screen only collects clicks and draws what it is
 * told. docs/vision/09 calls the editor a requirement, not a convenience.
 */
export function AdminVisionCalibrationPage() {
  const { assetId = "" } = useParams();
  usePageTitle("Calibration editor");
  const { hasPermission } = useAdminAuth();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [media, setMedia] = useState<VisionReviewMedia | null>(null);
  const [segments, setSegments] = useState<VisionCameraSegments | null>(null);
  const [anchors, setAnchors] = useState<VisionClockAnchor[]>([]);
  const [half, setHalf] = useState(1);
  /* The half picker is set once, to the first half without an anchor, and then
     stays where the reviewer put it: marking a half's end must not find the picker
     moved on to the next half by the kick-off they just filed. */
  const halfPicked = useRef(false);
  const [landmarks, setLandmarks] = useState<VisionPitchLandmark[]>([]);
  const [pitch, setPitch] = useState<VisionPitchDimensions>({ lengthM: 105, widthM: 68 });
  const [points, setPoints] = useState<VisionCalibrationPoint[]>([]);
  const [preview, setPreview] = useState<VisionCalibrationPreview | null>(null);
  const [activeLandmark, setActiveLandmark] = useState<string | null>(null);
  const [proxyMs, setProxyMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [markStart, setMarkStart] = useState<number | null>(null);
  const [markEnd, setMarkEnd] = useState<number | null>(null);
  const [kind, setKind] = useState<string>(CAMERA_SEGMENT_KINDS[0]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadSegments = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([fetchVisionCameraSegments(assetId), fetchVisionClock(assetId)]);
      setSegments(s);
      setAnchors(c.anchors);
      if (!halfPicked.current) {
        setHalf(nextHalfToAnchor(c.anchors));
        halfPicked.current = true;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [assetId]);

  useEffect(() => {
    void loadSegments();
    fetchVisionReviewMedia(assetId)
      .then(setMedia)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [assetId, loadSegments]);

  useEffect(() => {
    fetchVisionPitchLandmarks(pitch)
      .then((r) => {
        setLandmarks(r.landmarks);
        if (r.problem) setError(r.problem);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [pitch]);

  /* The live readout: every change of the points re-fits, saved nowhere. */
  useEffect(() => {
    if (points.length < 4) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    previewVisionCalibration(points, pitch)
      .then((p) => {
        if (!cancelled) setPreview(p);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [pitch, points]);

  const offsetMs = media?.sourceOffsetMs ?? 0;
  const sourceMs = proxyMs + offsetMs;
  const clipEndMs = media?.durationMs ?? 0;
  const proxySize = useMemo(() => ({ width: media?.width ?? 0, height: media?.height ?? 0 }), [media]);
  const picture = usePictureRect(stageRef, proxySize, Boolean(media && segments));
  const clipWindow = useMemo(() => ({ windowStartMs: 0, windowEndMs: clipEndMs, fps: media?.fps ?? null }), [clipEndMs, media]);
  const current = useMemo(() => (segments ? segmentAt(segments.segments, sourceMs) : null), [segments, sourceMs]);
  const suggested = useMemo(() => nextLandmark(landmarks, points), [landmarks, points]);
  const target = activeLandmark ?? suggested?.id ?? null;
  const paths = useMemo(() => (preview?.ok ? overlayPaths(preview.overlay, proxySize) : []), [preview, proxySize]);
  const reprojected = useMemo(() => (preview?.ok ? preview.reprojected : []), [preview]);
  const landmarkName = useCallback((id: string) => landmarks.find((l) => l.id === id)?.name ?? id, [landmarks]);

  const seekTo = useCallback(
    (nextProxyMs: number) => {
      const clamped = Math.min(Math.max(nextProxyMs, 0), clipEndMs || nextProxyMs);
      setProxyMs(clamped);
      const el = videoRef.current;
      if (el) el.currentTime = clamped / 1000;
    },
    [clipEndMs]
  );
  const step = useCallback((frames: number) => seekTo(stepFrames(proxyMs, frames, media?.fps ?? null, clipWindow)), [clipWindow, media, proxyMs, seekTo]);
  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  }, []);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !media) return;
    let raf = 0;
    let last = -1;
    const tick = () => {
      const ms = el.currentTime * 1000;
      if (Math.abs(ms - last) >= 40) {
        last = ms;
        setProxyMs(ms);
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [media]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement | null;
      if (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
      if (event.key === " ") {
        event.preventDefault();
        togglePlay();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        step(event.shiftKey ? -Math.round(media?.fps ?? 10) : -1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        step(event.shiftKey ? Math.round(media?.fps ?? 10) : 1);
      } else if (event.key === "Escape") {
        setActiveLandmark(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [media, step, togglePlay]);

  /** A click on the paused frame places the target landmark there, in the proxy's pixels. */
  const onStageClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (playing || !target || !stageRef.current) return;
      const rect = stageRef.current.getBoundingClientRect();
      const pixel = clickToProxyPixel({ x: event.clientX - rect.left, y: event.clientY - rect.top }, picture, proxySize);
      if (!pixel) return;
      setPoints((prev) => placePoint(prev, { landmark: target, ...pixel, frameIndex: frameIndexAt(proxyMs, media?.fps ?? null) ?? undefined }));
      setActiveLandmark(null);
      setError(null);
    },
    [media, picture, playing, proxyMs, proxySize, target]
  );

  async function run(label: string, action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(label);
      await loadSegments();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function declare() {
    const made = segmentFromMarks(markStart, markEnd, segments?.durationMs ?? null);
    if (typeof made === "string") {
      setError(made);
      return;
    }
    void run(`Segment declared ${formatClock(made.startMs)}–${formatClock(made.endMs)}.`, async () => {
      await declareVisionCameraSegment(assetId, { ...made, kind });
      setMarkStart(null);
      setMarkEnd(null);
    });
  }

  function save() {
    if (!current) {
      setError("No camera segment covers the playhead. Declare one, or move to one.");
      return;
    }
    void run(`Calibration filed on the segment at ${formatClock(sourceMs)}.`, () => calibrateVisionSegment(current.id, points, pitch));
  }

  function loadFromSegment() {
    if (!current?.calibration) return;
    setPitch(current.calibration.pitch);
    setPoints(current.calibration.clicked);
    setNotice(`Loaded the segment's ${current.calibration.quality} calibration; click a landmark to move it.`);
  }

  if (error && !media && !segments) {
    return (
      <div className="vision-workstation">
        <p className="vision-panel vision-panel--error">{error}</p>
        <Link to="/admin/vision">Back to Vision</Link>
      </div>
    );
  }
  if (!media || !segments) return <div className="vision-workstation">Loading…</div>;

  return (
    <div className="vision-workstation">
      <div className="vision-workstation__bar">
        <strong>Calibration editor</strong>
        <span className="vision-mono">{assetId.slice(0, 8)}</span>
        <span>
          {segments.segments.length} segment(s) · {Math.round(segments.coverage.calibratedMs / 1000)}s calibrated of {Math.round(segments.coverage.segmentedMs / 1000)}s segmented
        </span>
        <span className="vision-filters__grow" />
        <Link to={`/admin/vision/workstation/identity/${assetId}`}>Identity review</Link>
        <Link to="/admin/vision">Vision</Link>
      </div>

      {error && <p className="vision-panel vision-panel--error">{error}</p>}
      {notice && <p className="vision-panel vision-panel--ok">{notice}</p>}

      <div className="vision-workstation__body">
        <div className="vision-workstation__video">
          <div ref={stageRef} className={`vision-stage vision-stage--calibrate${playing ? " vision-stage--playing" : ""}`} onClick={onStageClick}>
            <video ref={videoRef} src={media.url} preload="auto" onLoadedMetadata={() => seekTo(0)} onPause={() => setPlaying(false)} onPlay={() => setPlaying(true)} />
            <div className="vision-picture" style={{ left: picture.x, top: picture.y, width: picture.width, height: picture.height }}>
            {paths.length > 0 && (
              <svg className="vision-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="The fitted pitch">
                {paths.map((p) => (
                  <path key={p.id} d={p.d} vectorEffect="non-scaling-stroke" />
                ))}
              </svg>
            )}
            {reprojected.map((r) => {
              const f = toFraction(r, proxySize);
              return <span key={`re-${r.landmark}`} className="vision-landmark vision-landmark--reprojected" style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%` }} title={`${landmarkName(r.landmark)}: the fit puts it here, ${r.errorM.toFixed(2)} m off`} />;
            })}
            {points.map((p) => {
              const f = toFraction(p, proxySize);
              return (
                <button
                  key={p.landmark}
                  type="button"
                  className={`vision-landmark${p.landmark === target ? " is-target" : ""}`}
                  style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%` }}
                  title={`${landmarkName(p.landmark)} · click to move, right-click to remove`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveLandmark(p.landmark);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setPoints((prev) => removePoint(prev, p.landmark));
                  }}
                >
                  <span className="vision-landmark__tag">{landmarkName(p.landmark)}</span>
                </button>
              );
            })}
            </div>
          </div>

          <div className="vision-clocks">
            <div>
              <span className="vision-clocks__label">Match / source</span>
              <strong className="vision-mono">{formatClock(sourceMs)}</strong>
            </div>
            <div>
              <span className="vision-clocks__label">In this clip</span>
              <strong className="vision-mono">{formatClock(proxyMs)}</strong>
            </div>
            <div>
              <span className="vision-clocks__label">Match clock</span>
              <strong className="vision-mono">{describeClock(anchors, sourceMs)}</strong>
            </div>
            <div>
              <span className="vision-clocks__label">Segment here</span>
              <strong>{current ? describeSegment(current, formatClock) : "none"}</strong>
            </div>
          </div>

          <input type="range" min={0} max={clipEndMs || 0} step={frameStartMs(1, media.fps) ?? 1} value={proxyMs} onChange={(e) => seekTo(Number(e.target.value))} aria-label="Position in the clip" />
          <div className="vision-transport">
            <button type="button" onClick={() => step(-Math.round(media.fps ?? 10))}>−1s</button>
            <button type="button" onClick={() => step(-1)}>−1 frame</button>
            <button type="button" onClick={togglePlay}>{playing ? "Pause" : "Play"}</button>
            <button type="button" onClick={() => step(1)}>+1 frame</button>
            <button type="button" onClick={() => step(Math.round(media.fps ?? 10))}>+1s</button>
            <button type="button" onClick={() => setMarkStart(sourceMs)}>Mark start</button>
            <button type="button" onClick={() => setMarkEnd(sourceMs)}>Mark end</button>
          </div>
          <p className="vision-footnote">
            {playing ? "Pause to place landmarks." : target ? `Click the frame where the ${landmarkName(target).toLowerCase()} is.` : "Every landmark is placed."} Click a placed landmark to move it; right-click removes it. Space play/pause · ← → one frame · Shift + ← → one second · Esc clears the pick.
          </p>
        </div>

        <div className="vision-workstation__side">
          <section className="vision-panel">
            <h3 className="vision-panel__title">The fit</h3>
            <div className="vision-row">
              <label className="vision-row__label" htmlFor="pitch-length">Pitch</label>
              <span className="vision-row__value">
                <input id="pitch-length" type="number" min={45} max={120} step={0.5} value={pitch.lengthM} onChange={(e) => setPitch({ ...pitch, lengthM: Number(e.target.value) })} aria-label="Pitch length in metres" /> ×{" "}
                <input type="number" min={30} max={90} step={0.5} value={pitch.widthM} onChange={(e) => setPitch({ ...pitch, widthM: Number(e.target.value) })} aria-label="Pitch width in metres" /> m
              </span>
            </div>
            <p className="vision-footnote">Store the pitch's real size: assuming 105 × 68 on a short pitch corrupts every distance.</p>
            {preview === null && <p>{points.length} of 4 landmarks placed.</p>}
            {preview && !preview.ok && <p className="vision-warn">{fitReason(preview.reason, preview.detail)}</p>}
            {preview?.ok && (
              <>
                <p>
                  <strong className={`vision-quality vision-quality--${preview.quality}`}>{describeQuality(preview)}</strong>
                  <br />
                  <span className="vision-sub">
                    worst landmark {preview.maxPointErrorM.toFixed(2)} m · {preview.reprojectionErrorPx.toFixed(1)} px · {preview.thresholdsVersion}
                  </span>
                </p>
                <p className="vision-footnote">
                  {segments.thresholds.goodRmseM} m over {segments.thresholds.goodMinPoints} is good; {segments.thresholds.usableRmseM} m is usable; worse, or any landmark {segments.thresholds.maxPointErrorM} m out, is failed. A failed calibration is filed too — it is what makes a distance refuse.
                </p>
              </>
            )}
            <div className="vision-actions">
              <button type="button" disabled={busy || !preview?.ok || !current} onClick={save}>
                File on the segment here
              </button>
              <button type="button" disabled={busy || !current?.calibration} onClick={loadFromSegment}>
                Load the segment's calibration
              </button>
              <button type="button" disabled={busy || !points.length} onClick={() => setPoints([])}>
                Clear
              </button>
            </div>
          </section>

          <section className="vision-panel">
            <h3 className="vision-panel__title">Landmarks</h3>
            <ul className="vision-candidates">
              {landmarks.map((l) => {
                const placed = points.find((p) => p.landmark === l.id);
                const err = reprojected.find((r) => r.landmark === l.id);
                return (
                  <li key={l.id}>
                    <button type="button" className={`vision-candidates__pick${l.id === target ? " is-active" : ""}${placed ? " is-placed" : ""}`} onClick={() => setActiveLandmark(l.id)}>
                      {placed ? "●" : "○"} {l.name}
                      {err && <span className="vision-sub"> · {err.errorM.toFixed(2)} m</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="vision-panel">
            <h3 className="vision-panel__title">Match clock</h3>
            {anchors.length ? (
              <ul className="vision-candidates">
                {anchors.map((a) => (
                  <li key={a.half} className="vision-sub">
                    {HALF_NAMES[a.half] ?? `half ${a.half}`}: kick-off {formatClock(a.sourceMs)}
                    {a.endMs !== null ? `, ends ${formatClock(a.endMs)}` : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="vision-footnote">Not anchored. Pause on the whistle and mark the kick-off; substitutions and every match minute depend on it.</p>
            )}
            <div className="vision-row">
              <span className="vision-row__label">Half</span>
              <span className="vision-row__value">
                <select value={half} onChange={(e) => setHalf(Number(e.target.value))} aria-label="Half to anchor">
                  {[1, 2, 3, 4].map((h) => (
                    <option key={h} value={h}>
                      {HALF_NAMES[h]}
                    </option>
                  ))}
                </select>
              </span>
            </div>
            <div className="vision-actions">
              <button type="button" disabled={busy} onClick={() => void run(`${HALF_NAMES[half]} kicks off at ${formatClock(sourceMs)}.`, () => anchorVisionClock(assetId, { half, sourceMs: Math.round(sourceMs) }))}>
                Kick-off is here
              </button>
              <button
                type="button"
                disabled={busy || !anchors.some((a) => a.half === half)}
                onClick={() => {
                  const a = anchors.find((x) => x.half === half)!;
                  void run(`${HALF_NAMES[half]} ends at ${formatClock(sourceMs)}.`, () => anchorVisionClock(assetId, { half, sourceMs: a.sourceMs, endMs: Math.round(sourceMs) }));
                }}
              >
                Half ends here
              </button>
            </div>
          </section>

          <section className="vision-panel">
            <h3 className="vision-panel__title">Camera segments</h3>
            <ul className="vision-tracklist">
              {segments.segments.map((s) => (
                <li key={s.id}>
                  <div className={`vision-tracklist__row${current?.id === s.id ? " is-selected" : ""}`}>
                    <button type="button" className="vision-linklike" onClick={() => seekTo(s.startMs - offsetMs)}>
                      {describeSegment(s, formatClock)}
                    </button>
                    {s.superseded > 0 && <span className="vision-sub"> · {s.superseded} superseded</span>}
                    {!s.calibration && (
                      <button type="button" disabled={busy} onClick={() => void run("Segment removed.", () => removeVisionCameraSegment(s.id))}>
                        Remove
                      </button>
                    )}
                  </div>
                </li>
              ))}
              {!segments.segments.length && <li className="vision-footnote">No segments yet. Mark a start and an end, or propose cuts.</li>}
            </ul>
            <div className="vision-row">
              <span className="vision-row__label">New</span>
              <span className="vision-row__value">
                {markStart === null ? "start —" : `start ${formatClock(markStart)}`} · {markEnd === null ? "end —" : `end ${formatClock(markEnd)}`} ·{" "}
                <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Segment kind">
                  {/* The contract's kinds: the ones the API accepts, and the ones the in-play rule reads. */}
                  {CAMERA_SEGMENT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {SEGMENT_KIND_WORDS[k]}
                    </option>
                  ))}
                </select>
              </span>
            </div>
            <div className="vision-actions">
              <button type="button" disabled={busy || markStart === null || markEnd === null} onClick={declare}>
                Declare segment
              </button>
              {hasPermission("vision.jobs.run") && (
                <button type="button" disabled={busy} onClick={() => void run("Cuts queued; proposals appear when the worker finishes.", () => queueVisionJob({ type: "cuts", videoAssetId: assetId }))}>
                  Propose cuts
                </button>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
