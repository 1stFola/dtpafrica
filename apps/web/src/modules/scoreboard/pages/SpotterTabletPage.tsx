import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { adminScoreboardApi } from "../../../api/admin-scoreboard";
import { patchMatch, postMatchEvent } from "../../../api/scoreboard";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { AdminApiKeyGate } from "../../admin/components/AdminApiKeyGate";
import { RosterReadinessBar } from "../../admin/scoreboard/components/RosterReadinessBar";
import { isGoalkeeper } from "../../admin/scoreboard/types";

type SquadRow = {
  id: string;
  displayName: string;
  position: string | null;
  shirtNumber: number | null;
};

const QUICK_EVENTS = [
  { type: "goal", label: "Goal" },
  { type: "yellow_card", label: "Yellow" },
  { type: "red_card", label: "Red" },
  { type: "injury", label: "Injury" },
  { type: "substitution", label: "Sub" },
] as const;

const PITCH_SLOTS = [
  { x: 50, y: 88 },
  { x: 20, y: 72 },
  { x: 40, y: 72 },
  { x: 60, y: 72 },
  { x: 80, y: 72 },
  { x: 25, y: 55 },
  { x: 50, y: 55 },
  { x: 75, y: 55 },
  { x: 30, y: 38 },
  { x: 50, y: 32 },
  { x: 70, y: 38 },
];

export function SpotterTabletPage() {
  usePageTitle("Spotter tablet");
  const [matchId, setMatchId] = useState("");
  const [matchOptions, setMatchOptions] = useState<Array<{ id: string; label: string }>>([]);
  const [data, setData] = useState<Awaited<
    ReturnType<typeof adminScoreboardApi.getSpotter>
  > | null>(null);
  const [loading, setLoading] = useState(false);
  const [side, setSide] = useState<"home" | "away">("home");
  const [selectedSquadId, setSelectedSquadId] = useState<string | null>(null);
  const [subMode, setSubMode] = useState(false);
  const [subBenchId, setSubBenchId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [tagging, setTagging] = useState(false);
  const [yc, setYc] = useState(0);
  const [rc, setRc] = useState(0);
  const [goals, setGoals] = useState(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (text: string) => {
    setMessage(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setMessage(null), 3200);
  };

  const loadMatches = useCallback(() => {
    adminScoreboardApi.matches().then((rows) => {
      setMatchOptions(
        rows.map((m) => ({
          id: m.id,
          label: `${m.homeTeam.name} vs ${m.awayTeam.name} (${m.status})`,
        }))
      );
      const live = rows.filter((m) => m.status === "live" || m.status === "halftime");
      const pick = live[0] ?? rows[0];
      if (pick) setMatchId((prev) => prev || pick.id);
    });
  }, []);

  const refresh = useCallback(() => {
    if (!matchId) return;
    setLoading(true);
    adminScoreboardApi
      .getSpotter(matchId)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [matchId]);

  useEffect(() => {
    loadMatches();
  }, [loadMatches]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 20000);
    return () => clearInterval(t);
  }, [refresh]);

  const match = data?.match;
  const ops = data?.ops;
  const readiness = data?.rosterReadiness;
  const locked = ops?.lineupsLocked ?? false;
  const canTag = locked && (readiness?.readyForLive ?? false) && !tagging;
  const team = side === "home" ? match?.homeTeam : match?.awayTeam;
  const roster = team ? data?.matchdayRosters?.[team.id] : undefined;
  const xiIds = new Set(roster?.xi?.map((p) => p.squadId) ?? []);
  const pitchSquad = (team?.squad ?? []).filter((_, i) => i < 11);
  const benchSquad = (team?.squad ?? []).filter(
    (s) => !xiIds.has(s.id) && !pitchSquad.some((p) => p.id === s.id)
  );

  const selectedPlayer = team?.squad.find((s) => s.id === selectedSquadId);

  const setMinute = async (delta: number) => {
    if (!match) return;
    const next = Math.max(0, (match.minute ?? 0) + delta);
    await patchMatch(match.id, { minute: next });
    refresh();
  };

  const setStatus = async (status: string) => {
    if (!match) return;
    try {
      await patchMatch(match.id, { status });
      showToast(`Match status → ${status}`);
      refresh();
    } catch (e) {
      showToast(String(e));
    }
  };

  const toggleOfficial = async () => {
    if (!match || !ops) return;
    const next = ops.officialsConfirmed >= 4 ? 0 : ops.officialsConfirmed + 1;
    await adminScoreboardApi.patchSpotter(match.id, { officialsConfirmed: next });
    refresh();
  };

  const lockLineups = async () => {
    if (!match) return;
    try {
      await adminScoreboardApi.patchSpotter(match.id, { lockLineups: true });
      showToast("Lineups locked — live tagging enabled");
      refresh();
    } catch (e) {
      showToast(String(e));
    }
  };

  const tagEvent = async (type: string) => {
    if (!match || !team || !selectedSquadId || !canTag) return;
    setTagging(true);
    const player = team.squad.find((s) => s.id === selectedSquadId);
    const rosterSlot = [...(roster?.xi ?? []), ...(roster?.subs ?? [])].find(
      (s) => s.squadId === selectedSquadId
    );
    try {
      await postMatchEvent(match.id, {
        type,
        minute: match.minute ?? 0,
        teamId: team.id,
        playerId: rosterSlot?.playerId ?? undefined,
        playerLabel: player?.displayName,
        metadata: { source: "spotter-tablet", squadId: selectedSquadId },
      });
      showToast(`${type.replace("_", " ")} recorded`);
      refresh();
    } catch (e) {
      await adminScoreboardApi.patchSpotter(match.id, {
        pushOfflineEvent: { type, minute: match.minute ?? 0 },
      });
      showToast("Queued offline — sync when connected");
      refresh();
    } finally {
      setTagging(false);
    }
  };

  const undoLast = async () => {
    if (!match) return;
    await adminScoreboardApi.patchSpotter(match.id, { popOfflineQueue: true });
    showToast("Undid last queued action");
    refresh();
  };

  const pitchLayout = useMemo(() => {
    return pitchSquad.map((player, i) => ({
      player,
      slot: PITCH_SLOTS[i] ?? PITCH_SLOTS[PITCH_SLOTS.length - 1],
    }));
  }, [pitchSquad]);

  return (
    <AdminApiKeyGate title="Spotter tablet">
    <div className="spotter-tablet">
      <header className="spotter-header">
        <h1>Stadium spotter</h1>
        <p className="muted">Touch-first live tagging — lock lineups after admin rosters are saved</p>
      </header>

      <div className="spotter-toolbar">
        <select
          value={matchId}
          onChange={(e) => setMatchId(e.target.value)}
          aria-label="Select match"
        >
          <option value="">Select match…</option>
          {matchOptions.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <div className="spotter-match-states">
          <button type="button" className="spotter-btn" onClick={() => setStatus("live")}>
            Kick off
          </button>
          <button type="button" className="spotter-btn" onClick={() => setStatus("halftime")}>
            HT
          </button>
          <button type="button" className="spotter-btn" onClick={() => setStatus("live")}>
            2nd half
          </button>
          <button type="button" className="spotter-btn spotter-btn--accent" onClick={() => setStatus("finished")}>
            FT
          </button>
        </div>
        <div className="spotter-minute">
          <button type="button" className="spotter-btn spotter-btn--lg" onClick={() => setMinute(-1)} aria-label="Minus one minute">
            −1
          </button>
          <span className="spotter-clock">{match?.minute ?? 0}&apos;</span>
          <button type="button" className="spotter-btn spotter-btn--lg" onClick={() => setMinute(1)} aria-label="Plus one minute">
            +1
          </button>
          <button
            type="button"
            className="spotter-btn"
            onClick={() =>
              match &&
              adminScoreboardApi
                .patchSpotter(match.id, { addedTime: (ops?.addedTime ?? 0) + 1 })
                .then(refresh)
            }
          >
            +AT ({ops?.addedTime ?? 0})
          </button>
        </div>
      </div>

      {match && (
        <RosterReadinessBar
          readiness={readiness}
          homeLabel={match.homeTeam.name}
          awayLabel={match.awayTeam.name}
          compact
        />
      )}

      <div className="spotter-readiness">
        <button type="button" className="spotter-btn" onClick={toggleOfficial}>
          Officials {ops?.officialsConfirmed ?? 0}/4
        </button>
        <button
          type="button"
          className={`spotter-btn ${locked ? "spotter-btn--locked" : "spotter-btn--primary"}`}
          onClick={lockLineups}
          disabled={locked || !(readiness?.home.complete && readiness?.away.complete)}
          title={
            readiness?.home.complete && readiness?.away.complete
              ? undefined
              : "Both teams need 11+1 in admin roster first"
          }
        >
          {locked ? "Lineups locked ✓" : "Lock lineups"}
        </button>
        <span className="spotter-queue">Queue: {ops?.offlineQueueCount ?? 0}</span>
        <button type="button" className="spotter-btn" onClick={undoLast}>
          Undo queue
        </button>
      </div>

      {!locked && (
        <div className="spotter-lock-banner" role="alert">
          Save matchday rosters in admin, then lock lineups here to enable live event tagging.
        </div>
      )}

      {loading && !match && (
        <div className="spotter-loading">
          <span className="admin-sb-skeleton admin-sb-skeleton--panel" />
        </div>
      )}

      {match && (
        <>
          <div className="spotter-scoreline">
            <button
              type="button"
              className={`spotter-btn ${side === "home" ? "active" : ""}`}
              onClick={() => setSide("home")}
            >
              {match.homeTeam.name}
            </button>
            <span className="spotter-scoreline__score">
              {match.homeScore} – {match.awayScore}
            </span>
            <button
              type="button"
              className={`spotter-btn ${side === "away" ? "active" : ""}`}
              onClick={() => setSide("away")}
            >
              {match.awayTeam.name}
            </button>
          </div>

          <div className={`spotter-body ${!canTag ? "spotter-body--gated" : ""}`}>
            <div className="spotter-pitch" aria-label="Pitch formation">
              <div className="spotter-pitch__markings" aria-hidden="true" />
              {pitchLayout.map(({ player, slot }) => (
                <button
                  key={player.id}
                  type="button"
                  className={
                    selectedSquadId === player.id
                      ? "spotter-bubble selected"
                      : "spotter-bubble"
                  }
                  style={{ left: `${slot.x}%`, top: `${slot.y}%` }}
                  disabled={!canTag}
                  onClick={() => {
                    if (subMode && subBenchId) {
                      showToast(`Sub: bench → ${player.displayName}`);
                      setSubMode(false);
                      setSubBenchId(null);
                      return;
                    }
                    setSelectedSquadId(player.id);
                    setYc(0);
                    setRc(0);
                    setGoals(0);
                  }}
                >
                  <span className="spotter-bubble__num">{player.shirtNumber ?? "·"}</span>
                </button>
              ))}
            </div>

            <aside className="spotter-panel">
              {selectedPlayer ? (
                <>
                  <h3>{selectedPlayer.displayName}</h3>
                  <p className="muted">{selectedPlayer.position ?? "—"}</p>
                  <div className="spotter-stats">
                    <label>
                      YC
                      <input type="number" min={0} value={yc} onChange={(e) => setYc(Number(e.target.value))} disabled={!canTag} />
                    </label>
                    <label>
                      RC
                      <input type="number" min={0} value={rc} onChange={(e) => setRc(Number(e.target.value))} disabled={!canTag} />
                    </label>
                    <label>
                      Goals
                      <input type="number" min={0} value={goals} onChange={(e) => setGoals(Number(e.target.value))} disabled={!canTag} />
                    </label>
                    {isGoalkeeper(selectedPlayer.position) && (
                      <p className="muted">GK — clean sheets on full time</p>
                    )}
                  </div>
                  <div className="spotter-quick-events">
                    {QUICK_EVENTS.map((ev) => (
                      <button
                        key={ev.type}
                        type="button"
                        className="spotter-event-btn"
                        disabled={!canTag}
                        onClick={() => tagEvent(ev.type)}
                      >
                        {ev.label}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <p className="spotter-empty muted">Tap a player on the pitch</p>
              )}

              <div className="spotter-bench">
                <h4>Bench {subMode && "· sub mode"}</h4>
                <ul>
                  {(benchSquad.length ? benchSquad : team?.squad.slice(11) ?? []).map((p: SquadRow) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className="spotter-bench-btn"
                        disabled={!canTag}
                        onClick={() => {
                          if (subMode) {
                            setSubBenchId(p.id);
                            showToast(`Tap pitch player for ${p.displayName}`);
                          } else {
                            setSelectedSquadId(p.id);
                          }
                        }}
                      >
                        {p.displayName}
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className={`spotter-btn ${subMode ? "active" : ""}`}
                  disabled={!canTag}
                  onClick={() => setSubMode(!subMode)}
                >
                  Substitution mode
                </button>
              </div>
            </aside>
          </div>
        </>
      )}

      {message && <p className="spotter-toast" role="status">{message}</p>}
    </div>
    </AdminApiKeyGate>
  );
}
