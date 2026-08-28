import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { adminScoreboardApi } from "../../../../api/admin-scoreboard";
import { usePageTitle } from "../../../../hooks/usePageTitle";
import { useAdminToast } from "../../components/AdminToast";
import { AdminSbPageHeader } from "../components/AdminSbPageHeader";
import { AdminSbTableShell } from "../components/AdminSbTableShell";
import { CsvDropzone } from "../components/CsvDropzone";
import type { AdminSbPlayerDirectoryRow, AdminSbTeam } from "../types";

const TEAM_SQUAD_CSV_TEMPLATE = `shirtNumber,displayName,position
1,Goalkeeper Name,GK
2,Right Back Name,RB
9,Striker Name,ST
`;

type CompetitionOption = {
  id: string;
  name: string;
  slug: string;
  season: string;
};

type SquadTeamEntry = AdminSbPlayerDirectoryRow["teams"][number];

export function AdminScoreboardSquadUploadPage() {
  usePageTitle("Admin - Squad upload");
  const toast = useAdminToast();
  const [competitions, setCompetitions] = useState<CompetitionOption[]>([]);
  const [competitionId, setCompetitionId] = useState("");
  const [teams, setTeams] = useState<AdminSbTeam[]>([]);
  const [teamId, setTeamId] = useState("");
  const [players, setPlayers] = useState<AdminSbPlayerDirectoryRow[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [playersLoading, setPlayersLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    adminScoreboardApi
      .competitionPicker()
      .then((rows) => {
        if (cancelled) return;
        setCompetitions(rows);
        setCompetitionId((current) =>
          current && rows.some((row) => row.id === current) ? current : rows[0]?.id ?? ""
        );
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load competitions"));
    return () => {
      cancelled = true;
    };
  }, [toast]);

  useEffect(() => {
    if (!competitionId) {
      setTeams([]);
      setTeamId("");
      return;
    }
    let cancelled = false;
    setTeamsLoading(true);
    adminScoreboardApi
      .teams({ competitionId })
      .then((rows) => {
        if (cancelled) return;
        setTeams(rows);
        setTeamId((current) =>
          current && rows.some((row) => row.id === current) ? current : rows[0]?.id ?? ""
        );
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load teams"))
      .finally(() => {
        if (!cancelled) setTeamsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [competitionId, toast]);

  const loadPlayers = useCallback(async () => {
    setPlayersLoading(true);
    try {
      const rows = await adminScoreboardApi.players();
      setPlayers(rows);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load squad rows");
    } finally {
      setPlayersLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadPlayers();
  }, [loadPlayers]);

  const selectedCompetition = competitions.find((row) => row.id === competitionId) ?? null;
  const selectedTeam = teams.find((row) => row.id === teamId) ?? null;

  const squadRows = useMemo(
    () =>
      players
        .map((player) => ({
          player,
          team: player.teams.find((team) => team.teamId === teamId) ?? null,
        }))
        .filter(
          (entry): entry is { player: AdminSbPlayerDirectoryRow; team: SquadTeamEntry } =>
            Boolean(entry.team)
        )
        .sort((a, b) => {
          const aNumber = a.team.shirtNumber ?? 9999;
          const bNumber = b.team.shirtNumber ?? 9999;
          if (aNumber !== bNumber) return aNumber - bNumber;
          return a.player.displayName.localeCompare(b.player.displayName);
        }),
    [players, teamId]
  );

  return (
    <div className="admin-sb-section">
      <AdminSbPageHeader
        title="Team squad import"
        crumbs={[{ label: "Squad upload" }]}
        description="Upload permanent team squad rows from one ScoreBoard workspace."
      />

      <div className="admin-sb-sticky-bar">
        <div className="admin-filters">
          <label>
            Competition
            <select
              value={competitionId}
              onChange={(e) => {
                setCompetitionId(e.target.value);
                setTeamId("");
              }}
            >
              {competitions.map((competition) => (
                <option key={competition.id} value={competition.id}>
                  {competition.name} ({competition.season})
                </option>
              ))}
            </select>
          </label>
          <label>
            Team
            <select
              value={teamId}
              disabled={!competitionId || teamsLoading || teams.length === 0}
              onChange={(e) => setTeamId(e.target.value)}
            >
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="admin-inline-button"
            disabled={playersLoading}
            onClick={() => void loadPlayers()}
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="admin-sb-seed-grid">
        <CsvDropzone
          label="Team squad"
          hint="CSV headers: displayName/name, shirtNumber/number, position."
          disabled={!teamId}
          disabledReason="Select a competition and team before importing squad rows."
          templateCsv={TEAM_SQUAD_CSV_TEMPLATE}
          templateFileName="team-squad-template.csv"
          onExport={async () => {
            if (!competitionId) throw new Error("Select a competition before exporting squads");
            const result = await adminScoreboardApi.exportCompetitionSquad(competitionId, "csv");
            return result.csv ?? "";
          }}
          onImport={async (csv) => {
            if (!teamId) throw new Error("Select a team before importing squad rows");
            const result = await adminScoreboardApi.importSquadCsv(teamId, csv);
            toast.success(`Imported ${result.imported} squad row(s)`);
            await loadPlayers();
          }}
        />

        <div className="admin-sb-panel">
          <strong>{selectedTeam?.name ?? "Select a team"}</strong>
          <p className="muted">
            {selectedCompetition
              ? `${selectedCompetition.name} (${selectedCompetition.season})`
              : "No competition selected"}
          </p>
          <div className="admin-sb-mini-grid">
            <span>
              <strong>{teams.length}</strong>
              Teams
            </span>
            <span>
              <strong>{squadRows.length}</strong>
              Squad rows
            </span>
          </div>
        </div>
      </div>

      <div className="admin-sb-content-panel">
        <div className="admin-sb-section-head">
          <div>
            <h3>Current squad</h3>
            <p className="muted">{selectedTeam?.name ?? "Choose a team to view squad rows"}</p>
          </div>
        </div>
        <AdminSbTableShell
          columns={5}
          loading={playersLoading}
          empty={!teamId || squadRows.length === 0}
          emptyTitle={teamId ? "No squad rows yet" : "No team selected"}
          emptyHint={teamId ? "Upload a CSV to add players to this team." : undefined}
        >
          <table className="admin-table admin-sb-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Player</th>
                <th>Position</th>
                <th>Competition</th>
                <th>Profile</th>
              </tr>
            </thead>
            <tbody>
              {squadRows.map(({ player, team }) => (
                <tr key={team.squadId}>
                  <td>{team.shirtNumber ?? "-"}</td>
                  <td>{player.displayName}</td>
                  <td>{team.position ?? player.positionPrimary ?? "-"}</td>
                  <td>{team.competitionName}</td>
                  <td>
                    {player.slug ? (
                      <Link className="admin-inline-link" to={`/players/${player.slug}`}>
                        View
                      </Link>
                    ) : (
                      <span className="muted">Unlinked</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </AdminSbTableShell>
      </div>
    </div>
  );
}
