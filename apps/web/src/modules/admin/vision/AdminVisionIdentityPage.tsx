import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  acceptVisionIdentity,
  assignVisionIdentity,
  fetchVisionIdentityReview,
  fetchVisionReviewMedia,
  fetchVisionTrackCandidates,
  fetchVisionTrackPositions,
  rejectVisionIdentity,
  setVisionTeamSides,
  type VisionIdentityReview,
  type VisionReviewMedia,
  type VisionReviewTrack,
  type VisionTrackCandidates,
} from "../../../api/vision";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { useAdminAuth } from "../AdminAuthContext";
import { formatClock, frameIndexAt, frameStartMs, stepFrames } from "./annotation-time";
import {
  candidateLabel,
  describeAssignment,
  filterCandidates,
  formatSeconds,
  identifyJobOf,
  identitySummary,
  isPublic,
  mayAccept,
  positionAt,
  sideLabel,
  sortPositions,
  splitAt,
  teamNameOf,
  toPercentBox,
  windowProblem,
  type TrackPosition,
} from "./identity-review";

/**
 * The identity review workstation: who each track is.
 *
 * The proxy plays on the left with every track's box drawn on the frame being
 * shown, from the track artifact in object storage -- a box the tracker saw, never
 * one interpolated across a gap. The right side is the review model from
 * docs/vision/35: which team each kit side is, the track's roster candidates, and
 * one verb for split, merge, reassign and mark-unknown -- an assignment over a
 * window. A second person accepts, and only that is public.
 *
 * Nothing here suggests a name. The candidates are the roster, not a ranking.
 */
export function AdminVisionIdentityPage() {
  const { assetId = "" } = useParams();
  usePageTitle("Identity review");
  const { session } = useAdminAuth();
  const me = session?.userId;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [review, setReview] = useState<VisionIdentityReview | null>(null);
  const [media, setMedia] = useState<VisionReviewMedia | null>(null);
  const [proxyMs, setProxyMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [publicPreview, setPublicPreview] = useState<VisionIdentityReview | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<VisionTrackCandidates | null>(null);
  const [query, setQuery] = useState("");
  const [slotId, setSlotId] = useState<string | null>(null);
  const [overrule, setOverrule] = useState(false);
  const [note, setNote] = useState("");
  const [propagateTo, setPropagateTo] = useState<Set<string>>(new Set());
  const [sideA, setSideA] = useState("");
  const [sideB, setSideB] = useState("");
  const [rejectReason, setRejectReason] = useState("");

  /** Positions per track id, read through the control plane once each. */
  const [positions, setPositions] = useState<Map<string, TrackPosition[]>>(new Map());
  /** Roster names by slot id, so assignments read as people rather than ids. */
  const [slotNames, setSlotNames] = useState<Map<string, string>>(new Map());

  /* The review rows reload after every action; the media does not, or the video
     element would take a fresh URL and jump back to the start each time. */
  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await fetchVisionIdentityReview(assetId);
      setReview(r);
      setSlotNames((prev) => {
        const next = new Map(prev);
        for (const t of r.tracks) for (const a of t.identities) if (a.matchSquadPlayerId && a.slot) next.set(a.matchSquadPlayerId, `#${a.slot.jerseyNumber ?? "—"} ${a.slot.name}`);
        return next;
      });
      const decided = Object.fromEntries(r.sidesDecided.map((s) => [s.team, s.sbTeamId]));
      setSideA(decided.A ?? "");
      setSideB(decided.B ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [assetId]);

  useEffect(() => {
    void load();
    fetchVisionReviewMedia(assetId)
      .then(setMedia)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [assetId, load]);

  /* Every track's positions, fetched once each; a track whose artifact cannot be
     read simply draws no box, and the error is shown once. */
  useEffect(() => {
    if (!review) return;
    const missing = review.tracks.filter((t) => !positions.has(t.id));
    if (!missing.length) return;
    let cancelled = false;
    void (async () => {
      const next = new Map(positions);
      let failure: string | null = null;
      for (const track of missing) {
        try {
          const result = await fetchVisionTrackPositions(track.id);
          next.set(track.id, sortPositions(result.positions));
        } catch (e) {
          next.set(track.id, []);
          failure = e instanceof Error ? e.message : String(e);
        }
      }
      if (cancelled) return;
      setPositions(next);
      if (failure) setError(`Some tracks have no readable positions: ${failure}`);
    })();
    return () => {
      cancelled = true;
    };
  }, [review, positions]);

  const selected = useMemo(() => review?.tracks.find((t) => t.id === selectedId) ?? null, [review, selectedId]);

  useEffect(() => {
    setSlotId(null);
    setOverrule(false);
    setPropagateTo(new Set());
    setQuery("");
    setRejectReason("");
  }, [selected]);

  /* The roster: this side's, or the whole match's when the reviewer says the kit
     was read wrongly and needs the other squad in front of them. */
  useEffect(() => {
    setCandidates(null);
    if (!selected) return;
    void fetchVisionTrackCandidates(selected.id, overrule)
      .then((c) => {
        setCandidates(c);
        setSlotNames((prev) => {
          const next = new Map(prev);
          for (const cand of c.candidates) next.set(cand.matchSquadPlayerId, `#${cand.jerseyNumber ?? "—"} ${cand.name}`);
          return next;
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [overrule, selected]);

  const offsetMs = media?.sourceOffsetMs ?? review?.proxy?.sourceOffsetMs ?? 0;
  const clipEndMs = media?.durationMs ?? 0;
  const clipWindow = useMemo(() => ({ windowStartMs: 0, windowEndMs: clipEndMs, fps: media?.fps ?? null }), [clipEndMs, media]);
  const sourceMs = proxyMs + offsetMs;
  const nameOfSlot = useCallback((id: string) => slotNames.get(id), [slotNames]);

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
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.key === " ") {
        event.preventDefault();
        togglePlay();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        step(event.shiftKey ? -Math.round(media?.fps ?? 10) : -1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        step(event.shiftKey ? Math.round(media?.fps ?? 10) : 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [media, step, togglePlay]);

  /** Every track with a position on this frame, as a percentage box. */
  const boxesHere = useMemo(() => {
    if (!review) return [];
    const width = media?.width ?? review.proxy?.width ?? null;
    const height = media?.height ?? review.proxy?.height ?? null;
    const out: { track: VisionReviewTrack; rect: { x: number; y: number; width: number; height: number } }[] = [];
    for (const track of review.tracks) {
      const p = positionAt(positions.get(track.id) ?? [], proxyMs, media?.fps ?? null);
      if (!p) continue;
      const rect = toPercentBox(p.box, width, height);
      if (rect) out.push({ track, rect });
    }
    return out;
  }, [media, positions, proxyMs, review]);

  const identifyJob = useMemo(() => (review ? identifyJobOf(review.tracks) : null), [review]);
  const shownCandidates = useMemo(() => (candidates ? filterCandidates(candidates.candidates, query) : []), [candidates, query]);

  async function run(label: string, action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(label);
      await load();
      setPublicPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function assign(windowOf: { from: number; to: number } | null, slot: string | null) {
    if (!selected) return;
    const w = windowOf ?? { from: selected.startMs, to: selected.endMs };
    const problem = windowProblem(selected, w);
    if (problem) {
      setError(problem);
      return;
    }
    const who = slot ? (nameOfSlot(slot) ?? "that player") : "unknown";
    void run(`${who} written on track #${selected.localTrackId} for ${formatSeconds(w.from)}–${formatSeconds(w.to)}.`, () =>
      assignVisionIdentity(selected.id, {
        matchSquadPlayerId: slot,
        validFromMs: w.from,
        validToMs: w.to,
        note: note.trim() || undefined,
        propagateTo: slot && propagateTo.size ? [...propagateTo] : undefined,
        acceptSideMismatch: overrule || undefined,
      })
    );
  }

  const split = selected ? splitAt(selected, sourceMs) : null;

  if (error && !review) {
    return (
      <div className="vision-workstation">
        <p className="vision-panel vision-panel--error">{error}</p>
        <Link to="/admin/vision">Back to Vision</Link>
      </div>
    );
  }
  if (!review || !media) return <div className="vision-workstation">Loading…</div>;

  return (
    <div className="vision-workstation">
      <div className="vision-workstation__bar">
        <strong>Identity review</strong>
        <span className="vision-mono">{assetId.slice(0, 8)}</span>
        {review.match ? (
          <span>
            {review.match.homeTeam.name} v {review.match.awayTeam.name}
          </span>
        ) : (
          <span className="vision-pill vision-pill--warn">no match linked: no roster</span>
        )}
        <span>{review.count} track(s)</span>
        <span className="vision-filters__grow" />
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void fetchVisionIdentityReview(assetId, true)
              .then(setPublicPreview)
              .catch((e) => setError(e instanceof Error ? e.message : String(e)))
          }
        >
          What the public would see
        </button>
        <Link to="/admin/vision">Vision</Link>
      </div>

      {error && <p className="vision-panel vision-panel--error">{error}</p>}
      {notice && <p className="vision-panel vision-panel--ok">{notice}</p>}
      {publicPreview && (
        <p className="vision-panel">
          Public: {publicPreview.count} track(s) with an accepted, named identity;{" "}
          {publicPreview.tracks.flatMap((t) => t.identities).filter(isPublic).length} window(s). Everything else stays in this room.
        </p>
      )}

      <div className="vision-workstation__body">
        <div className="vision-workstation__video">
          <div className={`vision-stage vision-stage--review${playing ? " vision-stage--playing" : ""}`}>
            <video
              ref={videoRef}
              src={media.url}
              preload="auto"
              onLoadedMetadata={() => seekTo(0)}
              onPause={() => setPlaying(false)}
              onPlay={() => setPlaying(true)}
            />
            {boxesHere.map(({ track, rect }) => (
              <div
                key={track.id}
                role="button"
                tabIndex={0}
                aria-label={`track ${track.localTrackId}`}
                className={["vision-box", `vision-box--${track.class}`, track.id === selectedId ? "vision-box--selected" : ""].filter(Boolean).join(" ")}
                style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  setSelectedId(track.id);
                }}
              >
                <span className="vision-box__tag">
                  #{track.localTrackId}
                  {track.team?.team && ` ${track.team.team}`}
                  {" · "}
                  {identitySummary(track, nameOfSlot)}
                </span>
              </div>
            ))}
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
              <span className="vision-clocks__label">Frame</span>
              <strong className="vision-mono">{frameIndexAt(proxyMs, media.fps) ?? "—"}</strong>
            </div>
          </div>

          <input
            type="range"
            min={0}
            max={clipEndMs || 0}
            step={frameStartMs(1, media.fps) ?? 1}
            value={proxyMs}
            onChange={(event) => seekTo(Number(event.target.value))}
            aria-label="Position in the clip"
          />
          <div className="vision-transport">
            <button type="button" onClick={() => step(-Math.round(media.fps ?? 10))}>−1s</button>
            <button type="button" onClick={() => step(-1)}>−1 frame</button>
            <button type="button" onClick={togglePlay}>{playing ? "Pause" : "Play"}</button>
            <button type="button" onClick={() => step(1)}>+1 frame</button>
            <button type="button" onClick={() => step(Math.round(media.fps ?? 10))}>+1s</button>
            {selected && (
              <button type="button" onClick={() => seekTo(selected.startMs - offsetMs)}>
                Go to track #{selected.localTrackId}
              </button>
            )}
          </div>
          <p className="vision-footnote">
            {boxesHere.length} track(s) on this frame · a box is where the tracker saw the player, never interpolated across a gap · Space
            play/pause · ← → one frame · Shift + ← → one second · click a box to select its track
          </p>
        </div>

        <div className="vision-workstation__side">
          <section className="vision-panel">
            <h3 className="vision-panel__title">Which team is which side</h3>
            {!review.match ? (
              <p className="vision-footnote">This footage is not linked to a match, so sides cannot be named and there is no roster.</p>
            ) : !identifyJob ? (
              <p className="vision-footnote">No track has been sided by a kit yet. Run identify first.</p>
            ) : (
              <>
                <label className="vision-row">
                  <span className="vision-row__label">Side A</span>
                  <select value={sideA} onChange={(e) => setSideA(e.target.value)}>
                    <option value="">—</option>
                    <option value={review.match.homeTeam.id}>{review.match.homeTeam.name}</option>
                    <option value={review.match.awayTeam.id}>{review.match.awayTeam.name}</option>
                  </select>
                </label>
                <label className="vision-row">
                  <span className="vision-row__label">Side B</span>
                  <select value={sideB} onChange={(e) => setSideB(e.target.value)}>
                    <option value="">—</option>
                    <option value={review.match.homeTeam.id}>{review.match.homeTeam.name}</option>
                    <option value={review.match.awayTeam.id}>{review.match.awayTeam.name}</option>
                  </select>
                </label>
                <button
                  type="button"
                  disabled={busy || !sideA || !sideB || sideA === sideB}
                  onClick={() => void run("Sides decided.", () => setVisionTeamSides(identifyJob, { A: sideA, B: sideB }))}
                >
                  Decide sides
                </button>
                {sideA && sideA === sideB && <span className="vision-footnote"> One team each.</span>}
              </>
            )}
          </section>

          <section className="vision-panel">
            <h3 className="vision-panel__title">Tracks</h3>
            <ul className="vision-tracklist">
              {review.tracks.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className={`vision-tracklist__row${t.id === selectedId ? " is-selected" : ""}`}
                    onClick={() => setSelectedId(t.id)}
                  >
                    <span className="vision-mono">#{t.localTrackId}</span> <span>{t.class}</span>{" "}
                    <span className="vision-sub">{formatSeconds(t.startMs)}–{formatSeconds(t.endMs)}</span>
                    <br />
                    <span className="vision-sub">{sideLabel(t, review.match)}</span>
                    <br />
                    <span>{identitySummary(t, nameOfSlot)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {selected && (
            <section className="vision-panel">
              <h3 className="vision-panel__title">
                Track #{selected.localTrackId} · {sideLabel(selected, review.match)}
              </h3>

              {selected.identities.filter((a) => a.supersededBy === null).length > 0 && (
                <ul className="vision-identities">
                  {selected.identities
                    .filter((a) => a.supersededBy === null)
                    .map((a) => (
                      <li key={a.id} className={`vision-identity-row vision-identity-row--${a.reviewState}`}>
                        <span>{describeAssignment(a, nameOfSlot)}</span>
                        {isPublic(a) && <span className="vision-pill">public</span>}
                        {a.decidedBy === me && a.reviewState === "unreviewed" && <span className="vision-sub"> yours; a second person accepts</span>}
                        {mayAccept(a, me) && (
                          <>
                            <button type="button" disabled={busy} onClick={() => void run("Accepted.", () => acceptVisionIdentity(a.id))}>
                              Accept
                            </button>
                            <button
                              type="button"
                              disabled={busy || rejectReason.trim().length < 3}
                              title="Say why in the box below first"
                              onClick={() => void run("Rejected.", () => rejectVisionIdentity(a.id, rejectReason.trim()))}
                            >
                              Reject
                            </button>
                          </>
                        )}
                      </li>
                    ))}
                </ul>
              )}

              {selected.identities.some((a) => mayAccept(a, me)) && (
                <input
                  type="text"
                  placeholder="Why is it wrong? (needed to reject)"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  aria-label="Reason for rejecting"
                />
              )}

              {candidates && (
                <>
                  <p className="vision-footnote">
                    Candidates: {candidates.narrowedBy === "side" ? "this side's match squad" : "the whole match squad"} ({candidates.candidates.length}).{" "}
                    {candidates.clock}
                  </p>
                  <input
                    type="search"
                    placeholder="Number or name"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Find a candidate"
                  />
                  <ul className="vision-candidates" role="radiogroup" aria-label="Who this track is">
                    {shownCandidates.map((c) => (
                      <li key={c.matchSquadPlayerId}>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={slotId === c.matchSquadPlayerId}
                          className={`vision-candidates__pick${slotId === c.matchSquadPlayerId ? " is-active" : ""}`}
                          onClick={() => setSlotId(c.matchSquadPlayerId)}
                        >
                          {candidateLabel(c)}
                          {candidates.narrowedBy === "match" && review.match && (
                            <span className="vision-sub"> · {teamNameOf(c.sbTeamId, review.match) ?? c.sbTeamId.slice(0, 8)}</span>
                          )}
                        </button>
                      </li>
                    ))}
                    {!shownCandidates.length && <li className="vision-footnote">Nobody matches.</li>}
                  </ul>
                </>
              )}

              <label className="vision-check">
                <input type="checkbox" checked={overrule} onChange={(e) => setOverrule(e.target.checked)} /> The kit side is wrong; this player is on the
                other team
              </label>

              <details>
                <summary>Merge: this is the same person on other tracks ({propagateTo.size})</summary>
                <ul className="vision-candidates">
                  {review.tracks
                    .filter((t) => t.id !== selected.id)
                    .map((t) => (
                      <li key={t.id}>
                        <label className="vision-check">
                          <input
                            type="checkbox"
                            checked={propagateTo.has(t.id)}
                            onChange={(e) =>
                              setPropagateTo((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(t.id);
                                else next.delete(t.id);
                                return next;
                              })
                            }
                          />{" "}
                          #{t.localTrackId} {t.class} {formatSeconds(t.startMs)}–{formatSeconds(t.endMs)} · {sideLabel(t, review.match)}
                        </label>
                      </li>
                    ))}
                </ul>
              </details>

              <input type="text" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" />

              <div className="vision-actions">
                <button type="button" disabled={busy || !slotId} onClick={() => assign(null, slotId)}>
                  Assign over the whole track
                </button>
                <button type="button" disabled={busy || !slotId || !split} onClick={() => split && assign(split.before, slotId)} title="A split: this player up to the playhead">
                  Up to {formatClock(sourceMs)}
                </button>
                <button type="button" disabled={busy || !slotId || !split} onClick={() => split && assign(split.after, slotId)} title="A split: this player from the playhead">
                  From {formatClock(sourceMs)}
                </button>
                <button type="button" disabled={busy} onClick={() => assign(null, null)}>
                  Mark unknown
                </button>
              </div>
              <p className="vision-footnote">
                A new window supersedes what it overlaps. Unknown is an answer, and it is never merged onto another track.
              </p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
