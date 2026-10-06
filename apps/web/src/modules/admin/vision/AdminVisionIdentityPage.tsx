import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { reviewQueueOrder } from "@dtp/vision-contracts";
import { ReviewOrderControl } from "./ReviewOrderControl";
import {
  acceptVisionIdentity,
  assignVisionIdentity,
  correctVisionEvent,
  decideVisionEvent,
  fetchVisionEventCandidates,
  promoteVisionEvent,
  proposeVisionEvent,
  fetchVisionGameState,
  fetchVisionIdentityReview,
  fetchVisionReviewMedia,
  fetchVisionAssetPositions,
  fetchVisionTrackCandidates,
  rejectVisionIdentity,
  setVisionTeamSides,
  type VisionIdentityReview,
  type VisionReviewMedia,
  type VisionReviewTrack,
  type VisionEventCandidate,
  type VisionGameState,
  type VisionTrackCandidates,
} from "../../../api/vision";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { useAdminAuth } from "../AdminAuthContext";
import { formatClock, frameIndexAt, frameStartMs, stepFrames } from "./annotation-time";
import { ChunkCache, chunkCovering, explainChunkFailure, loadChunk, rowsNear, rowsOnFrame, type DecodedChunk } from "./game-state";
import { snapSourceTimeMs } from "./annotation-boxes";
import { EVENT_TYPES, allowedActions, candidateAt, describeCandidate, proposalAt, stepCandidate, stepRankedReview, uncertainties } from "./event-review";
import { SHORTCUT_HELP, shortcutOf, type Shortcut } from "./identity-shortcuts";
import { describeClock } from "./match-clock";
import { VisionEventInspector } from "./VisionEventInspector";
import { VisionEventTimeline } from "./VisionEventTimeline";
import { VisionMinimap, type MinimapStatus } from "./VisionMinimap";
import { usePictureRect } from "./use-picture-rect";
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
  const { session, hasPermission } = useAdminAuth();
  const me = session?.userId;
  const [params, setParams] = useSearchParams();
  const reviewOrder = params.has("order") ? reviewQueueOrder(params.get("order")) : "confidence";
  const rankedCursor = useRef<string | null>(params.get("event") ? `event:${params.get("event")}` : params.get("review") ? `identity:${params.get("review")}` : null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
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

  /** Positions per track id, for the latest track run, read through the control plane in one request. */
  const [positions, setPositions] = useState<Map<string, TrackPosition[]>>(new Map());
  /** Which track run the positions are of, and how many runs the footage has. */
  const [trackRun, setTrackRun] = useState<{ jobId: string | null; runs: number }>({ jobId: null, runs: 0 });
  /** The clip's length as the video element reports it, for a proxy whose probe recorded none. */
  const [videoMs, setVideoMs] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const rejectReasonRef = useRef<HTMLInputElement | null>(null);
  const mergeRef = useRef<HTMLDetailsElement | null>(null);
  /* A playback URL is signed and expires. When the video fails, a new one is asked for
     once, and the playhead goes back to where it was. */
  const resumeAt = useRef<number | null>(null);
  const refreshedAt = useRef(0);
  /** What a key does, as of the latest render; the listener itself is attached once. */
  const onShortcut = useRef<(shortcut: Shortcut) => void>(() => undefined);
  /** Roster names by slot id, so assignments read as people rather than ids. */
  const [slotNames, setSlotNames] = useState<Map<string, string>>(new Map());
  /* The minimap's rows: the latest game state's chunk list from the API, and the
     decoded chunk covering the playhead, fetched from the bucket by the browser. */
  const [gameState, setGameState] = useState<VisionGameState | null>(null);
  const [chunk, setChunk] = useState<DecodedChunk | null>(null);
  const [chunkStatus, setChunkStatus] = useState<MinimapStatus>({ kind: "loading" });
  const chunkCache = useRef(new ChunkCache(4));
  const chunkInFlight = useRef<string | null>(null);
  /* The event review: every current candidate on the footage, the one in the
     inspector, and the type the next proposal at the playhead will carry. */
  const [eventCandidates, setEventCandidates] = useState<VisionEventCandidate[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(params.get("event"));
  const [eventType, setEventType] = useState<string>("shot");
  /* Where a link lands: `?event=` from the Events page or a colleague, `?track=&at=`
     from the review queue. The seek waits until the video can take it, once. */
  /* Where the last `,` `.` walk landed, so a clip that cannot reach the item does not trap the walk on it. */
  const walked = useRef<{ proxyMs: number; sourceMs: number } | null>(null);
  /* The same for `[` and `]`. */
  const walkedEvents = useRef<{ proxyMs: number; sourceMs: number } | null>(null);
  /* The API answers with the latest track run. A link from the review queue can name a
     track of an earlier run; then every run is asked for, once, and the page says so. */
  const [allRuns, setAllRuns] = useState(false);
  const allRunsRef = useRef(false);
  const landing = useRef<{ trackId: string | null; eventId: string | null; at: number | null }>({
    trackId: params.get("track"),
    eventId: params.get("event"),
    at: params.get("at") !== null && Number.isFinite(Number(params.get("at"))) ? Number(params.get("at")) : null,
  });

  /* The review rows reload after every action; the media does not, or the video
     element would take a fresh URL and jump back to the start each time. */
  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await fetchVisionIdentityReview(assetId, false, allRunsRef.current ? "all" : undefined);
      setReview(r);
      setSlotNames((prev) => {
        const next = new Map(prev);
        for (const t of r.tracks) for (const a of t.identities) if (a.matchSquadPlayerId && a.slot) next.set(a.matchSquadPlayerId, `#${a.slot.jerseyNumber ?? "—"} ${a.slot.name}`);
        return next;
      });
      const decided = Object.fromEntries(r.sidesDecided.map((s) => [s.team, s.sbTeamId]));
      setSideA(decided.A ?? "");
      setSideB(decided.B ?? "");
      const events = await fetchVisionEventCandidates(assetId);
      setEventCandidates(events.candidates);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [assetId]);

  useEffect(() => {
    void load();
    fetchVisionReviewMedia(assetId)
      .then(setMedia)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    fetchVisionGameState(assetId)
      .then((g) => {
        setGameState(g);
        if (!g.job) setChunkStatus({ kind: "none" });
      })
      .catch((e) => setChunkStatus({ kind: "blocked", message: e instanceof Error ? e.message : String(e) }));
  }, [assetId, load]);

  /* Every track's positions for the latest track run, in one request. It was one request
     per track, in sequence, for up to two thousand tracks, started again after every
     action because it depended on the review rows; on a real match the boxes might
     never arrive (docs/vision/50, appendix D). */
  useEffect(() => {
    let cancelled = false;
    fetchVisionAssetPositions(assetId)
      .then((r) => {
        if (cancelled) return;
        setPositions(new Map(Object.entries(r.positions).map(([id, p]) => [id, sortPositions(p)])));
        setTrackRun({ jobId: r.trackJobId, runs: r.trackJobs });
      })
      .catch((e) => {
        if (!cancelled) setError(`The boxes could not be read: ${e instanceof Error ? e.message : String(e)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [assetId]);

  /* The tracks of the latest run. After a re-run the footage has two sets of tracks for
     the same players; showing both put two boxes on everyone and listed every player twice. */
  const tracks = useMemo(() => {
    if (!review) return [];
    if (allRuns) return review.tracks;
    return trackRun.jobId ? review.tracks.filter((t) => t.inferenceJobId === trackRun.jobId) : review.tracks;
  }, [allRuns, review, trackRun]);
  const selected = useMemo(() => review?.tracks.find((t) => t.id === selectedId) ?? null, [review, selectedId]);
  /* What a second person has to decide here: the review queue for this asset, walked with `,` and `.`. */
  const uncertain = useMemo(() => uncertainties(eventCandidates, tracks, me, reviewOrder), [eventCandidates, me, tracks, reviewOrder]);

  /* Keyed on which track, not on its row: the rows reload after every action, and that
     used to clear the search and the chosen candidate in the middle of a run of work. */
  useEffect(() => {
    setSlotId(null);
    setOverrule(false);
    setPropagateTo(new Set());
    setQuery("");
    setRejectReason("");
    setNote("");
  }, [selectedId]);

  /* The roster: this side's, or the whole match's when the reviewer says the kit
     was read wrongly and needs the other squad in front of them. An answer for a
     track that is no longer the selected one is dropped. */
  useEffect(() => {
    setCandidates(null);
    if (!selectedId) return;
    let cancelled = false;
    void fetchVisionTrackCandidates(selectedId, overrule)
      .then((c) => {
        if (cancelled) return;
        setCandidates(c);
        setSlotNames((prev) => {
          const next = new Map(prev);
          for (const cand of c.candidates) next.set(cand.matchSquadPlayerId, `#${cand.jerseyNumber ?? "—"} ${cand.name}`);
          return next;
        });
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [overrule, selectedId]);

  const offsetMs = media?.sourceOffsetMs ?? review?.proxy?.sourceOffsetMs ?? 0;
  /* A proxy whose probe recorded no duration left the scrubber with nowhere to go. */
  const clipEndMs = media?.durationMs ?? videoMs;
  const clipWindow = useMemo(() => ({ windowStartMs: 0, windowEndMs: clipEndMs, fps: media?.fps ?? null }), [clipEndMs, media]);
  const sourceMs = proxyMs + offsetMs;
  /* The time anything written at the playhead is stored at: the start of the frame being
     shown, a whole millisecond, not wherever inside the frame the scrubber stopped. */
  const atMs = snapSourceTimeMs(proxyMs, media?.fps ?? null, offsetMs);

  /* The chunk under the playhead: from the cache when scrubbing within a minute,
     otherwise one GET to the bucket. A chunk the bucket refuses is reported once,
     in words, and the map stays empty rather than guessing. */
  useEffect(() => {
    if (!gameState?.job) return;
    const ref = chunkCovering(gameState.chunks, sourceMs);
    if (!ref) {
      setChunk(null);
      setChunkStatus({ kind: "gap" });
      return;
    }
    const cached = chunkCache.current.get(ref.key);
    if (cached) {
      setChunk(cached);
      setChunkStatus({ kind: "ready" });
      return;
    }
    if (chunkInFlight.current === ref.key) return;
    chunkInFlight.current = ref.key;
    setChunkStatus({ kind: "loading" });
    loadChunk(ref)
      .then((decoded) => {
        chunkCache.current.put(decoded);
        if (chunkInFlight.current !== ref.key) return;
        setChunk(decoded);
        setChunkStatus({ kind: "ready" });
      })
      .catch((e) => {
        if (chunkInFlight.current !== ref.key) return;
        setChunk(null);
        setChunkStatus({ kind: "blocked", message: explainChunkFailure(e) });
      })
      .finally(() => {
        if (chunkInFlight.current === ref.key) chunkInFlight.current = null;
      });
  }, [gameState, sourceMs]);

  const rowsHere = useMemo(() => {
    const frame = frameIndexAt(proxyMs, media?.fps ?? null);
    return frame === null ? rowsNear(chunk, sourceMs) : rowsOnFrame(chunk, frame);
  }, [chunk, media, proxyMs, sourceMs]);
  const tracksByLocalId = useMemo(() => {
    const out = new Map<number, VisionReviewTrack>();
    if (!review) return out;
    for (const t of review.tracks) if (!gameState?.trackJobId || t.inferenceJobId === gameState.trackJobId) out.set(t.localTrackId, t);
    return out;
  }, [gameState, review]);
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
  const land = useCallback(() => {
    const l = landing.current;
    if (!l.trackId && !l.eventId && l.at === null) return;
    const el = videoRef.current;
    if (!el || el.readyState < 1) return;
    let at = l.at;
    if (l.eventId) {
      const c = eventCandidates.find((x) => x.id === l.eventId);
      if (!c) return;
      at = at ?? c.startMs;
    }
    if (l.trackId) {
      const t = review?.tracks.find((x) => x.id === l.trackId);
      if (!t) {
        /* Not in the latest run: the link is to a track of an earlier one. Ask for every
           run, once; the landing stays pending and is taken when the rows arrive. */
        if (review && !allRunsRef.current && review.trackJobs > 1) {
          allRunsRef.current = true;
          setAllRuns(true);
          void load();
        }
        return;
      }
      setSelectedId(t.id);
      at = at ?? t.startMs;
    }
    landing.current = { trackId: null, eventId: null, at: null };
    if (at !== null) seekTo(at - offsetMs);
  }, [eventCandidates, load, offsetMs, review, seekTo]);
  useEffect(() => {
    land();
  }, [land, media]);
  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  }, []);

  /* The video element exists only once the review rows and the media have both arrived.
     Keyed on the media alone, this ran before the element was there when the media came
     first, and never again: the playhead and the boxes stood still while the video played. */
  const ready = Boolean(review && media);
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !ready) return;
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
  }, [ready]);

  const refreshMedia = useCallback(() => {
    const now = Date.now();
    if (now - refreshedAt.current < 15_000) {
      setError("The video could not be played. Reload the page to try again.");
      return;
    }
    refreshedAt.current = now;
    resumeAt.current = (videoRef.current?.currentTime ?? 0) * 1000;
    fetchVisionReviewMedia(assetId)
      .then((next) => {
        if (next.url === media?.url) setError("The video could not be played. Reload the page to try again.");
        setMedia(next);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [assetId, media]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const shortcut = shortcutOf({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        repeat: event.repeat,
        target: event.target as HTMLElement | null,
      });
      if (!shortcut) return;
      event.preventDefault();
      onShortcut.current(shortcut);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** Every track with a position on this frame, as a percentage box. */
  const boxesHere = useMemo(() => {
    if (!review) return [];
    const width = media?.width ?? review.proxy?.width ?? null;
    const height = media?.height ?? review.proxy?.height ?? null;
    const out: { track: VisionReviewTrack; rect: { x: number; y: number; width: number; height: number } }[] = [];
    for (const track of tracks) {
      const p = positionAt(positions.get(track.id) ?? [], proxyMs, media?.fps ?? null);
      if (!p) continue;
      const rect = toPercentBox(p.box, width, height);
      if (rect) out.push({ track, rect });
    }
    return out;
  }, [media, positions, proxyMs, review, tracks]);

  const picture = usePictureRect(stageRef, { width: media?.width ?? review?.proxy?.width ?? 0, height: media?.height ?? review?.proxy?.height ?? 0 }, Boolean(review && media));
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
    if (!selected || busy) return;
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

  const split = selected ? splitAt(selected, atMs) : null;

  /* Events: the candidate under the playhead is shown when none is chosen; a
     proposal at the playhead takes the selected track as the actor and the slot
     it was said to be at that moment. The URL carries the chosen candidate so
     the Events page can hand one over. */
  const trackLabel = useCallback(
    (trackId: string | null) => {
      const t = trackId ? review?.tracks.find((x) => x.id === trackId) : null;
      if (!t) return null;
      const who = identitySummary(t, nameOfSlot);
      return who === "nobody has said" ? `#${t.localTrackId}` : `#${t.localTrackId} ${who}`;
    },
    [nameOfSlot, review]
  );
  const selectedEvent = useMemo(() => eventCandidates.find((c) => c.id === selectedEventId) ?? candidateAt(eventCandidates, sourceMs), [eventCandidates, selectedEventId, sourceMs]);
  const canReviewEvents = hasPermission("vision.review");
  const canPublishEvents = hasPermission("vision.publish");
  const pickEvent = (c: VisionEventCandidate) => {
    setSelectedEventId(c.id);
    rankedCursor.current = `event:${c.id}`;
    setParams({ event: c.id, order: reviewOrder }, { replace: true });
    seekTo(c.startMs - offsetMs);
  };
  function proposeHere() {
    /* `busy`: the button was disabled while a request ran and the key was not, so E twice filed two. */
    if (!canReviewEvents || busy) return;
    const at = atMs;
    const who = proposalAt(selected, at);
    void run(`${eventType.replace(/_/g, " ")} proposed at ${formatClock(at)}${who.actorTrackId ? ` for track #${selected?.localTrackId}` : ""}; a second person decides.`, async () => {
      const created = await proposeVisionEvent({ videoAssetId: assetId, type: eventType, startMs: at, endMs: at, actorTrackId: who.actorTrackId ?? undefined, actorMatchSquadPlayerId: who.actorMatchSquadPlayerId ?? undefined });
      setSelectedEventId(created.id);
    });
  }
  function correctEvent(changes: { type?: string; startMs?: number; endMs?: number; actor?: boolean; note?: string }, label: string, candidate = selectedEvent) {
    if (!candidate || busy || !allowedActions(candidate, me, { review: canReviewEvents, publish: canPublishEvents }).correct) return;
    const body: Parameters<typeof correctVisionEvent>[1] = { type: changes.type, startMs: changes.startMs, endMs: changes.endMs, note: changes.note };
    if (changes.actor) {
      const who = proposalAt(selected, candidate.startMs);
      body.actorTrackId = who.actorTrackId;
      body.actorMatchSquadPlayerId = who.actorMatchSquadPlayerId;
    }
    void run(`${label} A new row supersedes the old; review starts again.`, async () => {
      const created = await correctVisionEvent(candidate.id, body);
      setSelectedEventId(created.id);
    });
  }

  /** What `A` and `R` act on: the chosen event, else the selected track's waiting identity, else the event under the playhead. */
  function decisionTarget(): { event: VisionEventCandidate } | { identityId: string } | { problem: string } {
    const chosen = selectedEventId ? (eventCandidates.find((c) => c.id === selectedEventId && !c.supersededBy) ?? null) : null;
    const waiting = selected ? selected.identities.filter((a) => a.supersededBy === null && mayAccept(a, me)) : [];
    const event = chosen ?? (waiting.length ? null : selectedEvent);
    if (event) return { event };
    if (!selected || !waiting.length) return { problem: "Nothing selected is waiting for you to decide." };
    const here = waiting.filter((a) => a.validFromMs <= sourceMs && a.validToMs >= sourceMs);
    const one = here.length === 1 ? here[0] : waiting.length === 1 ? waiting[0] : null;
    if (!one) return { problem: `${waiting.length} windows on track #${selected.localTrackId} are waiting; put the playhead inside one.` };
    return { identityId: one.id };
  }
  function decide(decision: "accepted" | "rejected") {
    if (busy) return;
    const target = decisionTarget();
    if ("problem" in target) {
      setNotice(target.problem);
      return;
    }
    if ("event" in target) {
      const allowed = allowedActions(target.event, me, { review: canReviewEvents, publish: canPublishEvents });
      if (!allowed.accept) {
        setNotice(allowed.yours ? "That event is yours; a second person decides it." : "That event is not waiting for a decision.");
        return;
      }
      if (decision === "accepted") {
        void run("Event accepted.", () => decideVisionEvent(target.event.id, "accepted"));
        return;
      }
      const box = document.querySelector<HTMLInputElement>('[data-reject-reason="event"]');
      const why = box?.value.trim() ?? "";
      if (why.length < 3) {
        box?.focus();
        setNotice("Say why it is wrong, then Reject.");
        return;
      }
      void run("Event rejected.", () => decideVisionEvent(target.event.id, "rejected", why));
      return;
    }
    if (decision === "accepted") {
      void run("Accepted.", () => acceptVisionIdentity(target.identityId));
      return;
    }
    const why = rejectReason.trim();
    if (why.length < 3) {
      rejectReasonRef.current?.focus();
      setNotice("Say why it is wrong, then Reject.");
      return;
    }
    void run("Rejected.", () => rejectVisionIdentity(target.identityId, why));
  }

  /* From the playhead, unless the last walk landed where the clip could not take the
     playhead (a proxy shorter than its source) and it has not moved since: then from
     the item walked to, so the walk goes on instead of returning to it. */
  const walkFrom = (last: typeof walked) => (last.current !== null && Math.abs(last.current.proxyMs - proxyMs) < 100 ? last.current.sourceMs : sourceMs);
  const walkTo = (last: typeof walked, toSourceMs: number) => {
    const target = toSourceMs - offsetMs;
    seekTo(target);
    last.current = { proxyMs: Math.min(Math.max(target, 0), clipEndMs || target), sourceMs: toSourceMs };
  };

  onShortcut.current = (shortcut) => {
    switch (shortcut.kind) {
      case "play":
        togglePlay();
        return;
      case "step":
        step(shortcut.unit === "second" ? shortcut.frames * Math.round(media?.fps ?? 10) : shortcut.frames);
        return;
      case "walkEvents": {
        const next = stepCandidate(eventCandidates, walkFrom(walkedEvents), shortcut.direction);
        if (!next) return;
        setSelectedEventId(next.id);
        walkTo(walkedEvents, next.startMs);
        return;
      }
      case "walkUncertain": {
        const next = stepRankedReview(uncertain, rankedCursor.current, shortcut.direction);
        if (!next) { setNotice("End of the loaded review queue."); return; }
        rankedCursor.current = `${next.kind}:${next.id}`;
        if (next.kind === "event") {
          setSelectedEventId(next.id);
        } else if (next.trackId) {
          setSelectedId(next.trackId);
          setSelectedEventId(null);
        }
        walkTo(walked, next.sourceMs);
        return;
      }
      case "propose":
        proposeHere();
        return;
      case "unknown":
        if (!selected) setNotice("Select a track first; U marks it unknown.");
        else assign(null, null);
        return;
      case "pick": {
        const c = shownCandidates[shortcut.index];
        if (!selected) setNotice("Select a track first; a number assigns it to that candidate.");
        else if (c) {
          setSlotId(c.matchSquadPlayerId);
          assign(null, c.matchSquadPlayerId);
        }
        return;
      }
      case "accept":
        decide("accepted");
        return;
      case "reject":
        decide("rejected");
        return;
      case "merge": {
        const el = mergeRef.current;
        if (!el) {
          setNotice("Select a track first; M opens Merge for it.");
          return;
        }
        el.open = true;
        el.scrollIntoView({ block: "nearest" });
        el.querySelector<HTMLInputElement>("input")?.focus();
        return;
      }
      case "split":
        if (!selected) setNotice("Select a track first.");
        else if (!slotId) setNotice("Choose a candidate first; S gives them the track up to the playhead.");
        else if (!split) setNotice("The playhead is not inside this track, so there is nothing to split.");
        else assign(split.before, slotId);
        return;
      case "help":
        setShowHelp((shown) => !shown);
        return;
      default:
    }
  };

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
        <span>{tracks.length} track(s)</span>
        {trackRun.runs > 1 && <span className="vision-pill vision-pill--warn">{allRuns ? `every one of ${trackRun.runs} track runs; boxes are the latest run's` : `the latest of ${trackRun.runs} track runs`}</span>}
        {review.truncated && <span className="vision-pill vision-pill--warn">the first {review.count} of {review.total} tracks</span>}
        <span className="vision-filters__grow" />
        <ReviewOrderControl order={reviewOrder} onChange={(value) => {
          rankedCursor.current = null;
          setParams((previous) => { const next = new URLSearchParams(previous); next.set("order", value); return next; }, { replace: true });
        }} />
        <button type="button" aria-expanded={showHelp} onClick={() => setShowHelp((shown) => !shown)} title="?">
          Keys
        </button>
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
      {showHelp && (
        <section className="vision-panel" aria-label="Keyboard shortcuts">
          <h3 className="vision-panel__title">Keys</h3>
          <dl className="vision-keys">
            {SHORTCUT_HELP.map((h) => (
              <div key={h.keys}>
                <dt>
                  <kbd>{h.keys}</kbd>
                </dt>
                <dd>{h.does}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {publicPreview && (
        <p className="vision-panel">
          Public: {publicPreview.count} track(s) with an accepted, named identity;{" "}
          {publicPreview.tracks.flatMap((t) => t.identities).filter(isPublic).length} window(s). Everything else stays in this room.
        </p>
      )}

      <div className="vision-workstation__body">
        <div className="vision-workstation__video">
          <div ref={stageRef} className={`vision-stage vision-stage--review${playing ? " vision-stage--playing" : ""}`}>
            <video
              ref={videoRef}
              src={media.url}
              preload="auto"
              onLoadedMetadata={(event) => {
                const seconds = event.currentTarget.duration;
                if (Number.isFinite(seconds)) setVideoMs(seconds * 1000);
                const resume = resumeAt.current;
                resumeAt.current = null;
                seekTo(resume ?? 0);
                if (resume === null) land();
              }}
              onError={refreshMedia}
              onPause={() => setPlaying(false)}
              onPlay={() => setPlaying(true)}
            />
            <div className="vision-picture" style={{ left: picture.x, top: picture.y, width: picture.width, height: picture.height }}>
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
                onKeyDown={(event) => {
                  /* It says it is a button and takes focus, so it answers to the keys a button does. */
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
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
            <div>
              <span className="vision-clocks__label">Match clock</span>
              <strong className="vision-mono">{describeClock(review.clock.anchors, sourceMs)}</strong>
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
            play/pause · ← → one frame · Shift + ← → one second · click a box to select its track · U unknown · 1–9 assign · ? every key
          </p>

          <VisionEventTimeline
            candidates={eventCandidates}
            offsetMs={offsetMs}
            clipMs={clipEndMs}
            proxyMs={proxyMs}
            selectedId={selectedEvent?.id ?? null}
            describe={(c) => describeCandidate(c, trackLabel)}
            onPick={pickEvent}
            fps={media.fps}
            sourceDurationMs={media.sourceDurationMs}
            canCorrect={(c) => !busy && allowedActions(c, me, { review: canReviewEvents, publish: canPublishEvents }).correct}
            onCorrect={(c, window) => correctEvent(window, `Window moved to ${formatClock(window.startMs)}–${formatClock(window.endMs)}.`, c)}
          />

          <VisionMinimap
            state={gameState}
            status={chunkStatus}
            rows={rowsHere}
            tracksByLocalId={tracksByLocalId}
            selectedId={selectedId}
            onSelect={setSelectedId}
            labelOf={(track, row) => {
              if (!track) return `#${row.localTrackId}`;
              const who = identitySummary(track, nameOfSlot);
              return who === "nobody has said" ? `#${track.localTrackId}` : who;
            }}
          />
        </div>

        <div className="vision-workstation__side">
          {canReviewEvents && (
            <section className="vision-panel">
              <h3 className="vision-panel__title">Events</h3>
              <div className="vision-inline">
                <select value={eventType} onChange={(e) => setEventType(e.target.value)} aria-label="Event type to propose">
                  {EVENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
                <button type="button" disabled={busy} onClick={proposeHere} title="E">
                  Propose at {formatClock(sourceMs)}
                </button>
              </div>
              <p className="vision-footnote">
                {selected ? `Actor: track #${selected.localTrackId}${proposalAt(selected, sourceMs).actorMatchSquadPlayerId ? ", the player it was said to be" : ", nobody named yet"}.` : "Select a track first to name the actor."}{" "}
                {eventCandidates.filter((c) => !c.supersededBy).length} candidate(s) on this footage; {uncertain.length} loaded identity window(s) and candidate(s) for you to decide (<kbd>,</kbd> <kbd>.</kbd> walk them {reviewOrder === "confidence" ? "by lowest stored confidence" : "oldest first"}). Confidence is a claim score, not measured accuracy.
              </p>
            </section>
          )}

          {selectedEvent && (
            <VisionEventInspector
              key={selectedEvent.id}
              candidate={selectedEvent}
              me={me}
              can={{ review: canReviewEvents, publish: canPublishEvents }}
              sourceMs={atMs}
              selectedTrackLabel={selected ? (trackLabel(selected.id) ?? `#${selected.localTrackId}`) : null}
              trackLabel={trackLabel}
              busy={busy}
              onCorrect={correctEvent}
              onDecide={(decision, reason) => void run(decision === "accepted" ? "Event accepted." : "Event rejected.", () => decideVisionEvent(selectedEvent.id, decision, reason))}
              onPromote={(create) => void run(create ? "Added to the match record." : "Promoted into the match record.", () => promoteVisionEvent(selectedEvent.id, create))}
              onClose={() => {
                setSelectedEventId(null);
                setParams({}, { replace: true });
              }}
            />
          )}

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
                {(() => {
                  /* Sides already decided, and a different answer chosen: every identity on this job
                     was checked against the old one, so the API refuses the change unless it is
                     asked for on purpose. The button says which it is. */
                  const decided = Object.fromEntries(review.sidesDecided.map((s) => [s.team, s.sbTeamId]));
                  const changing = review.sidesDecided.length > 0 && (decided.A !== sideA || decided.B !== sideB);
                  return (
                    <>
                      <button
                        type="button"
                        disabled={busy || !sideA || !sideB || sideA === sideB}
                        onClick={() => void run(changing ? "Sides changed." : "Sides decided.", () => setVisionTeamSides(identifyJob, { A: sideA, B: sideB, ...(changing ? { override: true } : {}) }))}
                      >
                        {changing ? "Change sides" : "Decide sides"}
                      </button>
                      {changing && <span className="vision-footnote"> This replaces a decision already made; identities on this job were checked against it.</span>}
                    </>
                  );
                })()}
                {sideA && sideA === sideB && <span className="vision-footnote"> One team each.</span>}
              </>
            )}
          </section>

          <section className="vision-panel">
            <h3 className="vision-panel__title">Tracks</h3>
            <ul className="vision-tracklist">
              {tracks.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className={`vision-tracklist__row${t.id === selectedId ? " is-selected" : ""}`}
                    onClick={() => setSelectedId(t.id)}
                  >
                    <span className="vision-mono">#{t.localTrackId}</span> <span>{t.class}</span>{" "}
                    <span className="vision-sub">{formatSeconds(t.startMs)}–{formatSeconds(t.endMs)}{t.matchClock ? ` · ${t.matchClock}` : ""}</span>
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
                  ref={rejectReasonRef}
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
                    {candidates.window ? `On the pitch ${candidates.window.display}; ${candidates.window.offPitch} left out by ${candidates.window.substitutions} substitution(s).` : candidates.clock}
                  </p>
                  <input
                    type="search"
                    placeholder="Number or name"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Find a candidate"
                  />
                  <ul className="vision-candidates" role="radiogroup" aria-label="Who this track is">
                    {shownCandidates.map((c, index) => (
                      <li key={c.matchSquadPlayerId}>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={slotId === c.matchSquadPlayerId}
                          className={`vision-candidates__pick${slotId === c.matchSquadPlayerId ? " is-active" : ""}`}
                          onClick={() => setSlotId(c.matchSquadPlayerId)}
                        >
                          {index < 9 && <kbd className="vision-candidates__key">{index + 1}</kbd>}
                          {candidateLabel(c)}
                          {c.onPitch === "partly" && <span className="vision-sub"> · partly on</span>}
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

              <details ref={mergeRef}>
                <summary>Merge: this is the same person on other tracks ({propagateTo.size})</summary>
                <ul className="vision-candidates">
                  {tracks
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
                <button type="button" disabled={busy} onClick={() => assign(null, null)} title="U">
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
