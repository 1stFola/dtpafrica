import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { adminScoreboardApi } from "../../../../api/admin-scoreboard";
import { useDebouncedValue } from "../../../../hooks/useDebouncedValue";
import { usePageTitle } from "../../../../hooks/usePageTitle";
import { useAdminToast } from "../../components/AdminToast";
import type { SbMatchListItem } from "../../../../api/scoreboard";
import {
  formatKickoffWat,
  formatAdminScoreboardError,
  kickoffAtToWatParts,
  sortRosterMatches,
} from "../admin-scoreboard-utils";
import { AdminSbPageHeader } from "../components/AdminSbPageHeader";
import { AdminSbTableShell } from "../components/AdminSbTableShell";
import { CreateCompetitionModal } from "../components/CreateCompetitionModal";
import { FixtureFormModal } from "../components/FixtureFormModal";
import { TeamFormModal } from "../components/TeamFormModal";
import { CsvDropzone } from "../components/CsvDropzone";
import { StatusBadge } from "../components/StatusBadge";
import { useAdminScoreboardContext } from "../AdminScoreboardLayout";
import {
  COMPETITION_STATUSES,
  COMPETITION_TYPES,
  type AdminSbCompetition,
  type AdminSbCompetitionInput,
  type AdminSbPlayerDirectoryRow,
  type AdminSbSquadRowInput,
  type AdminSbTeam,
} from "../types";

type Tab = "competitions" | "teams" | "fixtures" | "players" | "seeders";
type FixtureEditState = {
  match: SbMatchListItem;
  venue: string;
  kickoffDate: string;
  kickoffTime: string;
  roundLabel: string;
};

type CompetitionEditState = {
  competition: AdminSbCompetition;
  draft: AdminSbCompetitionInput;
};

type SquadEditState = {
  row: AdminSbPlayerDirectoryRow;
  squadId: string;
  draft: AdminSbSquadRowInput;
};

export function AdminScoreboardEntitiesPage() {
  usePageTitle("Admin — ScoreBoard entities");
  const toast = useAdminToast();
  const { refreshStats } = useAdminScoreboardContext();
  const [tab, setTab] = useState<Tab>("competitions");
  const [competitions, setCompetitions] = useState<AdminSbCompetition[]>([]);
  const [teams, setTeams] = useState<AdminSbTeam[]>([]);
  const [fixtures, setFixtures] = useState<SbMatchListItem[]>([]);
  const [fixtureCompId, setFixtureCompId] = useState("");
  const [players, setPlayers] = useState<AdminSbPlayerDirectoryRow[]>([]);
  const [playerTeamOptions, setPlayerTeamOptions] = useState<AdminSbTeam[]>([]);
  const [picker, setPicker] = useState<Array<{ id: string; name: string }>>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [q, setQ] = useState("");
  const [teamQ, setTeamQ] = useState("");
  const [playerQ, setPlayerQ] = useState("");
  const [seedCompId, setSeedCompId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [fixtureOpen, setFixtureOpen] = useState(false);
  const [editingFixture, setEditingFixture] = useState<FixtureEditState | null>(null);
  const [editingCompetition, setEditingCompetition] =
    useState<CompetitionEditState | null>(null);
  const [editingSquadRow, setEditingSquadRow] = useState<SquadEditState | null>(null);
  const [fixtureSaving, setFixtureSaving] = useState(false);
  const [competitionSaving, setCompetitionSaving] = useState(false);
  const [squadSaving, setSquadSaving] = useState(false);
  const [teamModal, setTeamModal] = useState<"create" | "edit" | null>(null);
  const [editingTeam, setEditingTeam] = useState<AdminSbTeam | null>(null);
  const [competitionOptions, setCompetitionOptions] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [loading, setLoading] = useState<Record<Tab, boolean>>({
    competitions: false,
    teams: false,
    fixtures: false,
    players: false,
    seeders: false,
  });
  const loadedRef = useRef<Record<Tab, boolean>>({
    competitions: false,
    teams: false,
    fixtures: false,
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

  const loadFixtures = useCallback(async () => {
    setLoading((s) => ({ ...s, fixtures: true }));
    try {
      const rows = await adminScoreboardApi.matches(fixtureCompId || undefined);
      setFixtures(sortRosterMatches(rows));
      loadedRef.current.fixtures = true;
    } catch {
      setFixtures([]);
    } finally {
      setLoading((s) => ({ ...s, fixtures: false }));
    }
  }, [fixtureCompId]);

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

  const openFixtureEditor = (match: SbMatchListItem) => {
    const parts = kickoffAtToWatParts(match.kickoffAt);
    setEditingFixture({
      match,
      venue: match.venue ?? "",
      kickoffDate: parts.date,
      kickoffTime: parts.time,
      roundLabel: match.roundLabel ?? "",
    });
  };

  const openCompetitionEditor = (competition: AdminSbCompetition) => {
    setEditingCompetition({
      competition,
      draft: {
        name: competition.name,
        slug: competition.slug,
        season: competition.season,
        type: competition.type,
        formatType: competition.formatType ?? "",
        country: competition.region ?? "",
        description: "",
        isPublished: competition.isPublished,
      },
    });
  };

  const openSquadEditor = (row: AdminSbPlayerDirectoryRow) => {
    const team = row.teams[0];
    if (!team) return;
    setEditingSquadRow({
      row,
      squadId: team.squadId,
      draft: {
        teamId: team.teamId,
        displayName: row.displayName,
        position: team.position ?? row.positionPrimary ?? "",
        shirtNumber: team.shirtNumber,
      },
    });
  };

  const saveCompetitionEdit = async () => {
    if (!editingCompetition) return;
    const draft = editingCompetition.draft;
    if (!draft.name.trim() || !draft.season.trim()) {
      toast.error("Competition name and season are required");
      return;
    }

    setCompetitionSaving(true);
    try {
      await adminScoreboardApi.updateCompetition(editingCompetition.competition.id, {
        ...draft,
        name: draft.name.trim(),
        slug: draft.slug?.trim() || undefined,
        season: draft.season.trim(),
        type: draft.type.trim() || "tournament",
        formatType: draft.formatType?.trim() || undefined,
        country: draft.country?.trim() || undefined,
        description: draft.description?.trim() || undefined,
      });
      toast.success("Competition updated");
      setEditingCompetition(null);
      loadedRef.current.competitions = false;
      void loadCompetitions();
      void refreshStats();
    } catch (e) {
      toast.error(formatAdminScoreboardError(e));
    } finally {
      setCompetitionSaving(false);
    }
  };

  const saveSquadEdit = async () => {
    if (!editingSquadRow) return;
    const draft = editingSquadRow.draft;
    if (!draft.displayName.trim()) {
      toast.error("Player name is required");
      return;
    }

    setSquadSaving(true);
    try {
      await adminScoreboardApi.updateSquadRow(editingSquadRow.squadId, {
        teamId: draft.teamId,
        displayName: draft.displayName.trim(),
        position: draft.position?.trim() || undefined,
        shirtNumber:
          draft.shirtNumber == null || Number.isNaN(Number(draft.shirtNumber))
            ? null
            : Number(draft.shirtNumber),
      });
      toast.success("Scoreboard player updated");
      setEditingSquadRow(null);
      void loadPlayers();
      void refreshStats();
    } catch (e) {
      toast.error(formatAdminScoreboardError(e));
    } finally {
      setSquadSaving(false);
    }
  };

  const saveFixtureEdit = async () => {
    if (!editingFixture) return;
    if (!editingFixture.kickoffDate || !editingFixture.kickoffTime) {
      toast.error("Kickoff date and time are required (WAT)");
      return;
    }

    setFixtureSaving(true);
    try {
      const res = await adminScoreboardApi.patchMatchGameday(editingFixture.match.id, {
        venue: editingFixture.venue,
        kickoffDate: editingFixture.kickoffDate,
        kickoffTime: editingFixture.kickoffTime,
        roundLabel: editingFixture.roundLabel,
      });
      setFixtures((rows) =>
        rows.map((row) =>
          row.id === editingFixture.match.id
            ? {
                ...row,
                venue: res.match.venue,
                kickoffAt: res.match.kickoffAt,
                roundLabel: res.match.roundLabel,
              }
            : row
        )
      );
      toast.success("Fixture details updated");
      setEditingFixture(null);
    } catch (e) {
      toast.error(formatAdminScoreboardError(e));
    } finally {
      setFixtureSaving(false);
    }
  };

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
    if (tab === "teams" || teamModal || tab === "fixtures" || fixtureOpen) {
      adminScoreboardApi.competitionPicker().then(setCompetitionOptions).catch(() => {});
    }
  }, [tab, teamModal, fixtureOpen]);

  useEffect(() => {
    if (tab === "fixtures" && competitionOptions.length && !fixtureCompId) {
      setFixtureCompId(competitionOptions[0].id);
    }
  }, [tab, competitionOptions, fixtureCompId]);

  useEffect(() => {
    if (tab === "teams") void loadTeams();
  }, [tab, loadTeams]);

  useEffect(() => {
    if (tab === "fixtures") void loadFixtures();
  }, [tab, loadFixtures]);

  useEffect(() => {
    if (tab === "players") void loadPlayers();
  }, [tab, loadPlayers]);

  useEffect(() => {
    if (tab !== "players") return;
    adminScoreboardApi
      .teams()
      .then(setPlayerTeamOptions)
      .catch(() => setPlayerTeamOptions([]));
  }, [tab]);

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
          ) : tab === "teams" ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setEditingTeam(null);
                setTeamModal("create");
              }}
            >
              Create team
            </button>
          ) : tab === "fixtures" ? (
            <button type="button" className="btn btn-primary" onClick={() => setFixtureOpen(true)}>
              Create fixture
            </button>
          ) : undefined
        }
      />

      <div className="admin-sb-tabs admin-sb-tabs--pill" role="tablist">
        {(
          [
            ["competitions", "Competitions"],
            ["teams", "Teams"],
            ["fixtures", "Fixtures"],
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

      <TeamFormModal
        open={teamModal !== null}
        mode={teamModal === "edit" ? "edit" : "create"}
        team={editingTeam}
        competitions={competitionOptions}
        onClose={() => {
          setTeamModal(null);
          setEditingTeam(null);
        }}
        onSaved={() => {
          toast.success(teamModal === "edit" ? "Team updated" : "Team created");
          loadedRef.current.teams = false;
          void loadTeams();
          void refreshStats();
        }}
      />

      <FixtureFormModal
        open={fixtureOpen}
        competitions={competitionOptions}
        initialCompetitionId={fixtureCompId || undefined}
        onClose={() => setFixtureOpen(false)}
        onCreated={() => {
          loadedRef.current.fixtures = false;
          void loadFixtures();
          void refreshStats();
        }}
      />

      {editingCompetition && (
        <div
          className="admin-sb-modal-backdrop"
          role="presentation"
          onClick={() => {
            if (!competitionSaving) setEditingCompetition(null);
          }}
        >
          <div
            className="admin-sb-modal"
            role="dialog"
            aria-labelledby="competition-edit-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="admin-sb-modal__header">
              <h2 id="competition-edit-title">Edit competition</h2>
              <button
                type="button"
                className="admin-sb-modal__close"
                onClick={() => setEditingCompetition(null)}
                disabled={competitionSaving}
                aria-label="Close competition editor"
              >
                ×
              </button>
            </header>
            <form
              className="admin-sb-modal__body"
              onSubmit={(e) => {
                e.preventDefault();
                void saveCompetitionEdit();
              }}
            >
              <label className="admin-sb-field">
                <span>Name</span>
                <input
                  value={editingCompetition.draft.name}
                  onChange={(e) =>
                    setEditingCompetition((current) =>
                      current
                        ? { ...current, draft: { ...current.draft, name: e.target.value } }
                        : current
                    )
                  }
                  required
                />
              </label>
              <label className="admin-sb-field">
                <span>Slug</span>
                <input
                  value={editingCompetition.draft.slug ?? ""}
                  onChange={(e) =>
                    setEditingCompetition((current) =>
                      current
                        ? { ...current, draft: { ...current.draft, slug: e.target.value } }
                        : current
                    )
                  }
                />
              </label>
              <div className="admin-sb-gameday__datetime">
                <label className="admin-sb-field">
                  <span>Season</span>
                  <input
                    value={editingCompetition.draft.season}
                    onChange={(e) =>
                      setEditingCompetition((current) =>
                        current
                          ? { ...current, draft: { ...current.draft, season: e.target.value } }
                          : current
                      )
                    }
                    required
                  />
                </label>
                <label className="admin-sb-field">
                  <span>Type</span>
                  <select
                    value={editingCompetition.draft.type}
                    onChange={(e) =>
                      setEditingCompetition((current) =>
                        current
                          ? { ...current, draft: { ...current.draft, type: e.target.value } }
                          : current
                      )
                    }
                  >
                    {COMPETITION_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="admin-sb-field">
                <span>Format</span>
                <input
                  value={editingCompetition.draft.formatType ?? ""}
                  onChange={(e) =>
                    setEditingCompetition((current) =>
                      current
                        ? { ...current, draft: { ...current.draft, formatType: e.target.value } }
                        : current
                    )
                  }
                />
              </label>
              <label className="admin-sb-field">
                <span>Country / region</span>
                <input
                  value={editingCompetition.draft.country ?? ""}
                  onChange={(e) =>
                    setEditingCompetition((current) =>
                      current
                        ? { ...current, draft: { ...current.draft, country: e.target.value } }
                        : current
                    )
                  }
                />
              </label>
              <label className="admin-sb-check">
                <input
                  type="checkbox"
                  checked={Boolean(editingCompetition.draft.isPublished)}
                  onChange={(e) =>
                    setEditingCompetition((current) =>
                      current
                        ? {
                            ...current,
                            draft: { ...current.draft, isPublished: e.target.checked },
                          }
                        : current
                    )
                  }
                />
                Published
              </label>
              <footer className="admin-sb-modal__footer">
                <button
                  type="button"
                  onClick={() => setEditingCompetition(null)}
                  disabled={competitionSaving}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={competitionSaving}>
                  {competitionSaving ? "Saving..." : "Save competition"}
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}

      {editingSquadRow && (
        <div
          className="admin-sb-modal-backdrop"
          role="presentation"
          onClick={() => {
            if (!squadSaving) setEditingSquadRow(null);
          }}
        >
          <div
            className="admin-sb-modal"
            role="dialog"
            aria-labelledby="squad-edit-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="admin-sb-modal__header">
              <h2 id="squad-edit-title">Edit scoreboard player</h2>
              <button
                type="button"
                className="admin-sb-modal__close"
                onClick={() => setEditingSquadRow(null)}
                disabled={squadSaving}
                aria-label="Close player editor"
              >
                ×
              </button>
            </header>
            <form
              className="admin-sb-modal__body"
              onSubmit={(e) => {
                e.preventDefault();
                void saveSquadEdit();
              }}
            >
              <label className="admin-sb-field">
                <span>Team</span>
                <select
                  value={editingSquadRow.draft.teamId ?? ""}
                  onChange={(e) =>
                    setEditingSquadRow((current) =>
                      current
                        ? { ...current, draft: { ...current.draft, teamId: e.target.value } }
                        : current
                    )
                  }
                >
                  {playerTeamOptions.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name} · {team.competition.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="admin-sb-field">
                <span>Display name</span>
                <input
                  value={editingSquadRow.draft.displayName}
                  onChange={(e) =>
                    setEditingSquadRow((current) =>
                      current
                        ? {
                            ...current,
                            draft: { ...current.draft, displayName: e.target.value },
                          }
                        : current
                    )
                  }
                  required
                />
              </label>
              <div className="admin-sb-gameday__datetime">
                <label className="admin-sb-field">
                  <span>Position</span>
                  <input
                    value={editingSquadRow.draft.position ?? ""}
                    onChange={(e) =>
                      setEditingSquadRow((current) =>
                        current
                          ? {
                              ...current,
                              draft: { ...current.draft, position: e.target.value },
                            }
                          : current
                      )
                    }
                    placeholder="GK, CB, RW..."
                  />
                </label>
                <label className="admin-sb-field">
                  <span>Shirt number</span>
                  <input
                    type="number"
                    min={0}
                    max={999}
                    value={editingSquadRow.draft.shirtNumber ?? ""}
                    onChange={(e) =>
                      setEditingSquadRow((current) =>
                        current
                          ? {
                              ...current,
                              draft: {
                                ...current.draft,
                                shirtNumber: e.target.value === "" ? null : Number(e.target.value),
                              },
                            }
                          : current
                      )
                    }
                  />
                </label>
              </div>
              <footer className="admin-sb-modal__footer">
                <button type="button" onClick={() => setEditingSquadRow(null)} disabled={squadSaving}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={squadSaving}>
                  {squadSaving ? "Saving..." : "Save player"}
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}

      {editingFixture && (
        <div
          className="admin-sb-modal-backdrop"
          role="presentation"
          onClick={() => {
            if (!fixtureSaving) setEditingFixture(null);
          }}
        >
          <div
            className="admin-sb-modal"
            role="dialog"
            aria-labelledby="fixture-edit-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="admin-sb-modal__header">
              <h2 id="fixture-edit-title">Edit fixture</h2>
              <button
                type="button"
                className="admin-sb-modal__close"
                onClick={() => setEditingFixture(null)}
                disabled={fixtureSaving}
                aria-label="Close fixture editor"
              >
                ×
              </button>
            </header>
            <form
              className="admin-sb-modal__body"
              onSubmit={(e) => {
                e.preventDefault();
                void saveFixtureEdit();
              }}
            >
              <p className="admin-sb-modal__desc">
                {editingFixture.match.homeTeam.name} vs {editingFixture.match.awayTeam.name}
              </p>
              <div className="admin-sb-gameday__datetime">
                <label className="admin-sb-field">
                  <span>Date (WAT)</span>
                  <input
                    type="date"
                    value={editingFixture.kickoffDate}
                    onChange={(e) =>
                      setEditingFixture((current) =>
                        current ? { ...current, kickoffDate: e.target.value } : current
                      )
                    }
                    required
                  />
                </label>
                <label className="admin-sb-field">
                  <span>Kickoff time (WAT)</span>
                  <input
                    type="time"
                    value={editingFixture.kickoffTime}
                    onChange={(e) =>
                      setEditingFixture((current) =>
                        current ? { ...current, kickoffTime: e.target.value } : current
                      )
                    }
                    required
                  />
                </label>
              </div>
              <label className="admin-sb-field">
                <span>Venue</span>
                <input
                  type="text"
                  value={editingFixture.venue}
                  onChange={(e) =>
                    setEditingFixture((current) =>
                      current ? { ...current, venue: e.target.value } : current
                    )
                  }
                  maxLength={200}
                  placeholder="e.g. Onikan Stadium, Lagos"
                />
              </label>
              <label className="admin-sb-field">
                <span>Round</span>
                <input
                  type="text"
                  value={editingFixture.roundLabel}
                  onChange={(e) =>
                    setEditingFixture((current) =>
                      current ? { ...current, roundLabel: e.target.value } : current
                    )
                  }
                  maxLength={120}
                  placeholder="e.g. Round of 16, Matchday 3"
                />
              </label>
              <footer className="admin-sb-modal__footer">
                <button
                  type="button"
                  onClick={() => setEditingFixture(null)}
                  disabled={fixtureSaving}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={fixtureSaving}>
                  {fixtureSaving ? "Saving…" : "Save fixture"}
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}

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
            columns={7}
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
                  <th>Actions</th>
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
                    <td className="admin-sb-row-actions">
                      <button
                        type="button"
                        className="admin-inline-button"
                        onClick={() => openCompetitionEditor(c)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="admin-inline-button admin-inline-button--danger"
                        onClick={async () => {
                          if (!window.confirm(`Delete ${c.name}?`)) return;
                          try {
                            await adminScoreboardApi.deleteCompetition(c.id);
                            toast.success("Competition deleted");
                            void loadCompetitions();
                            void refreshStats();
                          } catch (err) {
                            toast.error(formatAdminScoreboardError(err));
                          }
                        }}
                      >
                        Delete
                      </button>
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
            columns={5}
          >
            <table className="admin-table admin-sb-table">
              <thead>
                <tr>
                  <th>Club</th>
                  <th>Competition</th>
                  <th>Region</th>
                  <th>Squad</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {teams.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <div className="admin-sb-team-cell">
                        {t.logoUrl ? (
                          <img src={t.logoUrl} alt="" className="admin-sb-team-crest" />
                        ) : (
                          <span className="admin-sb-team-crest admin-sb-team-crest--empty" aria-hidden>
                            {t.shortName?.slice(0, 2) ?? t.name.slice(0, 2)}
                          </span>
                        )}
                        <span>
                          {t.name}
                          <small className="muted admin-sb-code">{t.slug}</small>
                        </span>
                      </div>
                    </td>
                    <td>{t.competition.name}</td>
                    <td>{t.region ?? "—"}</td>
                    <td>{t.squadCount}</td>
                    <td className="admin-sb-row-actions">
                      <button
                        type="button"
                        className="admin-inline-button"
                        onClick={() => {
                          setEditingTeam(t);
                          setTeamModal("edit");
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="admin-inline-button admin-inline-button--danger"
                        onClick={async () => {
                          if (!window.confirm(`Delete ${t.name}?`)) return;
                          try {
                            await adminScoreboardApi.deleteTeam(t.id);
                            toast.success("Team deleted");
                            void loadTeams();
                            void refreshStats();
                          } catch (err) {
                            toast.error(formatAdminScoreboardError(err));
                          }
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminSbTableShell>
          </div>
        </>
      )}

      {tab === "fixtures" && (
        <>
          <div className="admin-sb-sticky-bar">
            <div className="admin-filters admin-filters--with-action">
              <select
                value={fixtureCompId}
                onChange={(e) => setFixtureCompId(e.target.value)}
                aria-label="Filter fixtures by competition"
              >
                <option value="">All competitions</option>
                {competitionOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="admin-sb-content-panel">
            <AdminSbTableShell
              loading={loading.fixtures}
              empty={!loading.fixtures && fixtures.length === 0}
              emptyTitle="No fixtures yet"
              emptyHint="Create a fixture for teams in an existing competition."
              columns={7}
            >
              <table className="admin-table admin-sb-table">
                <thead>
                  <tr>
                    <th>Fixture</th>
                    <th>Competition</th>
                    <th>Kickoff (WAT)</th>
                    <th>Venue</th>
                    <th>Round</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {fixtures.map((m) => (
                    <tr key={m.id}>
                      <td>
                        {m.homeTeam.name} vs {m.awayTeam.name}
                        <small className="muted admin-sb-code">{m.slug}</small>
                      </td>
                      <td>{m.competition.name}</td>
                      <td>{formatKickoffWat(m.kickoffAt)}</td>
                      <td>{m.venue?.trim() ? m.venue : "—"}</td>
                      <td>{m.roundLabel ?? m.stageKey ?? "—"}</td>
                      <td>
                        <span className={`admin-sb-status admin-sb-status--${m.status === "live" ? "live" : m.status === "finished" ? "finished" : "upcoming"}`}>
                          {m.status}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="admin-inline-button"
                          onClick={() => openFixtureEditor(m)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="admin-inline-button admin-inline-button--danger"
                          onClick={async () => {
                            if (!window.confirm(`Delete ${m.homeTeam.name} vs ${m.awayTeam.name}?`)) {
                              return;
                            }
                            try {
                              await adminScoreboardApi.deleteMatch(m.id);
                              toast.success("Fixture deleted");
                              void loadFixtures();
                              void refreshStats();
                            } catch (err) {
                              toast.error(formatAdminScoreboardError(err));
                            }
                          }}
                        >
                          Delete
                        </button>
                      </td>
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
            columns={5}
          >
            <table className="admin-table admin-sb-table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>#</th>
                  <th>Position</th>
                  <th>Clubs</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {players.map((p) => (
                  <tr key={p.teams[0]?.squadId ?? p.playerId ?? p.slug ?? p.displayName}>
                    <td>{p.displayName}</td>
                    <td>{p.teams[0]?.shirtNumber ?? "-"}</td>
                    <td>{p.teams[0]?.position ?? p.positionPrimary ?? "-"}</td>
                    <td className="admin-sb-clubs-cell">
                      {p.teams
                        .map((t) => `${t.teamName} (${t.competitionName})`)
                        .join(", ")}
                    </td>
                    <td className="admin-sb-row-actions">
                      <Link to={playerPath(p.slug, p.displayName)} className="text-link">
                        Profile
                      </Link>
                      {p.teams[0] && (
                        <>
                          <button
                            type="button"
                            className="admin-inline-button"
                            onClick={() => openSquadEditor(p)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="admin-inline-button admin-inline-button--danger"
                            onClick={async () => {
                              const squadId = p.teams[0]?.squadId;
                              if (
                                !squadId ||
                                !window.confirm(`Delete ${p.displayName} from scoreboard squads?`)
                              ) {
                                return;
                              }
                              try {
                                await adminScoreboardApi.deleteSquadRow(squadId);
                                toast.success("Scoreboard player removed");
                                void loadPlayers();
                                void refreshStats();
                              } catch (err) {
                                toast.error(formatAdminScoreboardError(err));
                              }
                            }}
                          >
                            Delete
                          </button>
                        </>
                      )}
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
