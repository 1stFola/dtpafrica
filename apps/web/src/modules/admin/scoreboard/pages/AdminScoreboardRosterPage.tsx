import { useCallback, useEffect, useState } from "react";
import { adminScoreboardApi } from "../../../../api/admin-scoreboard";
import type { SbMatchListItem } from "../../../../api/scoreboard";
import { usePageTitle } from "../../../../hooks/usePageTitle";
import { useAdminToast } from "../../components/AdminToast";
import { formatAdminScoreboardError, formatMatchOptionLabel, sortRosterMatches } from "../admin-scoreboard-utils";
import { AdminSbPageHeader } from "../components/AdminSbPageHeader";
import { GamedayEditPanel } from "../components/GamedayEditPanel";
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
  const toast = useAdminToast();
  const [matches, setMatches] = useState<SbMatchListItem[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(true);
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
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [readiness, setReadiness] = useState<
    Awaited<ReturnType<typeof adminScoreboardApi.getSpotter>>["rosterReadiness"] | null
  >(null);
  const [competitionId, setCompetitionId] = useState("");
  const [competitions, setCompetitions] = useState<
    Array<{ id: string; name: string; slug: string; season: string }>
  >([]);

  useEffect(() => {
    adminScoreboardApi
      .competitionPicker()
      .then(setCompetitions)
      .catch(() => setCompetitions([]));
  }, []);

  const loadMatches = useCallback((compId?: string) => {
    setMatchesLoading(true);
    return adminScoreboardApi
      .matches(compId || undefined)
      .then((rows) => {
        const sorted = sortRosterMatches(rows);
        setMatches(sorted);
        setMatchId((prev) => {
          if (prev && sorted.some((m) => m.id === prev)) return prev;
          return sorted[0]?.id ?? "";
        });
      })
      .catch(() => {
        setMatches([]);
        setMatchId("");
      })
      .finally(() => setMatchesLoading(false));
  }, []);

  useEffect(() => {
    void loadMatches(competitionId || undefined);
  }, [competitionId, loadMatches]);

  const selectedMatch = matches.find((m) => m.id === matchId);

  useEffect(() => {
    if (!selectedMatch) return;
    if (teamId !== selectedMatch.homeTeam.id && teamId !== selectedMatch.awayTeam.id) {
      setTeamId(selectedMatch.homeTeam.id);
    }
  }, [selectedMatch, teamId]);

  const handleGamedaySaved = (patch: { venue: string | null; kickoffAt: string | null }) => {
    setMatches((prev) =>
      prev.map((m) =>
        m.id === matchId ? { ...m, venue: patch.venue, kickoffAt: patch.kickoffAt } : m
      )
    );
  };

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
    if (!isGoalkeeper(row.position)) {
      delete slot.cleanSheets;
    }
    if (role === "xi" && xi.length >= 11) {
      toast.error("Starting XI is full (11)");
      return;
    }
    if (xi.length + subs.length >= 20) {
      toast.error("Matchday roster is full (20)");
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

  const stripNonGkCleanSheets = (list: MatchdayRosterSlot[]) =>
    list.map((p) => {
      if (isGoalkeeper(p.position)) return p;
      const { cleanSheets: _cs, ...rest } = p;
      return rest;
    });

  const save = async () => {
    if (!matchId || !teamId) return;
    setSaving(true);
    const payload = {
      teamId,
      xi: stripNonGkCleanSheets(xi),
      subs: stripNonGkCleanSheets(subs),
    };
    try {
      await adminScoreboardApi.saveRoster(matchId, payload);
      toast.success("Matchday roster saved — player IDs linked to master directory");
      loadRoster();
    } catch (e) {
      toast.error(formatAdminScoreboardError(e));
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

      <div className="admin-sb-sticky-bar">
        <div className="admin-filters admin-filters--with-action">
          {matchesLoading ? (
            <span className="admin-sb-skeleton admin-sb-skeleton--bar" aria-busy="true" />
          ) : matches.length === 0 ? null : (
            <>
              {competitions.length > 1 && (
                <select
                  value={competitionId}
                  onChange={(e) => setCompetitionId(e.target.value)}
                  aria-label="Competition"
                >
                  <option value="">All competitions</option>
                  {competitions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
              <select value={matchId} onChange={(e) => setMatchId(e.target.value)} aria-label="Match">
                {matches.map((m) => (
                  <option key={m.id} value={m.id}>
                    {formatMatchOptionLabel(m)}
                  </option>
                ))}
              </select>
              {selectedMatch && (
                <select value={teamId} onChange={(e) => setTeamId(e.target.value)} aria-label="Team">
                  <option value={selectedMatch.homeTeam.id}>{selectedMatch.homeTeam.name}</option>
                  <option value={selectedMatch.awayTeam.id}>{selectedMatch.awayTeam.name}</option>
                </select>
              )}
            </>
          )}
          <button
            type="button"
            className="admin-inline-button admin-inline-button--primary"
            onClick={save}
            disabled={saving || loading || matchesLoading || !matchId}
          >
            {saving ? "Saving…" : "Save roster"}
          </button>
        </div>
      </div>

      {matchesLoading ? (
        <div className="admin-sb-roster-split admin-sb-roster-split--loading" aria-busy="true">
          <div className="admin-sb-skeleton admin-sb-skeleton--panel" />
          <div className="admin-sb-skeleton admin-sb-skeleton--panel" />
        </div>
      ) : matches.length === 0 ? (
        <div className="admin-sb-empty-state dtp-empty-state">
          <p className="admin-sb-empty-state__title dtp-empty-state__title">No fixtures scheduled</p>
          <p className="muted">
            Create a competition with fixtures in Master records, then return here to build matchday
            rosters.
          </p>
        </div>
      ) : (
        <>
      {selectedMatch && (
        <GamedayEditPanel match={selectedMatch} onSaved={handleGamedaySaved} />
      )}

      {selectedMatch && (
        <RosterReadinessBar
          readiness={readiness}
          homeLabel={selectedMatch.homeTeam.name}
          awayLabel={selectedMatch.awayTeam.name}
        />
      )}

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
        </>
      )}
    </section>
  );
}
