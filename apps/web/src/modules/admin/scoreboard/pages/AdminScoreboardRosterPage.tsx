import { useCallback, useEffect, useState } from "react";
import { adminScoreboardApi } from "../../../../api/admin-scoreboard";
import type { SbMatchListItem } from "../../../../api/scoreboard";
import { usePageTitle } from "../../../../hooks/usePageTitle";
import { formatAdminScoreboardError } from "../admin-scoreboard-utils";
import { AdminSbPageHeader } from "../components/AdminSbPageHeader";
import { RosterReadinessBar } from "../components/RosterReadinessBar";
import {
  isGoalkeeper,
  positionTag,
  type MatchdayRosterSlot,
  type PositionTag,
} from "../types";

function toSlot(
  row: {
    squadId: string;
    displayName: string;
    position: string | null;
    shirtNumber: number | null;
    playerId: string | null;
    playerSlug: string | null;
  },
  role: "xi" | "sub"
): MatchdayRosterSlot {
  return {
    squadId: row.squadId,
    displayName: row.displayName,
    position: row.position,
    shirtNumber: row.shirtNumber,
    playerId: row.playerId,
    playerSlug: row.playerSlug,
    role,
  };
}

export function AdminScoreboardRosterPage() {
  usePageTitle("Admin — Matchday roster");
  const [matches, setMatches] = useState<SbMatchListItem[]>([]);
  const [matchId, setMatchId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [directory, setDirectory] = useState<
    Array<{
      squadId: string;
      displayName: string;
      position: string | null;
      shirtNumber: number | null;
      playerId: string | null;
      playerSlug: string | null;
    }>
  >([]);
  const [xi, setXi] = useState<MatchdayRosterSlot[]>([]);
  const [subs, setSubs] = useState<MatchdayRosterSlot[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [readiness, setReadiness] = useState<
    Awaited<ReturnType<typeof adminScoreboardApi.getSpotter>>["rosterReadiness"] | null
  >(null);

  useEffect(() => {
    adminScoreboardApi.matches().then((rows) => {
      setMatches(rows);
      if (rows[0]) {
        setMatchId(rows[0].id);
        setTeamId(rows[0].homeTeam.id);
      }
    });
  }, []);

  const selectedMatch = matches.find((m) => m.id === matchId);

  const loadRoster = useCallback(() => {
    if (!matchId || !teamId) return;
    setLoading(true);
    Promise.all([
      adminScoreboardApi.getRoster(matchId, teamId),
      adminScoreboardApi.getSpotter(matchId),
    ])
      .then(([rosterData, spotter]) => {
        setDirectory(rosterData.directory);
        setXi(rosterData.roster.xi ?? []);
        setSubs(rosterData.roster.subs ?? []);
        setReadiness(spotter.rosterReadiness);
      })
      .catch(() => {
        setDirectory([]);
        setXi([]);
        setSubs([]);
      })
      .finally(() => setLoading(false));
  }, [matchId, teamId]);

  useEffect(() => {
    loadRoster();
  }, [loadRoster]);

  const inRoster = (squadId: string) =>
    xi.some((p) => p.squadId === squadId) || subs.some((p) => p.squadId === squadId);

  const addPlayer = (row: (typeof directory)[0], role: "xi" | "sub") => {
    if (inRoster(row.squadId)) return;
    const slot = toSlot(row, role);
    if (role === "xi" && xi.length >= 11) {
      setMessage("Starting XI is full (11)");
      return;
    }
    if (xi.length + subs.length >= 20) {
      setMessage("Matchday roster is full (20)");
      return;
    }
    if (role === "xi") setXi([...xi, slot]);
    else setSubs([...subs, slot]);
  };

  const removePlayer = (squadId: string) => {
    setXi(xi.filter((p) => p.squadId !== squadId));
    setSubs(subs.filter((p) => p.squadId !== squadId));
  };

  const updateCleanSheets = (squadId: string, value: number) => {
    setXi(
      xi.map((p) =>
        p.squadId === squadId ? { ...p, cleanSheets: Math.max(0, value) } : p
      )
    );
  };

  const save = async () => {
    if (!matchId || !teamId) return;
    setSaving(true);
    try {
      await adminScoreboardApi.saveRoster(matchId, { teamId, xi, subs });
      setMessage("Matchday roster saved — player IDs linked to master directory");
      loadRoster();
    } catch (e) {
      setMessage(formatAdminScoreboardError(e));
    } finally {
      setSaving(false);
    }
  };

  const renderRosterList = (
    list: MatchdayRosterSlot[],
    title: string,
    variant: "xi" | "bench"
  ) => (
    <div className={`admin-sb-roster-panel admin-sb-roster-panel--${variant}`}>
      <h3>
        {title}{" "}
        <span className="admin-sb-roster-count">
          ({list.length}
          {variant === "xi" ? "/11" : ""})
        </span>
      </h3>
      {list.length === 0 ? (
        <p className="admin-sb-empty muted">No players selected yet.</p>
      ) : (
        <ul className="admin-sb-roster-list">
          {list.map((p) => {
            const tag: PositionTag = positionTag(p.position);
            const gk = isGoalkeeper(p.position);
            return (
              <li key={p.squadId} className="admin-sb-roster-item">
                <span className={`admin-sb-pos admin-sb-pos--${tag.toLowerCase()}`}>{tag}</span>
                <span>
                  {p.shirtNumber != null ? `${p.shirtNumber}. ` : ""}
                  {p.displayName}
                </span>
                {gk && (
                  <label className="admin-sb-clean-sheet">
                    Clean sheets
                    <input
                      type="number"
                      min={0}
                      value={p.cleanSheets ?? 0}
                      onChange={(e) =>
                        updateCleanSheets(p.squadId, Number(e.target.value))
                      }
                    />
                  </label>
                )}
                <button
                  type="button"
                  className="admin-link-danger"
                  onClick={() => removePlayer(p.squadId)}
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  return (
    <section className="admin-sb-section">
      <AdminSbPageHeader
        title="Matchday roster"
        description="Build 11 starters plus bench for each side, then lock lineups on the spotter tablet."
        crumbs={[{ label: "Roster" }]}
      />

      <div className="admin-filters admin-filters--with-action">
        <select value={matchId} onChange={(e) => setMatchId(e.target.value)} aria-label="Match">
          {matches.map((m) => (
            <option key={m.id} value={m.id}>
              {m.homeTeam.name} vs {m.awayTeam.name} ({m.status})
            </option>
          ))}
        </select>
        {selectedMatch && (
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)} aria-label="Team">
            <option value={selectedMatch.homeTeam.id}>{selectedMatch.homeTeam.name}</option>
            <option value={selectedMatch.awayTeam.id}>{selectedMatch.awayTeam.name}</option>
          </select>
        )}
        <button
          type="button"
          className="admin-inline-button"
          onClick={save}
          disabled={saving || loading}
        >
          {saving ? "Saving…" : "Save roster"}
        </button>
      </div>

      {selectedMatch && (
        <RosterReadinessBar
          readiness={readiness}
          homeLabel={selectedMatch.homeTeam.name}
          awayLabel={selectedMatch.awayTeam.name}
        />
      )}

      {message && <p className="admin-sb-msg">{message}</p>}

      {loading ? (
        <div className="admin-sb-roster-split admin-sb-roster-split--loading">
          <div className="admin-sb-skeleton admin-sb-skeleton--panel" />
          <div className="admin-sb-skeleton admin-sb-skeleton--panel" />
        </div>
      ) : (
        <div className="admin-sb-roster-split">
          <div className="admin-sb-directory admin-sb-panel">
            <h3>Club directory</h3>
            {directory.length === 0 ? (
              <p className="admin-sb-empty muted">No squad rows for this team.</p>
            ) : (
              <ul>
                {directory.map((row) => (
                  <li key={row.squadId} className={inRoster(row.squadId) ? "picked" : ""}>
                    <span
                      className={`admin-sb-pos admin-sb-pos--${positionTag(row.position).toLowerCase()}`}
                    >
                      {positionTag(row.position)}
                    </span>
                    <span className="admin-sb-directory-name">{row.displayName}</span>
                    {!inRoster(row.squadId) && (
                      <span className="admin-sb-directory-actions">
                        <button type="button" onClick={() => addPlayer(row, "xi")}>
                          + XI
                        </button>
                        <button type="button" onClick={() => addPlayer(row, "sub")}>
                          + Sub
                        </button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        <div className="admin-sb-roster-selected admin-sb-roster-columns">
          {renderRosterList(xi, "Starting XI", "xi")}
          {renderRosterList(subs, "Substitutes", "bench")}
        </div>
        </div>
      )}
    </section>
  );
}
