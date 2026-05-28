import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { adminScoreboardApi } from "../../../../api/admin-scoreboard";
import { usePageTitle } from "../../../../hooks/usePageTitle";
import { CreateCompetitionModal } from "../components/CreateCompetitionModal";
import { CsvDropzone } from "../components/CsvDropzone";
import { StatusBadge } from "../components/StatusBadge";
import {
  COMPETITION_STATUSES,
  COMPETITION_TYPES,
  type AdminSbCompetition,
  type AdminSbPlayerDirectoryRow,
  type AdminSbTeam,
} from "../types";

type Tab = "competitions" | "teams" | "players" | "seeders";

export function AdminScoreboardEntitiesPage() {
  usePageTitle("Admin — ScoreBoard entities");
  const [tab, setTab] = useState<Tab>("competitions");
  const [competitions, setCompetitions] = useState<AdminSbCompetition[]>([]);
  const [teams, setTeams] = useState<AdminSbTeam[]>([]);
  const [players, setPlayers] = useState<AdminSbPlayerDirectoryRow[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [q, setQ] = useState("");
  const [teamQ, setTeamQ] = useState("");
  const [playerQ, setPlayerQ] = useState("");
  const [seedCompId, setSeedCompId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const loadCompetitions = useCallback(() => {
    adminScoreboardApi
      .competitions({
        status: statusFilter || undefined,
        type: typeFilter || undefined,
        q: q || undefined,
      })
      .then(setCompetitions)
      .catch(() => {});
  }, [statusFilter, typeFilter, q]);

  const loadTeams = useCallback(() => {
    adminScoreboardApi.teams({ q: teamQ || undefined }).then(setTeams).catch(() => {});
  }, [teamQ]);

  const loadPlayers = useCallback(() => {
    adminScoreboardApi.players(playerQ || undefined).then(setPlayers).catch(() => {});
  }, [playerQ]);

  useEffect(() => {
    if (tab === "competitions") loadCompetitions();
  }, [tab, loadCompetitions]);

  useEffect(() => {
    if (tab === "teams") loadTeams();
  }, [tab, loadTeams]);

  useEffect(() => {
    if (tab === "players") loadPlayers();
  }, [tab, loadPlayers]);

  useEffect(() => {
    adminScoreboardApi.competitions().then((rows) => {
      setCompetitions(rows);
      if (rows[0]) setSeedCompId(rows[0].id);
    });
  }, []);

  const playerPath = (slug: string | null, displayName: string) =>
    slug ? `/player/${slug}` : `/player/${encodeURIComponent(displayName.toLowerCase().replace(/\s+/g, "-"))}`;

  return (
    <section className="admin-sb-section">
      <div className="admin-sb-tabs" role="tablist">
        {(
          [
            ["competitions", "Competitions"],
            ["teams", "Teams"],
            ["players", "Players"],
            ["seeders", "CSV seeders"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "admin-sb-tab active" : "admin-sb-tab"}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {message && <p className="admin-sb-msg">{message}</p>}

      <CreateCompetitionModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setMessage("Competition created");
          loadCompetitions();
        }}
      />

      {tab === "competitions" && (
        <>
          <div className="admin-filters admin-filters--with-action">
            <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
              Create competition
            </button>
            <input
              type="search"
              placeholder="Search competitions…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              {COMPETITION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">All types</option>
              {COMPETITION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Format</th>
                  <th>Region</th>
                  <th>Teams</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {competitions.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td>{c.type}</td>
                    <td>{c.formatType ?? "—"}</td>
                    <td>{c.region ?? "—"}</td>
                    <td>{c.teamsCount}</td>
                    <td>
                      <StatusBadge status={c.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "teams" && (
        <>
          <div className="admin-filters">
            <input
              type="search"
              placeholder="Search clubs…"
              value={teamQ}
              onChange={(e) => setTeamQ(e.target.value)}
            />
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Club</th>
                  <th>Competition</th>
                  <th>Region</th>
                  <th>Squad</th>
                </tr>
              </thead>
              <tbody>
                {teams.map((t) => (
                  <tr key={t.id}>
                    <td>{t.name}</td>
                    <td>{t.competition.name}</td>
                    <td>{t.region ?? "—"}</td>
                    <td>{t.squadCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "players" && (
        <>
          <div className="admin-filters">
            <input
              type="search"
              placeholder="Quick-search master directory…"
              value={playerQ}
              onChange={(e) => setPlayerQ(e.target.value)}
            />
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Position</th>
                  <th>Clubs</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {players.map((p) => (
                  <tr key={p.playerId ?? p.slug ?? p.displayName}>
                    <td>{p.displayName}</td>
                    <td>{p.positionPrimary ?? "—"}</td>
                    <td>{p.teams.map((t) => t.teamName).join(", ")}</td>
                    <td>
                      <Link to={playerPath(p.slug, p.displayName)} className="text-link">
                        Open profile
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "seeders" && (
        <div className="admin-sb-seed-grid">
          <CsvDropzone
            label="Competitions"
            hint="Headers: name, type, region, status, logo, isFeatured"
            onExport={async () => (await adminScoreboardApi.exportCompetitionsCsv()).csv}
            onImport={async (csv) => {
              const r = await adminScoreboardApi.importCompetitionsCsv(csv);
              setMessage(`Imported ${r.imported} competitions`);
              loadCompetitions();
            }}
          />
          <CsvDropzone
            label="Teams"
            hint="Headers: name, slug, region, competitionSlug, logo — select competition below"
            onExport={async () =>
              (await adminScoreboardApi.exportTeamsCsv(seedCompId || undefined)).csv
            }
            onImport={async (csv) => {
              if (!seedCompId) throw new Error("Select a competition for team import");
              const r = await adminScoreboardApi.importTeamsCsv(csv, seedCompId);
              setMessage(`Imported ${r.imported} teams`);
              loadTeams();
            }}
          />
          <label className="admin-sb-field">
            Team import competition
            <select value={seedCompId} onChange={(e) => setSeedCompId(e.target.value)}>
              <option value="">Select…</option>
              {competitions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {seedCompId && (
            <div className="admin-sb-export-actions">
              <button
                type="button"
                className="admin-inline-button"
                onClick={async () => {
                  const r = await adminScoreboardApi.exportCompetitionSquad(
                    seedCompId,
                    "json"
                  );
                  const blob = new Blob([JSON.stringify(r.rows ?? r, null, 2)], {
                    type: "application/json",
                  });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `squad-${seedCompId}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                  setMessage("Squad directory exported (JSON) for Calibration Engine V3");
                }}
              >
                Export squad directory (JSON)
              </button>
              <button
                type="button"
                className="admin-inline-button"
                onClick={async () => {
                  const r = await adminScoreboardApi.exportCompetitionSquad(
                    seedCompId,
                    "csv"
                  );
                  const blob = new Blob([r.csv ?? ""], { type: "text/csv" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `squad-${seedCompId}.csv`;
                  a.click();
                  URL.revokeObjectURL(url);
                  setMessage("Squad directory exported (CSV)");
                }}
              >
                Export squad directory (CSV)
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
