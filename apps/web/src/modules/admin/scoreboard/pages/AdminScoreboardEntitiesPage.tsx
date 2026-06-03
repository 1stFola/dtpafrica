import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { adminScoreboardApi } from "../../../../api/admin-scoreboard";
import { useDebouncedValue } from "../../../../hooks/useDebouncedValue";
import { usePageTitle } from "../../../../hooks/usePageTitle";
import { useAdminToast } from "../../components/AdminToast";
import { formatAdminScoreboardError } from "../admin-scoreboard-utils";
import { AdminSbPageHeader } from "../components/AdminSbPageHeader";
import { AdminSbTableShell } from "../components/AdminSbTableShell";
import { CreateCompetitionModal } from "../components/CreateCompetitionModal";
import { CsvDropzone } from "../components/CsvDropzone";
import { StatusBadge } from "../components/StatusBadge";
import { useAdminScoreboardContext } from "../AdminScoreboardLayout";
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
  const toast = useAdminToast();
  const { refreshStats } = useAdminScoreboardContext();
  const [tab, setTab] = useState<Tab>("competitions");
  const [competitions, setCompetitions] = useState<AdminSbCompetition[]>([]);
  const [teams, setTeams] = useState<AdminSbTeam[]>([]);
  const [players, setPlayers] = useState<AdminSbPlayerDirectoryRow[]>([]);
  const [picker, setPicker] = useState<Array<{ id: string; name: string }>>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [q, setQ] = useState("");
  const [teamQ, setTeamQ] = useState("");
  const [playerQ, setPlayerQ] = useState("");
  const [seedCompId, setSeedCompId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [loading, setLoading] = useState<Record<Tab, boolean>>({
    competitions: false,
    teams: false,
    players: false,
    seeders: false,
  });
  const loadedRef = useRef<Record<Tab, boolean>>({
    competitions: false,
    teams: false,
    players: false,
    seeders: false,
  });

  const debouncedQ = useDebouncedValue(q);
  const debouncedTeamQ = useDebouncedValue(teamQ);
  const debouncedPlayerQ = useDebouncedValue(playerQ);

  const loadCompetitions = useCallback(async () => {
    setLoading((s) => ({ ...s, competitions: true }));
    try {
      const rows = await adminScoreboardApi.competitions({
        status: statusFilter || undefined,
        type: typeFilter || undefined,
        q: debouncedQ || undefined,
      });
      setCompetitions(rows);
      loadedRef.current.competitions = true;
    } catch {
      setCompetitions([]);
    } finally {
      setLoading((s) => ({ ...s, competitions: false }));
    }
  }, [statusFilter, typeFilter, debouncedQ]);

  const loadTeams = useCallback(async () => {
    setLoading((s) => ({ ...s, teams: true }));
    try {
      const rows = await adminScoreboardApi.teams({ q: debouncedTeamQ || undefined });
      setTeams(rows);
      loadedRef.current.teams = true;
    } catch {
      setTeams([]);
    } finally {
      setLoading((s) => ({ ...s, teams: false }));
    }
  }, [debouncedTeamQ]);

  const loadPlayers = useCallback(async () => {
    setLoading((s) => ({ ...s, players: true }));
    try {
      const rows = await adminScoreboardApi.players(debouncedPlayerQ || undefined);
      setPlayers(rows);
      loadedRef.current.players = true;
    } catch {
      setPlayers([]);
    } finally {
      setLoading((s) => ({ ...s, players: false }));
    }
  }, [debouncedPlayerQ]);

  const loadPicker = useCallback(async () => {
    setLoading((s) => ({ ...s, seeders: true }));
    try {
      const rows = await adminScoreboardApi.competitionPicker();
      setPicker(rows);
      if (rows[0] && !seedCompId) setSeedCompId(rows[0].id);
      loadedRef.current.seeders = true;
    } finally {
      setLoading((s) => ({ ...s, seeders: false }));
    }
  }, [seedCompId]);

  useEffect(() => {
    if (tab === "competitions") void loadCompetitions();
  }, [tab, loadCompetitions]);

  useEffect(() => {
    if (tab === "teams") void loadTeams();
  }, [tab, loadTeams]);

  useEffect(() => {
    if (tab === "players") void loadPlayers();
  }, [tab, loadPlayers]);

  useEffect(() => {
    if (tab === "seeders" && !loadedRef.current.seeders) void loadPicker();
  }, [tab, loadPicker]);

  const playerPath = (slug: string | null, displayName: string) =>
    slug ? `/player/${slug}` : `/player/${encodeURIComponent(displayName.toLowerCase().replace(/\s+/g, "-"))}`;

  return (
    <section className="admin-sb-section">
      <AdminSbPageHeader
        title="Master records"
        description="Competitions, clubs, player directory, and CSV import/export tools."
        crumbs={[{ label: "Entities" }]}
        actions={
          tab === "competitions" ? (
            <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
              Create competition
            </button>
          ) : undefined
        }
      />

      <div className="admin-sb-tabs admin-sb-tabs--pill" role="tablist">
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

      <CreateCompetitionModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          toast.success("Competition created");
          loadedRef.current.competitions = false;
          void loadCompetitions();
          void refreshStats();
        }}
      />

      {tab === "competitions" && (
        <>
          <div className="admin-sb-sticky-bar">
            <div className="admin-filters admin-filters--with-action">
              <input
                type="search"
                placeholder="Search name, slug, region…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label="Search competitions"
              />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="Filter by status"
              >
                <option value="">All statuses</option>
                {COMPETITION_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                aria-label="Filter by type"
              >
                <option value="">All types</option>
                {COMPETITION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="admin-sb-content-panel">
          <AdminSbTableShell
            loading={loading.competitions}
            empty={!loading.competitions && competitions.length === 0}
            emptyTitle="No competitions match your filters"
            emptyHint="Create a competition or adjust search filters."
            columns={6}
          >
            <table className="admin-table admin-sb-table">
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
                    <td>
                      <code className="admin-sb-code">{c.formatType ?? "—"}</code>
                    </td>
                    <td>{c.region ?? "—"}</td>
                    <td>{c.teamsCount}</td>
                    <td>
                      <StatusBadge status={c.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminSbTableShell>
          </div>
        </>
      )}

      {tab === "teams" && (
        <>
          <div className="admin-sb-sticky-bar">
            <div className="admin-filters">
              <input
                type="search"
                placeholder="Search clubs…"
                value={teamQ}
                onChange={(e) => setTeamQ(e.target.value)}
                aria-label="Search teams"
              />
            </div>
          </div>
          <div className="admin-sb-content-panel">
          <AdminSbTableShell
            loading={loading.teams}
            empty={!loading.teams && teams.length === 0}
            emptyTitle="No teams found"
            columns={4}
          >
            <table className="admin-table admin-sb-table">
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
          </AdminSbTableShell>
          </div>
        </>
      )}

      {tab === "players" && (
        <>
          <div className="admin-sb-sticky-bar">
            <div className="admin-filters">
              <input
                type="search"
                placeholder="Search players in scoreboard squads…"
                value={playerQ}
                onChange={(e) => setPlayerQ(e.target.value)}
                aria-label="Search players"
              />
            </div>
          </div>
          <div className="admin-sb-content-panel">
          <AdminSbTableShell
            loading={loading.players}
            empty={!loading.players && players.length === 0}
            emptyTitle="No players in directory"
            emptyHint="Import squad CSV per team or link players when saving rosters."
            columns={4}
          >
            <table className="admin-table admin-sb-table">
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
                    <td className="admin-sb-clubs-cell">
                      {p.teams.map((t) => t.teamName).join(", ")}
                    </td>
                    <td>
                      <Link to={playerPath(p.slug, p.displayName)} className="text-link">
                        Profile
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminSbTableShell>
          </div>
        </>
      )}

      {tab === "seeders" && (
        <div className="admin-sb-seed-grid">
          <CsvDropzone
            label="Competitions"
            hint='Headers: name, type, region, status, isFeatured'
            onExport={async () => (await adminScoreboardApi.exportCompetitionsCsv()).csv}
            onImport={async (csv) => {
              try {
                const r = await adminScoreboardApi.importCompetitionsCsv(csv);
                toast.success(`Imported ${r.imported} competition(s)`);
                loadedRef.current.competitions = false;
                void refreshStats();
              } catch (e) {
                throw new Error(formatAdminScoreboardError(e));
              }
            }}
          />
          <CsvDropzone
            label="Teams"
            hint="Headers: name, slug, region — pick competition below"
            onExport={async () =>
              (await adminScoreboardApi.exportTeamsCsv(seedCompId || undefined)).csv
            }
            onImport={async (csv) => {
              if (!seedCompId) throw new Error("Select a competition before importing teams");
              try {
                const r = await adminScoreboardApi.importTeamsCsv(csv, seedCompId);
                toast.success(`Imported ${r.imported} team(s)`);
                void refreshStats();
              } catch (e) {
                throw new Error(formatAdminScoreboardError(e));
              }
            }}
          />
          <label className="admin-sb-field admin-sb-panel">
            <span>Team import competition</span>
            <select
              value={seedCompId}
              onChange={(e) => setSeedCompId(e.target.value)}
              disabled={loading.seeders}
            >
              <option value="">Select…</option>
              {picker.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {seedCompId && (
            <div className="admin-sb-export-actions admin-sb-panel">
              <p className="muted admin-sb-export-hint">
                Export full squad directory for Calibration Engine V3
              </p>
              <button
                type="button"
                className="admin-inline-button"
                onClick={async () => {
                  const r = await adminScoreboardApi.exportCompetitionSquad(seedCompId, "json");
                  const blob = new Blob([JSON.stringify(r.rows ?? r, null, 2)], {
                    type: "application/json",
                  });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `squad-${seedCompId}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                  toast.success("Squad directory exported (JSON)");
                }}
              >
                Export JSON
              </button>
              <button
                type="button"
                className="admin-inline-button"
                onClick={async () => {
                  const r = await adminScoreboardApi.exportCompetitionSquad(seedCompId, "csv");
                  const blob = new Blob([r.csv ?? ""], { type: "text/csv" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `squad-${seedCompId}.csv`;
                  a.click();
                  URL.revokeObjectURL(url);
                  toast.success("Squad directory exported (CSV)");
                }}
              >
                Export CSV
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
