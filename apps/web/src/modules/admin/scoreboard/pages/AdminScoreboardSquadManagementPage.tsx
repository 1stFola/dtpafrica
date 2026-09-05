import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { adminScoreboardApi } from "../../../../api/admin-scoreboard";
import { usePageTitle } from "../../../../hooks/usePageTitle";
import { useAdminToast } from "../../components/AdminToast";
import { AdminSbPageHeader } from "../components/AdminSbPageHeader";
import { AdminSbTableShell } from "../components/AdminSbTableShell";
import type {
  AdminSbTeam,
  AdminSbSquadRowInput,
} from "../types";

/**
 * Free-text filters only. Competition and team live in their own state
 * (`selectedCompetitionId` / `selectedTeamId`) because they also drive the
 * team dropdown and the create form's default team.
 */
type SquadFilters = {
  q?: string;
  position?: string;
  shirtNumber?: number;
};


export function AdminScoreboardSquadManagementPage() {
  usePageTitle("Admin - Squad Management");
  const toast = useAdminToast();

  // State for filters and data
  const [filters, setFilters] = useState<SquadFilters>({});
  const [squads, setSquads] = useState<Array<{
    squadId: string;
    teamId: string;
    playerId: string | null;
    displayName: string;
    slug: string | null;
    positionPrimary: string | null;
    shirtNumber: number | null;
    team: {
      id: string;
      name: string;
      slug: string;
      competition: {
        id: string;
        name: string;
        slug: string;
      };
    };
  }>>([]);
  const [competitions, setCompetitions] = useState<Array<{ id: string; name: string; slug: string; season: string }>>([]);
  const [teams, setTeams] = useState<AdminSbTeam[]>([]);

  // Loading states
  const [loading, setLoading] = useState(false);
  const [competitionsLoading, setCompetitionsLoading] = useState(false);
  const [teamsLoading, setTeamsLoading] = useState(false);

  // Selected entities for forms
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");
  const [selectedCompetitionId, setSelectedCompetitionId] = useState<string>("");

  // Form state. One flag for both create and edit — `editSquadId` is what
  // distinguishes the two modes.
  const [formOpen, setFormOpen] = useState(false);
  const [editSquadId, setEditSquadId] = useState<string>("");
  const [editData, setEditData] = useState<AdminSbSquadRowInput>({
    displayName: "",
    position: undefined,
    shirtNumber: null,
    teamId: undefined,
  });

  // Bulk delete state
  const [selectedSquadIds, setSelectedSquadIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  // Guards the one-time "default to the first competition" behaviour.
  const didDefaultCompetition = useRef(false);

  // Load competitions. Runs once: `selectedCompetitionId` is deliberately not a
  // dependency, because this effect *sets* it — depending on it would refetch
  // the list and re-apply the default every time the user cleared the field,
  // which is what made "Reset Filters" snap back to the first competition.
  useEffect(() => {
    let cancelled = false;
    setCompetitionsLoading(true);
    adminScoreboardApi
      .competitionPicker()
      .then((rows) => {
        if (cancelled) return;
        setCompetitions(rows as Array<{ id: string; name: string; slug: string; season: string }>);
        // Default to the first competition on first load only.
        if (!didDefaultCompetition.current && rows.length > 0) {
          didDefaultCompetition.current = true;
          setSelectedCompetitionId(rows[0].id);
        }
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load competitions"))
      .finally(() => {
        if (!cancelled) setCompetitionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [toast]);

  // Load teams based on selected competition
  useEffect(() => {
    if (!selectedCompetitionId) {
      setTeams([]);
      setSelectedTeamId("");
      return;
    }

    let cancelled = false;
    setTeamsLoading(true);
    adminScoreboardApi
      .teams({ competitionId: selectedCompetitionId })
      .then((rows) => {
        if (cancelled) return;
        setTeams(rows as AdminSbTeam[]);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load teams"))
      .finally(() => {
        if (!cancelled) setTeamsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCompetitionId, toast]);

  // Load squads. Every filter goes to the server, including the competition and
  // team pickers — previously those were only applied client-side, so the page
  // fetched every squad row in the database on each change.
  const loadSquads = useCallback(async () => {
    setLoading(true);
    try {
      const result = await adminScoreboardApi.listSquads({
        q: filters.q?.trim() || undefined,
        position: filters.position?.trim() || undefined,
        shirtNumber: filters.shirtNumber,
        competitionId: selectedCompetitionId || undefined,
        teamId: selectedTeamId || undefined,
      });
      setSquads(result);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load squads");
    } finally {
      setLoading(false);
    }
  }, [filters, selectedCompetitionId, selectedTeamId, toast]);

  useEffect(() => {
    void loadSquads();
  }, [loadSquads]);

  // Handle filter changes. Cleared fields are removed rather than set to
  // undefined, so `Object.keys(filters)` actually reflects what is active.
  const handleFilterChange = useCallback((field: keyof SquadFilters, value: string | number | undefined) => {
    setFilters(prev => {
      const next = { ...prev };
      if (value === "" || value === undefined) {
        delete next[field];
      } else {
        (next[field] as string | number) = value;
      }
      return next;
    });
  }, []);

  // Handle team/competition selection changes
  const handleCompetitionChange = useCallback((competitionId: string) => {
    setSelectedCompetitionId(competitionId);
    setSelectedTeamId(""); // Reset team selection when competition changes
  }, []);

  const handleTeamChange = useCallback((teamId: string) => {
    setSelectedTeamId(teamId);
  }, []);

  // Form handlers
  const handleCreateSquad = useCallback(async (data: AdminSbSquadRowInput) => {
    try {
      await adminScoreboardApi.createSquad({
        displayName: data.displayName,
        teamId: data.teamId!,
        position: data.position,
        shirtNumber: data.shirtNumber,
      });
      toast.success("Squad row created successfully");
      setFormOpen(false);
      void loadSquads(); // Refresh list
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create squad row");
    }
  }, [toast, loadSquads]);

  const handleUpdateSquad = useCallback(async (squadId: string, data: AdminSbSquadRowInput) => {
    try {
      await adminScoreboardApi.updateSquadRow(squadId, {
        displayName: data.displayName,
        teamId: data.teamId,
        position: data.position,
        shirtNumber: data.shirtNumber,
      });
      toast.success("Squad row updated successfully");
      setFormOpen(false);
      void loadSquads(); // Refresh list
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update squad row");
    }
  }, [toast, loadSquads]);

  const handleDeleteSquad = useCallback(async (squadId: string) => {
    try {
      await adminScoreboardApi.deleteSquadRow(squadId);
      toast.success("Squad row deleted successfully");
      void loadSquads(); // Refresh list
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete squad row");
    }
  }, [toast, loadSquads]);

  const handleBulkDelete = useCallback(async () => {
    if (selectedSquadIds.size === 0) return;

    try {
      await adminScoreboardApi.deleteSquads({ squadIds: Array.from(selectedSquadIds) });
      toast.success(`${selectedSquadIds.size} squad row(s) deleted successfully`);
      setBulkDeleteOpen(false);
      setSelectedSquadIds(new Set());
      void loadSquads(); // Refresh list
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete squad rows");
    }
  }, [toast, loadSquads, selectedSquadIds]);

  // The server applies every filter now, so `squads` is already the view.
  const hasActiveFilters =
    !!selectedCompetitionId || !!selectedTeamId || Object.keys(filters).length > 0;

  return (
    <div className="admin-sb-section">
      <AdminSbPageHeader
        title="Squad Management"
        crumbs={[{ label: "Squads" }]}
        description="Manage team squad rows with full CRUD operations, search, and filtering"
      />

      {/* Filters and Actions Bar */}
      <div className="admin-sb-sticky-bar">
        <div className="admin-filters">
          {/* Competition Filter */}
          <label>
            Competition
            <select
              value={selectedCompetitionId}
              onChange={(e) => handleCompetitionChange(e.target.value)}
              disabled={competitionsLoading}
            >
              <option value="">All Competitions</option>
              {competitions.map(competition => (
                <option key={competition.id} value={competition.id}>
                  {competition.name} ({competition.season})
                </option>
              ))}
            </select>
          </label>

          {/* Team Filter */}
          <label>
            Team
            <select
              value={selectedTeamId}
              onChange={(e) => handleTeamChange(e.target.value)}
              disabled={!selectedCompetitionId || teamsLoading || teams.length === 0}
            >
              <option value="">All Teams</option>
              {teams.map(team => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>

          {/* Search */}
          <label>
            Search
            <input
              type="text"
              placeholder="Search by name or slug..."
              value={filters.q ?? ""}
              onChange={(e) => handleFilterChange("q", e.target.value)}
            />
          </label>

          {/* Position Filter */}
          <label>
            Position
            <select
              value={filters.position ?? ""}
              onChange={(e) => handleFilterChange("position", e.target.value)}
            >
              <option value="">All Positions</option>
              <option value="GK">Goalkeeper</option>
              <option value="DF">Defender</option>
              <option value="MF">Midfielder</option>
              <option value="FW">Forward</option>
            </select>
          </label>

          {/* Shirt Number Filter */}
          <label>
            Shirt #
            <input
              type="number"
              min="0"
              max="99"
              placeholder="Number"
              value={filters.shirtNumber ?? ""}
              onChange={(e) => handleFilterChange("shirtNumber", e.target.value ? Number(e.target.value) : undefined)}
            />
          </label>

          {/* Actions */}
          <div className="admin-sb-form-actions">
            <button
              type="button"
              className="admin-inline-button admin-inline-button--primary"
              disabled={loading || !selectedCompetitionId}
              onClick={() => {
                setEditData({
                  displayName: "",
                  position: undefined,
                  shirtNumber: null,
                  teamId: selectedTeamId || undefined,
                });
                setEditSquadId("");
                setFormOpen(true);
              }}
            >
              Add Squad Row
            </button>

            {selectedSquadIds.size > 0 && (
              <button
                type="button"
                className="admin-inline-button admin-inline-button--danger"
                onClick={() => setBulkDeleteOpen(true)}
              >
                Delete Selected ({selectedSquadIds.size})
              </button>
            )}

            <button
              type="button"
              className="admin-inline-button"
              onClick={() => {
                setFilters({});
                setSelectedCompetitionId("");
                setSelectedTeamId("");
              }}
            >
              Reset Filters
            </button>
          </div>
        </div>
      </div>

      {/* Squads Table */}
      <div className="admin-sb-content-panel">
        <AdminSbTableShell
          columns={8}
          loading={loading}
          empty={squads.length === 0}
          emptyTitle={hasActiveFilters ? "No squad rows match the filters" : "No squad rows yet"}
          emptyHint={hasActiveFilters ? "Adjust your filters to see squad rows" : "Add squad rows to get started"}
        >
          <table className="admin-table admin-sb-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={selectedSquadIds.size === squads.length && squads.length > 0}
                    onChange={(e) => {
                      if (e.target.checked) {
                        squads.forEach(squad => selectedSquadIds.add(squad.squadId));
                      } else {
                        squads.forEach(squad => selectedSquadIds.delete(squad.squadId));
                      }
                      setSelectedSquadIds(new Set(selectedSquadIds));
                    }}
                  />
                </th>
                <th>#</th>
                <th>Player</th>
                <th>Position</th>
                <th>Shirt #</th>
                <th>Team</th>
                <th>Competition</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {squads.map((squad) => (
                <tr key={squad.squadId}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedSquadIds.has(squad.squadId)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          selectedSquadIds.add(squad.squadId);
                        } else {
                          selectedSquadIds.delete(squad.squadId);
                        }
                        setSelectedSquadIds(new Set(selectedSquadIds));
                      }}
                    />
                  </td>
                  <td>{squad.shirtNumber ?? "-"}</td>
                  <td>
                      {squad.slug ? (
                        <Link
                                                    to={`/players/${squad.slug}`}
                          title="View player profile"
                        >
                          {squad.displayName}
                        </Link>
                      ) : (
                        <span>{squad.displayName}</span>
                      )}
                  </td>
                  <td>{squad.positionPrimary ?? "-"}</td>
                  <td>{squad.shirtNumber ?? "-"}</td>
                  <td>
                      <Link
                                                to={`/admin/scoreboard/teams/${squad.team.id}`}
                        title="View team"
                      >
                        {squad.team.name}
                      </Link>
                  </td>
                  <td>
                      <Link
                                                to={`/admin/scoreboard/competitions/${squad.team.competition.id}`}
                        title="View competition"
                      >
                        {squad.team.competition.name}
                      </Link>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="admin-inline-button"
                      title="Edit squad row"
                      onClick={() => {
                        setEditData({
                          displayName: squad.displayName,
                          position: squad.positionPrimary ?? undefined,
                          shirtNumber: squad.shirtNumber,
                          teamId: squad.teamId ?? undefined,
                        });
                        setEditSquadId(squad.squadId);
                        setFormOpen(true);
                      }}
                    >
                      ✏️
                    </button>

                    <button
                      type="button"
                      className="admin-inline-button"
                      title="Delete squad row"
                      onClick={() => handleDeleteSquad(squad.squadId)}
                    >
                      🗑️
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </AdminSbTableShell>
      </div>

      {/* Create/Edit Squad Form Modal */}
      {formOpen && (
      <div className="admin-sb-modal-backdrop" role="presentation" onClick={() => setFormOpen(false)}>
        <div
          className="admin-sb-modal admin-sb-modal--wide"
          role="dialog"
          aria-modal="true"
          aria-label={editSquadId ? "Edit squad row" : "Add squad row"}
          onClick={(e) => e.stopPropagation()}
        >
          <header className="admin-sb-modal__header">
            <h2>
              {editSquadId ? "Edit Squad Row" : "Add Squad Row"}
            </h2>
            <button
              type="button"
              className="admin-sb-modal__close"
              aria-label="Close"
              onClick={() => setFormOpen(false)}
            >
              ×
            </button>
          </header>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (editSquadId) {
                await handleUpdateSquad(editSquadId, editData);
              } else {
                await handleCreateSquad(editData);
              }
            }}
          >
            <div className="admin-sb-modal__body">
              {/* Team Selection (disabled when editing) */}
              <label className="admin-sb-field">
                <span>Team *</span>
                <select
                  value={editData.teamId ?? ""}
                  onChange={(e) => {
                    setEditData(prev => ({ ...prev, teamId: e.target.value || undefined }));
                  }}
                  disabled={!!editSquadId}
                  required
                >
                  <option value="">Select a team</option>
                  {teams.map(team => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
                {!editSquadId && !editData.teamId && (
                  <span className="admin-sb-field-hint">Team is required</span>
                )}
              </label>

              {/* Display Name */}
              <label className="admin-sb-field">
                <span>Player Name *</span>
                <input
                  type="text"
                  value={editData.displayName ?? ""}
                  onChange={(e) => {
                    setEditData(prev => ({ ...prev, displayName: e.target.value }));
                  }}
                  required
                />
                {!editData.displayName && (
                  <span className="admin-sb-field-hint">Player name is required</span>
                )}
              </label>

              {/* Position */}
              <label className="admin-sb-field">
                <span>Position</span>
                <select
                  value={editData.position ?? ""}
                  onChange={(e) => {
                    const value = e.target.value;
                    setEditData(prev => ({ ...prev, position: value === "" ? undefined : value }));
                  }}
                >
                  <option value="">Select position</option>
                  <option value="GK">Goalkeeper (GK)</option>
                  <option value="RB">Right Back (RB)</option>
                  <option value="LB">Left Back (LB)</option>
                  <option value="CB">Center Back (CB)</option>
                  <option value="DM">Defensive Midfielder (DM)</option>
                  <option value="CM">Central Midfielder (CM)</option>
                  <option value="AM">Attacking Midfielder (AM)</option>
                  <option value="RM">Right Midfielder (RM)</option>
                  <option value="LM">Left Midfielder (LM)</option>
                  <option value="RW">Right Wing (RW)</option>
                  <option value="LW">Left Wing (LW)</option>
                  <option value="ST">Striker (ST)</option>
                  <option value="CF">Center Forward (CF)</option>
                </select>
              </label>

              {/* Shirt Number */}
              <label className="admin-sb-field">
                <span>Shirt Number</span>
                <input
                  type="number"
                  min="0"
                  max="99"
                  value={editData.shirtNumber == null ? "" : String(editData.shirtNumber)}
                  onChange={(e) => {
                    const value = e.target.value;
                    setEditData(prev => ({ ...prev, shirtNumber: value === "" ? null : Number(value) }));
                  }}
                />
              </label>
            </div>

            <footer className="admin-sb-modal__footer">
              <button
                type="button"
                className="admin-inline-button"
                onClick={() => setFormOpen(false)}
              >
                Cancel
              </button>

              <button
                type="submit"
                className="admin-inline-button admin-inline-button--primary"
                disabled={loading || !editData.displayName || (!editSquadId && !editData.teamId)}
              >
                {editSquadId ? "Update" : "Create"}
              </button>
            </footer>
          </form>
        </div>
      </div>
      )}

      {/* Bulk Delete Confirmation Modal */}
      {bulkDeleteOpen && (
      <div className="admin-sb-modal-backdrop" role="presentation" onClick={() => setBulkDeleteOpen(false)}>
        <div
          className="admin-sb-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm bulk delete"
          onClick={(e) => e.stopPropagation()}
        >
          <header className="admin-sb-modal__header">
            <h2>Confirm Bulk Delete</h2>
            <button
              type="button"
              className="admin-sb-modal__close"
              aria-label="Close"
              onClick={() => setBulkDeleteOpen(false)}
            >
              ×
            </button>
          </header>
          <div className="admin-sb-modal__body">
            <p>
              Are you sure you want to delete <strong>{selectedSquadIds.size}</strong>{" "}
              squad row(s)? This action cannot be undone.
            </p>
          </div>

          <footer className="admin-sb-modal__footer">
            <button
              type="button"
              className="admin-inline-button"
              onClick={() => setBulkDeleteOpen(false)}
            >
              Cancel
            </button>

            <button
              type="button"
              className="admin-inline-button admin-inline-button--danger"
              onClick={handleBulkDelete}
            >
              Delete {selectedSquadIds.size} Squad Row(s)
            </button>
          </footer>
        </div>
      </div>
      )}
    </div>
  );
}