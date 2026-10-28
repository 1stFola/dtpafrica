import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DtpLogo } from "@dtp/ui";
import {
  ApiError, get, patch, post,
  type CalibrationRow, type Health, type Incident, type IncidentWindows, type MatchSession, type Me,
  type SessionDetail, type SourceView, type SourceWindow, type SyncTest,
} from "./api";
import { ShadowBanner } from "./Banner";
import { LivePlayer, type LiveState } from "./hls";
import { actionFor, nextSpeed, SHORTCUTS, type Action } from "./keys";
import { loadWindow, measureSlowRate, report, warningsFor } from "./replay";
import { clockLabel, edgeToIngest, matchClock, parseTypedTime, PERIOD_OFFSET_MIN, positionEdgeMs, signedMs, toIso, toMs } from "./time";

const REPLAY_WINDOW_MS = 40_000;
const LIVE_SAFETY_MS = 1_500; // the newest second is still being written
const CATEGORIES = ["goal", "penalty", "offside", "foul", "handball", "card", "goalkeeper", "other"];
const CAL_METHODS = ["marker", "whistle", "ball_strike", "clapper"];

type Replay = {
  source: string;
  startIngestMs: number;
  durationMs: number;
  offsetMs: number;
  uncertaintyMs: number;
  flags: string[];
  eventAtMs: number | null;
  incidentId: string | null;
  status: "idle" | "loading" | "ready" | "error";
  error?: string;
  toPlayableMs?: number | null;
};

const can = (me: Me, permission: string) => me.kind === "device" || me.permissions.includes(permission);

export function Console({ me, onSignedOut }: { me: Me; onSignedOut: () => void }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [sources, setSources] = useState<SourceView[]>([]);
  const [sessions, setSessions] = useState<MatchSession[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [windows, setWindows] = useState<IncidentWindows | null>(null);
  const [liveSource, setLiveSource] = useState("ground");
  const [live, setLive] = useState<LiveState>({ status: "connecting", behindMs: null });
  const [replay, setReplay] = useState<Replay | null>(null);
  const [positionMs, setPositionMs] = useState<number | null>(null);
  const [speed, setSpeed] = useState(1);
  const [quarter, setQuarter] = useState<{ supported: boolean; advancedS: number | null } | null>(null);
  const [skewMs, setSkewMs] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const [reference, setReference] = useState<{ edgeMs: number; label: string } | null>(null);
  const [uncertainty, setUncertainty] = useState(80);
  const [method, setMethod] = useState("marker");
  const [sync, setSync] = useState<SyncTest | null>(null);
  const [goTo, setGoTo] = useState("");
  const [posS, setPosS] = useState(0);

  const liveVideo = useRef<HTMLVideoElement>(null);
  const replayVideo = useRef<HTMLVideoElement>(null);
  const livePlayer = useRef<LivePlayer | null>(null);
  const liveRegion = useRef<HTMLDivElement>(null);

  const edgeNow = useCallback(() => Date.now() + skewMs, [skewMs]);
  const say = useCallback((text: string) => setMessage(text), []);

  // ── polling ───────────────────────────────────────────────────────────
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const sent = Date.now();
        const h = await get<Health>("/edge/v1/health");
        // The console counts on the Edge's clock, never this laptop's.
        setSkewMs(toMs(h.clock.edgeUtc) - (sent + Date.now()) / 2);
        if (!stop) {
          setHealth(h);
          setSources(await get<SourceView[]>("/edge/v1/sources"));
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) onSignedOut();
      }
    };
    void tick();
    const id = window.setInterval(tick, 2000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [onSignedOut]);

  const refreshSession = useCallback(async () => {
    const list = await get<MatchSession[]>("/edge/v1/sessions");
    setSessions(list);
    const current = sessionId ?? list.find((s) => !s.ended_utc)?.id ?? null;
    if (current !== sessionId) setSessionId(current);
    if (current) {
      setDetail(await get<SessionDetail>(`/edge/v1/sessions/${current}`));
      setIncidents(await get<Incident[]>(`/edge/v1/incidents?sessionId=${current}`));
    }
  }, [sessionId]);

  useEffect(() => {
    void refreshSession().catch(() => undefined);
    const id = window.setInterval(() => void refreshSession().catch(() => undefined), 5000);
    return () => window.clearInterval(id);
  }, [refreshSession]);

  // ── live preview ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!liveVideo.current) return;
    livePlayer.current?.stop();
    const player = new LivePlayer(liveVideo.current, setLive, edgeNow);
    livePlayer.current = player;
    void player.start(liveSource);
    return () => player.stop();
    // edgeNow changes every poll; restarting the stream for that would be wrong.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSource]);

  // ── replay ────────────────────────────────────────────────────────────
  const calibrationFor = useCallback(
    (source: string): CalibrationRow | undefined => detail?.calibration.find((c) => c.source === source),
    [detail],
  );

  const load = useCallback(async (next: Omit<Replay, "status">, note: string) => {
    const video = replayVideo.current;
    if (!video) return;
    setReplay({ ...next, status: "loading" });
    const result = await loadWindow(video, next.source, next.startIngestMs, next.durationMs);
    void report(next.source, toIso(next.startIngestMs), next.durationMs, result, note);
    if (result.ok) {
      video.playbackRate = speed;
      setReplay({ ...next, status: "ready", toPlayableMs: result.toPlayableMs });
      void video.play().catch(() => undefined);
      if (quarter === null) void measureSlowRate(video.src).then(setQuarter);
    } else {
      setReplay({ ...next, status: "error", error: result.error });
    }
  }, [speed, quarter]);

  /** Free replay: the moment `edgeMs` on `source`, with that source's own calibration applied. */
  const replayAt = useCallback(async (source: string, edgeMs: number, note: string) => {
    const cal = calibrationFor(source);
    const offset = cal?.offsetMs ?? 0;
    const unc = cal?.uncertaintyMs ?? 2000;
    const startIngest = edgeToIngest(edgeMs, offset);
    const latest = edgeToIngest(edgeNow(), offset) - LIVE_SAFETY_MS;
    const duration = Math.max(2000, Math.min(REPLAY_WINDOW_MS, latest - startIngest));
    let flags = [...(cal?.flags ?? ["uncalibrated"])];
    try {
      const w = await get<{ coverage: string }>(`/edge/v1/sources/${source}/window?start=${encodeURIComponent(toIso(startIngest))}&durationMs=${Math.round(duration)}`);
      if (w.coverage === "none") flags = ["no_footage", ...flags];
      else if (w.coverage === "partial") flags = ["gap", ...flags];
    } catch {
      /* coverage unknown; the player itself will say if nothing loads */
    }
    await load({ source, startIngestMs: startIngest, durationMs: duration, offsetMs: offset, uncertaintyMs: unc, flags,
                 eventAtMs: null, incidentId: null }, note);
  }, [calibrationFor, edgeNow, load]);

  const openIncident = useCallback(async (incidentId: string, source?: string) => {
    setSelected(incidentId);
    const w = await get<IncidentWindows>(`/edge/v1/incidents/${incidentId}/windows`);
    setWindows(w);
    const chosen = source ?? replay?.source ?? "ground";
    const win: SourceWindow | undefined = w.perSource.find((s) => s.source === chosen) ?? w.perSource[0];
    if (!win) return;
    await load({ source: win.source, startIngestMs: toMs(win.startIngestUtc), durationMs: win.durationMs,
                 offsetMs: win.offsetMs, uncertaintyMs: win.uncertaintyMs, flags: win.flags, eventAtMs: win.eventAtMs,
                 incidentId }, "incident");
  }, [load, replay?.source]);

  const currentEdge = useCallback((): number | null => {
    const video = replayVideo.current;
    if (!replay || !video || replay.status !== "ready") return null;
    return positionEdgeMs(replay.startIngestMs, video.currentTime, replay.offsetMs);
  }, [replay]);

  useEffect(() => {
    const video = replayVideo.current;
    if (!video) return;
    const update = () => {
      setPositionMs(currentEdge());
      setPosS(video.currentTime);
    };
    video.addEventListener("timeupdate", update);
    return () => video.removeEventListener("timeupdate", update);
  }, [currentEdge]);

  const switchSource = useCallback(async (source: string) => {
    if (!sources.find((s) => s.name === source)) return;
    if (replay?.incidentId) return openIncident(replay.incidentId, source);
    const at = currentEdge() ?? edgeNow() - 30_000;
    return replayAt(source, at, "switch source");
  }, [currentEdge, edgeNow, openIncident, replay?.incidentId, replayAt, sources]);

  const back = useCallback((seconds: number) => {
    const from = currentEdge() ?? edgeNow() - LIVE_SAFETY_MS;
    return replayAt(replay?.source ?? liveSource, from - seconds * 1000, `back ${seconds}s`);
  }, [currentEdge, edgeNow, liveSource, replay?.source, replayAt]);

  /** Step the paused replay by a tenth of a second: about, not exactly, a few frames. */
  const nudge = useCallback((seconds: number) => {
    const video = replayVideo.current;
    if (!video || !replay || replay.status !== "ready") return;
    video.pause();
    video.currentTime = Math.min(Math.max(0, video.currentTime + seconds), Math.max(0, (video.duration || 0) - 0.04));
  }, [replay]);

  const goToTyped = useCallback(() => {
    const ms = parseTypedTime(goTo, edgeNow());
    if (ms === null) return say("Type a UTC time such as 23:55:00 or a full ISO instant.");
    void replayAt(replay?.source ?? liveSource, ms - 5000, `go to ${goTo}`);
  }, [edgeNow, goTo, liveSource, replay?.source, replayAt, say]);

  const togglePlay = useCallback(() => {
    const video = replayVideo.current;
    if (!video || !replay) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  }, [replay]);

  const cycleSpeed = useCallback(() => {
    const next = nextSpeed(speed, Boolean(quarter?.supported));
    setSpeed(next);
    if (replayVideo.current) replayVideo.current.playbackRate = next;
  }, [quarter?.supported, speed]);

  const goLive = useCallback(() => {
    replayVideo.current?.pause();
    liveRegion.current?.scrollIntoView({ block: "nearest" });
    liveRegion.current?.focus();
    say("Back to live. The replay and its incident are kept.");
  }, [say]);

  // ── incidents, periods, calibration ───────────────────────────────────
  const flag = useCallback(async () => {
    if (!sessionId) return say("Create or choose a session first.");
    try {
      const inc = await post<Incident>("/edge/v1/incidents", { sessionId, category: "other" });
      say(`Incident flagged at ≈ ${clockLabel(toMs(inc.event_utc))} UTC.`);
      await refreshSession();
      setSelected(inc.id);
    } catch (err) {
      say(err instanceof ApiError ? err.message : "could not flag the incident");
    }
  }, [refreshSession, say, sessionId]);

  /** An incident at the moment on screen in the replay, for something seen after the fact. */
  const flagAtReplay = useCallback(async () => {
    const at = currentEdge();
    if (!sessionId || at === null) return say("Load a replay and pause on the moment first.");
    try {
      const inc = await post<Incident>("/edge/v1/incidents", { sessionId, eventUtc: toIso(at), basis: "manual", category: "other" });
      say(`Incident flagged at the replay position ≈ ${clockLabel(at)} UTC.`);
      await refreshSession();
      setSelected(inc.id);
    } catch (err) {
      say(err instanceof ApiError ? err.message : "could not flag the incident");
    }
  }, [currentEdge, refreshSession, say, sessionId]);

  const latestIncident = useCallback(() => {
    if (incidents[0]) void openIncident(incidents[0].id);
  }, [incidents, openIncident]);

  const markPeriod = async (period: string, edge: "start" | "end") => {
    if (!sessionId) return;
    try {
      await post(`/edge/v1/sessions/${sessionId}/periods`, { period, edge });
      say(`Period ${period} ${edge} marked at ≈ ${clockLabel(edgeNow())} UTC.`);
      await refreshSession();
    } catch (err) {
      say(err instanceof ApiError ? err.message : "could not mark the period");
    }
  };

  const setReferenceHere = () => {
    const at = currentEdge();
    if (at === null || !replay) return say("Load a replay and pause on the reference event first.");
    setReference({ edgeMs: at, label: `${replay.source} at ≈ ${clockLabel(at)}` });
    say(`Reference event set from ${replay.source}. Now find the same event on another source.`);
  };

  const useKickoffAsReference = () => {
    const start = detail?.periods.filter((p) => p.edge === "start").at(-1);
    if (!start) return say("Mark a period start first.");
    setReference({ edgeMs: toMs(start.edge_utc), label: `period ${start.period} start mark` });
  };

  const sameEventHere = async () => {
    const video = replayVideo.current;
    if (!reference || !replay || !video || !sessionId) return say("Set a reference event first.");
    const observedIngest = replay.startIngestMs + video.currentTime * 1000;
    try {
      await post(`/edge/v1/sessions/${sessionId}/calibrations`, {
        source: replay.source, referenceUtc: toIso(reference.edgeMs), observedIngestUtc: toIso(observedIngest),
        uncertaintyMs: uncertainty, method, note: `reference: ${reference.label}`,
      });
      say(`${replay.source} calibrated: offset ${signedMs(observedIngest - reference.edgeMs)} ± ${uncertainty} ms.`);
      await refreshSession();
    } catch (err) {
      say(err instanceof ApiError ? err.message : "calibration refused");
    }
  };

  const runSyncTest = async () => {
    if (!sessionId) return;
    const at = currentEdge() ?? edgeNow() - 10_000;
    setSync(await get<SyncTest>(`/edge/v1/sessions/${sessionId}/sync-test?at=${encodeURIComponent(toIso(at))}`));
  };

  const createSession = async () => {
    const label = window.prompt("Session label (e.g. the fixture)")?.trim();
    if (!label) return;
    const s = await post<MatchSession>("/edge/v1/sessions", { label, mode: "shadow" });
    setSessionId(s.id);
    await refreshSession();
  };

  // ── keyboard ──────────────────────────────────────────────────────────
  useEffect(() => {
    const handlers: Record<Action, () => void> = {
      togglePlay, cycleSpeed, flag: () => void flag(), latestIncident, live: goLive,
      back10: () => void back(10), back30: () => void back(30), back60: () => void back(60),
      nudgeBack: () => nudge(-0.1), nudgeForward: () => nudge(0.1),
      "source:ground": () => void switchSource("ground"), "source:drone": () => void switchSource("drone"),
      "source:programme": () => void switchSource("programme"), help: () => setHelp((h) => !h),
    };
    const onKey = (event: KeyboardEvent) => {
      const action = actionFor(event);
      if (!action) return;
      event.preventDefault();
      handlers[action]();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [back, cycleSpeed, flag, goLive, latestIncident, nudge, switchSource, togglePlay]);

  // A test hook for the measured acceptance run (docs/fairplay/phase-2-replay-console.md).
  useEffect(() => {
    (window as unknown as { __fairplay?: unknown }).__fairplay = {
      replayAt: (source: string, edgeIso: string) => replayAt(source, toMs(edgeIso), "acceptance"),
      openIncident, state: () => ({ replay, positionMs, live, quarter }),
    };
  }, [live, openIncident, positionMs, quarter, replay, replayAt]);

  // ── derived ───────────────────────────────────────────────────────────
  const session = sessions.find((s) => s.id === sessionId) ?? null;
  const selectedIncident = incidents.find((i) => i.id === selected) ?? null;
  const replayLabel = sources.find((s) => s.name === replay?.source)?.label ?? replay?.source ?? "";
  const replayWarnings = replay ? warningsFor(replayLabel, replay.flags, replay.uncertaintyMs) : [];
  const periodStart = useMemo(() => detail?.periods.filter((p) => p.edge === "start").at(-1) ?? null, [detail]);
  const clockWarnings = [
    health?.clock.ntpState !== "synced" ? "Edge clock sync is not confirmed: compare with the match console before relying on wall times." : null,
    health?.clock.recentSteps.length ? `The Edge clock jumped ${health.clock.recentSteps[0].step_ms} ms at ${clockLabel(toMs(health.clock.recentSteps[0].edge_utc))}.` : null,
  ].filter(Boolean) as string[];

  return (
    <div className="fp-app">
      <ShadowBanner dev={me.devBundle} />
      <header className="fp-header">
        <div className="fp-brand"><DtpLogo /><span>FairPlay · {health?.device ?? "Edge"}</span></div>
        <div className="fp-session">
          <label>
            Session{" "}
            <select value={sessionId ?? ""} onChange={(e) => setSessionId(e.target.value || null)} aria-label="Match session">
              <option value="">— none —</option>
              {sessions.map((s) => <option key={s.id} value={s.id}>{s.label}{s.ended_utc ? " (ended)" : ""}</option>)}
            </select>
          </label>
          {can(me, "fairplay.session.manage") && <button className="fp-btn" onClick={createSession}>New session</button>}
          {session && <span className="fp-chip">{session.mode === "shadow" ? "Shadow" : "Post-match"}</span>}
        </div>
        <div className="fp-status" aria-live="polite">
          <span className="fp-clock" title="Edge clock, UTC">Edge {clockLabel(edgeNow())}</span>
          {periodStart && <span className="fp-chip">Match ≈ {matchClock(edgeNow(), toMs(periodStart.edge_utc), PERIOD_OFFSET_MIN[periodStart.period] ?? 0)}</span>}
          <span className={`fp-chip fp-chip--${health?.status ?? "starting"}`}>Edge {health?.status ?? "…"}</span>
          <span className="fp-chip fp-chip--muted" title={health?.cloud.note}>Cloud: local only</span>
          <span className={`fp-chip ${health?.disk.state === "ok" ? "" : "fp-chip--warn"}`}>Disk {health ? `${Math.round(health.disk.freeBytes / 1e9)} GB free` : "…"}</span>
          <span className="fp-me">{me.name}</span>
          <button className="fp-btn" onClick={onSignedOut}>Sign out</button>
        </div>
      </header>

      {(clockWarnings.length > 0 || health?.mediaServer.up === false) && (
        <div className="fp-alerts" role="status">
          {health?.mediaServer.up === false && <p className="fp-error">Recorder unreachable: {health.mediaServer.error}</p>}
          {clockWarnings.map((w) => <p key={w} className="fp-warn">{w}</p>)}
        </div>
      )}

      <main className="fp-grid">
        <section className="fp-panel fp-sources" aria-labelledby="sources-title">
          <h2 id="sources-title">Sources</h2>
          {sources.map((s) => {
            const cal = calibrationFor(s.name);
            const codec = s.codecProps[0];
            const state = s.publishing === null ? "unknown" : !s.publishing ? "unavailable" : s.recording ? "recording" : "not recording";
            return (
              <article key={s.name} className={`fp-source fp-source--${state.replace(" ", "-")}`}>
                <header>
                  <strong>{s.label}</strong> <span className="fp-muted">{s.role}{s.required ? " · required" : ""}</span>
                </header>
                <p className="fp-source__state">{state === "recording" ? "● Recording" : state === "unavailable" ? "Unavailable — no feed" : state === "not recording" ? "Connected, NOT recording" : "Recorder state unknown"}</p>
                {codec && <p className="fp-muted">{codec.codec} {codec.width}×{codec.height}</p>}
                <p className="fp-muted">Offset {cal ? `${signedMs(cal.offsetMs)} ± ${cal.uncertaintyMs} ms` : "—"}
                  {cal?.flags.map((f) => <span key={f} className="fp-flag">{f.replaceAll("_", " ")}</span>)}</p>
                <div className="fp-row">
                  <button className="fp-btn" disabled={!s.publishing} onClick={() => setLiveSource(s.name)} aria-pressed={liveSource === s.name}>Live</button>
                  <button className="fp-btn" onClick={() => void switchSource(s.name)} aria-pressed={replay?.source === s.name}
                          aria-keyshortcuts={s.role === "ground" ? "G" : s.role === "drone" ? "D" : "P"}>Replay</button>
                </div>
                {s.openAlerts.map((a) => <p key={a.id} className={a.severity === "critical" ? "fp-error" : "fp-warn"}>{a.kind.replaceAll("_", " ")}</p>)}
              </article>
            );
          })}
          {!sources.some((s) => s.role === "programme") && <p className="fp-muted">Programme feed: not configured.</p>}
          {!sources.some((s) => s.role === "drone") && <p className="fp-muted">Drone: not configured — single-angle mode.</p>}
        </section>

        <section className="fp-panel fp-live" aria-labelledby="live-title" ref={liveRegion} tabIndex={-1}>
          <h2 id="live-title">LIVE · {sources.find((s) => s.name === liveSource)?.label ?? liveSource}</h2>
          <div className="fp-video">
            <video ref={liveVideo} muted playsInline aria-label="Live preview" />
            {live.status !== "playing" && <p className="fp-overlay">{live.status === "connecting" ? "Connecting…" : `Live preview unavailable: ${live.message ?? live.status}`}</p>}
          </div>
          <p className="fp-muted">{live.behindMs !== null ? `≈ ${(live.behindMs / 1000).toFixed(1)} s behind live (measured)` : "delay not yet measured"} · preview only, muted</p>
        </section>

        <section className="fp-panel fp-replay" aria-labelledby="replay-title">
          <h2 id="replay-title">REPLAY {replay ? `· ${replayLabel}` : ""}</h2>
          <div className="fp-video">
            <video ref={replayVideo} playsInline controls={false} aria-label="Replay" />
            {replay?.status === "loading" && <p className="fp-overlay">Loading the recording…</p>}
            {replay?.status === "error" && <p className="fp-overlay fp-error">{replay.error}</p>}
            {!replay && <p className="fp-overlay">No replay loaded. Jump back, or open an incident.</p>}
          </div>
          {replayWarnings.map((w) => <p key={w} className="fp-warn" role="alert">{w}</p>)}
          <p className="fp-position">
            {positionMs !== null ? `≈ ${clockLabel(positionMs)} UTC (Edge clock)` : "—"}
            {replay && <> · offset {signedMs(replay.offsetMs)} ± {replay.uncertaintyMs} ms</>}
            {replay?.eventAtMs !== null && replay?.eventAtMs !== undefined && <> · incident at {(replay.eventAtMs / 1000).toFixed(1)} s into this window</>}
            {replay?.toPlayableMs != null && <> · loaded in {replay.toPlayableMs} ms</>}
          </p>
          <input className="fp-scrub" type="range" min={0} max={replay ? replay.durationMs / 1000 : 0} step={0.04} value={posS}
                 disabled={!replay || replay.status !== "ready"} aria-label="Position in the replay window"
                 onChange={(e) => { if (replayVideo.current) replayVideo.current.currentTime = Number(e.target.value); }} />
          <p className="fp-muted fp-small">Positions are approximate: seeking lands on keyframes, not exact frames.</p>
          <div className="fp-toolbar" role="toolbar" aria-label="Replay controls">
            <button className="fp-btn" onClick={() => void back(60)} aria-keyshortcuts="3">−60 s</button>
            <button className="fp-btn" onClick={() => void back(30)} aria-keyshortcuts="2">−30 s</button>
            <button className="fp-btn" onClick={() => void back(10)} aria-keyshortcuts="1 ArrowLeft">−10 s</button>
            <button className="fp-btn" onClick={() => nudge(-0.1)} aria-keyshortcuts=",">−0.1 s</button>
            <button className="fp-btn" onClick={() => nudge(0.1)} aria-keyshortcuts=".">+0.1 s</button>
            <button className="fp-btn fp-btn--primary" onClick={togglePlay} disabled={!replay} aria-keyshortcuts="Space">Play / pause</button>
            <button className="fp-btn" onClick={cycleSpeed} aria-keyshortcuts="S">Speed {speed}×</button>
            <button className="fp-btn" onClick={goLive} aria-keyshortcuts="L">Return to live</button>
            <button className="fp-btn fp-btn--danger" onClick={() => void flag()} disabled={!can(me, "fairplay.incident.operate") || !sessionId} aria-keyshortcuts="F">Flag incident</button>
            <button className="fp-btn" onClick={() => void flagAtReplay()} disabled={!can(me, "fairplay.incident.operate") || !sessionId || !replay}>Flag at replay position</button>
            <button className="fp-btn" onClick={() => setHelp((h) => !h)} aria-keyshortcuts="?">Keys</button>
          </div>
          <form className="fp-row fp-goto" onSubmit={(e) => { e.preventDefault(); goToTyped(); }}>
            <label>Go to (UTC) <input value={goTo} onChange={(e) => setGoTo(e.target.value)} placeholder="23:55:00" aria-label="Time to replay, UTC" /></label>
            <button className="fp-btn" type="submit">Go</button>
          </form>
          <p className="fp-muted fp-small">
            0.25×: {quarter === null ? "not yet measured" : quarter.supported ? `available (measured ${quarter.advancedS?.toFixed(2)} s in 2 s)` : `not offered — measured ${quarter.advancedS?.toFixed(2) ?? "nothing"} s in 2 s`}
          </p>
        </section>

        <section className="fp-panel fp-incidents" aria-labelledby="incidents-title">
          <h2 id="incidents-title">Incidents</h2>
          {incidents.length === 0 && <p className="fp-muted">None flagged yet.</p>}
          <ul>
            {incidents.map((inc) => (
              <li key={inc.id}>
                <button className={`fp-incident ${selected === inc.id ? "is-selected" : ""}`} onClick={() => void openIncident(inc.id)} aria-keyshortcuts={inc === incidents[0] ? "I" : undefined}>
                  ≈ {clockLabel(toMs(inc.event_utc))} · {inc.category} {inc.note ? `· ${inc.note}` : ""}
                </button>
              </li>
            ))}
          </ul>
          {selectedIncident && <IncidentEditor incident={selectedIncident} windows={windows} canEdit={can(me, "fairplay.incident.operate")}
                                                onSaved={async () => { await refreshSession(); await openIncident(selectedIncident.id); }} say={say} />}
        </section>

        <section className="fp-panel fp-calibration" aria-labelledby="calibration-title">
          <h2 id="calibration-title">Periods &amp; calibration</h2>
          <div className="fp-row">
            {[["1", "start", "Kick-off"], ["1", "end", "Half-time"], ["2", "start", "2nd half"], ["2", "end", "Full time"]].map(([p, e, label]) => (
              <button key={label} className="fp-btn" disabled={!sessionId || !can(me, "fairplay.incident.operate")} onClick={() => void markPeriod(p, e as "start" | "end")}>{label}</button>
            ))}
          </div>
          <p className="fp-muted fp-small">{detail?.periods.map((p) => `P${p.period} ${p.edge} ≈ ${clockLabel(toMs(p.edge_utc))}`).join(" · ") || "No period marked."}</p>
          <ol className="fp-steps">
            <li>Pause a replay on a visible event (whistle, kick, the test marker).
              <div className="fp-row">
                <button className="fp-btn" onClick={setReferenceHere}>This frame is the reference</button>
                <button className="fp-btn" onClick={useKickoffAsReference}>Use the last period mark</button>
              </div>
              {reference && <p className="fp-muted">Reference: {reference.label}</p>}
            </li>
            <li>Switch source, pause on the same event, then:
              <div className="fp-row">
                <label>± <input type="number" min={20} max={60000} value={uncertainty} onChange={(e) => setUncertainty(Number(e.target.value))} aria-label="Uncertainty in milliseconds" /> ms</label>
                <select value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Calibration method">
                  {CAL_METHODS.map((m) => <option key={m}>{m}</option>)}
                </select>
                <button className="fp-btn fp-btn--primary" disabled={!reference || !replay} onClick={() => void sameEventHere()}>Same event here</button>
              </div>
            </li>
          </ol>
          <button className="fp-btn" onClick={() => void runSyncTest()} disabled={!sessionId}>Synchronisation test at this moment</button>
          {sync && (
            <div className="fp-sync">
              <p className={sync.aligned ? "fp-ok" : "fp-warn"}>{sync.statement}</p>
              <div className="fp-sync__grid">
                {sync.windows.map((w) => (
                  <figure key={w.source}>
                    <video src={w.playbackPath} muted controls playsInline aria-label={`${w.source} at the test moment`} />
                    <figcaption>{w.source}: {signedMs(w.offsetMs)} ± {w.uncertaintyMs} ms · {w.state.replaceAll("_", " ")}</figcaption>
                  </figure>
                ))}
              </div>
            </div>
          )}
        </section>
      </main>

      <div className="fp-message" role="status" aria-live="polite">{message}</div>

      {help && (
        <div className="fp-help" role="dialog" aria-label="Keyboard shortcuts">
          <h2>Keyboard shortcuts</h2>
          <p className="fp-muted">Every shortcut has a button as well.</p>
          <dl>{SHORTCUTS.filter((s, i, all) => all.findIndex((x) => x.action === s.action) === i).map((s) => (
            <div key={s.action}><dt>{s.label}</dt><dd>{s.action.replace("source:", "replay ").replace(/([A-Z])/g, " $1").toLowerCase()}</dd></div>
          ))}</dl>
          <button className="fp-btn" onClick={() => setHelp(false)}>Close</button>
        </div>
      )}
    </div>
  );
}

function IncidentEditor({ incident, windows, canEdit, onSaved, say }: {
  incident: Incident; windows: IncidentWindows | null; canEdit: boolean; onSaved: () => Promise<void>; say: (t: string) => void;
}) {
  const [pre, setPre] = useState(incident.pre_roll_ms / 1000);
  const [postRoll, setPostRoll] = useState(incident.post_roll_ms / 1000);
  const [category, setCategory] = useState(incident.category);
  const [note, setNote] = useState(incident.note ?? "");

  useEffect(() => {
    setPre(incident.pre_roll_ms / 1000);
    setPostRoll(incident.post_roll_ms / 1000);
    setCategory(incident.category);
    setNote(incident.note ?? "");
  }, [incident.id, incident.version, incident.pre_roll_ms, incident.post_roll_ms, incident.category, incident.note]);

  const save = async () => {
    try {
      await patch(`/edge/v1/incidents/${incident.id}`, { preRollMs: Math.round(pre * 1000), postRollMs: Math.round(postRoll * 1000), category, note }, incident.version);
      say("Incident saved.");
      await onSaved();
    } catch (err) {
      say(err instanceof ApiError && err.status === 409 ? "Someone else changed this incident — reloaded; check and save again." : err instanceof Error ? err.message : "not saved");
      await onSaved();
    }
  };

  return (
    <div className="fp-editor">
      <h3>Incident ≈ {clockLabel(toMs(incident.event_utc))} UTC · v{incident.version}</h3>
      <div className="fp-row">
        <label>Pre-roll <input type="number" min={0} max={600} value={pre} onChange={(e) => setPre(Number(e.target.value))} disabled={!canEdit} /> s</label>
        <label>Post-roll <input type="number" min={0} max={600} value={postRoll} onChange={(e) => setPostRoll(Number(e.target.value))} disabled={!canEdit} /> s</label>
      </div>
      <label>Category <select value={category} onChange={(e) => setCategory(e.target.value)} disabled={!canEdit}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
      <label>Note <textarea value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} disabled={!canEdit} /></label>
      <button className="fp-btn fp-btn--primary" onClick={() => void save()} disabled={!canEdit}>Save</button>
      {windows && (
        <table className="fp-table">
          <caption>What each source shows for this incident</caption>
          <thead><tr><th>Source</th><th>Offset</th><th>State</th><th>Recorded</th></tr></thead>
          <tbody>{windows.perSource.map((w) => (
            <tr key={w.source}><td>{w.source}</td><td>{signedMs(w.offsetMs)} ± {w.uncertaintyMs}</td><td>{w.state.replaceAll("_", " ")}</td><td>{Math.round(w.coveredMs / 1000)} / {Math.round(w.durationMs / 1000)} s</td></tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}
