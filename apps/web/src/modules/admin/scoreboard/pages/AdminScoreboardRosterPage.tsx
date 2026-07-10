import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  type MatchFormation,
  type MatchdayRosterSlot,
  type PositionTag,
} from "../types";

const FORMATION_OPTIONS: MatchFormation[] = [
  "4-3-3",
  "4-2-3-1",
  "4-1-2-3",
  "4-4-2",
  "3-5-2",
  "3-4-3",
  "5-3-2",
];

function selectedTeamSide(
  match: SbMatchListItem | undefined,
  selectedTeamId: string
): "home" | "away" | null {
  if (!match) return null;
  if (match.homeTeam.id === selectedTeamId) return "home";
  if (match.awayTeam.id === selectedTeamId) return "away";
  return null;
}

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
  const squadCsvInputRef = useRef<HTMLInputElement>(null);
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
  const [csvUploading, setCsvUploading] = useState(false);
  const [formation, setFormation] = useState<MatchFormation>("4-3-3");
  const [readiness, setReadiness] = useState<
    Awaited<ReturnType<typeof adminScoreboardApi.getSpotter>>["rosterReadiness"] | null
  >(null);
  const [competitionId, setCompetitionId] = useState("");
  const [matchSearch, setMatchSearch] = useState("");
  const [playerSearch, setPlayerSearch] = useState("");
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
  const filteredMatches = useMemo(() => {
    const q = matchSearch.trim().toLowerCase();
    if (!q) return matches;
    return matches.filter((m) =>
      [
        m.homeTeam.name,
        m.awayTeam.name,
        m.competition.name,
        m.venue,
        m.roundLabel,
        m.status,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [matchSearch, matches]);

  const filteredDirectory = useMemo(() => {
    const q = playerSearch.trim().toLowerCase();
    if (!q) return directory;
    return directory.filter((row) =>
      [row.displayName, row.position, row.shirtNumber?.toString()]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [directory, playerSearch]);

  useEffect(() => {
    if (!filteredMatches.length) return;
    if (!filteredMatches.some((m) => m.id === matchId)) {
      setMatchId(filteredMatches[0].id);
    }
  }, [filteredMatches, matchId]);

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
        const side = selectedTeamSide(selectedMatch, teamId);
        const savedFormation = side ? spotter.ops.formation?.[side] : null;
        setFormation(
          FORMATION_OPTIONS.includes(savedFormation as MatchFormation)
            ? (savedFormation as MatchFormation)
            : "4-3-3"
        );
      })
      .catch(() => {
        setDirectory([]);
        setXi([]);
        setSubs([]);
      })
      .finally(() => setLoading(false));
  }, [matchId, selectedMatch, teamId]);

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
    const side = selectedTeamSide(selectedMatch, teamId);
    const payload = {
      teamId,
      xi: stripNonGkCleanSheets(xi),
      subs: stripNonGkCleanSheets(subs),
    };
    try {
      if (side) {
        await adminScoreboardApi.patchSpotter(matchId, {
          formation: { [side]: formation },
        });
      }
      await adminScoreboardApi.saveRoster(matchId, payload);
      toast.success("Matchday roster saved — player IDs linked to master directory");
      loadRoster();
    } catch (e) {
      toast.error(formatAdminScoreboardError(e));
    } finally {
      setSaving(false);
    }
  };

  const uploadSquadCsv = async (file: File) => {
    if (!matchId || !teamId) return;
    setCsvUploading(true);
    const side = selectedTeamSide(selectedMatch, teamId);
    try {
      const csv = await file.text();
      if (side) {
        await adminScoreboardApi.patchSpotter(matchId, {
          formation: { [side]: formation },
        });
      }
      const result = await adminScoreboardApi.uploadMatchSquadsCsv(matchId, teamId, csv);
      toast.success(
        `Imported ${result.imported} players (${result.starters} starters, ${result.bench} bench)`
      );
      loadRoster();
    } catch (e) {
      toast.error(formatAdminScoreboardError(e));
    } finally {
      setCsvUploading(false);
    }
  };

  const downloadSquadTemplate = () => {
    const csv = [
      "jersey_number,player_name,position,is_starter,date_of_birth,image_url",
      "1,Player Name,GK,TRUE,2009-01-31,https://example.com/player-photo.jpg",
      "9,Striker Name,ST,TRUE,31-January-2009,",
      "14,Bench Player,MF,FALSE,,",
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "match-squad-template.csv";
    a.click();
    URL.revokeObjectURL(url);
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
              <input
                type="search"
                value={matchSearch}
                onChange={(e) => setMatchSearch(e.target.value)}
                placeholder="Search fixtures"
                aria-label="Search fixtures"
              />
              <select
                value={filteredMatches.some((m) => m.id === matchId) ? matchId : ""}
                onChange={(e) => setMatchId(e.target.value)}
                aria-label="Match"
              >
                {filteredMatches.length === 0 ? (
                  <option value="">No matching fixtures</option>
                ) : (
                  filteredMatches.map((m) => (
                    <option key={m.id} value={m.id}>
                      {formatMatchOptionLabel(m)}
                    </option>
                  ))
                )}
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

      {selectedMatch && (
        <div className="admin-sb-panel admin-sb-squad-upload">
          <div>
            <h3>Upload squad CSV</h3>
            <p className="muted">
              Replaces the selected team's matchday squad for this fixture. Required columns:
              jersey_number, player_name, position, is_starter. Optional columns: date_of_birth,
              image_url.
            </p>
          </div>
          <div className="admin-sb-squad-upload__actions">
            <label className="admin-sb-formation-select">
              Formation
              <select
                value={formation}
                onChange={(e) => setFormation(e.target.value as MatchFormation)}
                aria-label="Team formation"
              >
                {FORMATION_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="admin-inline-button" onClick={downloadSquadTemplate}>
              Download template
            </button>
            <button
              type="button"
              className="admin-inline-button admin-inline-button--primary"
              disabled={csvUploading || loading || !teamId}
              onClick={() => squadCsvInputRef.current?.click()}
            >
              {csvUploading ? "Uploading…" : "Upload CSV"}
            </button>
            <input
              ref={squadCsvInputRef}
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadSquadCsv(file);
                e.target.value = "";
              }}
            />
          </div>
        </div>
      )}

      {loading ? (
        <div className="admin-sb-roster-split admin-sb-roster-split--loading">
          <div className="admin-sb-skeleton admin-sb-skeleton--panel" />
          <div className="admin-sb-skeleton admin-sb-skeleton--panel" />
        </div>
      ) : (
        <div className="admin-sb-roster-split">
          <div className="admin-sb-directory admin-sb-panel">
            <div className="admin-sb-directory__header">
              <h3>Club directory</h3>
              <input
                type="search"
                value={playerSearch}
                onChange={(e) => setPlayerSearch(e.target.value)}
                placeholder="Search players"
                aria-label="Search club directory players"
              />
            </div>
            {directory.length === 0 ? (
              <p className="admin-sb-empty muted">No squad rows for this team.</p>
            ) : filteredDirectory.length === 0 ? (
              <p className="admin-sb-empty muted">No players match that search.</p>
            ) : (
              <ul>
                {filteredDirectory.map((row) => (
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
