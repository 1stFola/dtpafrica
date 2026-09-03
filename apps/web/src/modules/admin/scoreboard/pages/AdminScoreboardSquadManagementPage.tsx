import { useCallback, useEffect, useMemo, useState } from "react";
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

type SquadFilters = {
  q?: string;
  teamId?: string;
  competitionId?: string;
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

  // Form states
  const [createFormOpen, setCreateFormOpen] = useState(false);
  const [editFormOpen, setEditFormOpen] = useState(false);
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

  // Load competitions
  useEffect(() => {
    let cancelled = false;
    setCompetitionsLoading(true);
    adminScoreboardApi
      .competitionPicker()
      .then((rows) => {
        if (cancelled) return;
        setCompetitions(rows as Array<{ id: string; name: string; slug: string; season: string }>);
        // Auto-select first competition if none selected
        if (!selectedCompetitionId && rows.length > 0) {
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
  }, [selectedCompetitionId, toast]);

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
        // Auto-select first team if none selected
        if (!selectedTeamId && rows.length > 0) {
          setSelectedTeamId(rows[0].id);
        }
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load teams"))
      .finally(() => {
        if (!cancelled) setTeamsLoading(false);
      });
  }, [selectedCompetitionId, toast]);

  // Load squads based on filters
  const loadSquads = useCallback(async () => {
    setLoading(true);
    try {
      const filterObj: SquadFilters = {};
      if (filters.q?.trim()) filterObj.q = filters.q.trim();
      if (filters.teamId) filterObj.teamId = filters.teamId;
      if (filters.competitionId) filterObj.competitionId = filters.competitionId;
      if (filters.position?.trim()) filterObj.position = filters.position.trim();
      if (filters.shirtNumber !== undefined) filterObj.shirtNumber = filters.shirtNumber;

      const result = await adminScoreboardApi.listSquads(filterObj);
      setSquads(result as any);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load squads");
    } finally {
      setLoading(false);
    }
  }, [filters, toast]);

  useEffect(() => {
    if (selectedCompetitionId || selectedTeamId || filters.q || filters.position || filters.shirtNumber !== undefined) {
      void loadSquads();
    }
  }, [selectedCompetitionId, selectedTeamId, filters, loadSquads]);

  // Handle filter changes
  const handleFilterChange = useCallback((field: keyof SquadFilters, value: any) => {
    setFilters(prev => ({
      ...prev,
      [field]: value === "" ? undefined : value
    }));
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
      setCreateFormOpen(false);
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
      setEditFormOpen(false);
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

  // UI helpers
  const filteredSquads = useMemo(() => {
    return squads.filter(squad => {
      // Filter by team if selected
      if (selectedTeamId && squad.teamId !== selectedTeamId) return false;

      // Filter by competition if selected
      if (selectedCompetitionId && squad.team.competition.id !== selectedCompetitionId) return false;

      // Filter by search query
      if (filters.q?.trim()) {
        const query = filters.q.trim().toLowerCase();
        const matchesDisplay = squad.displayName.toLowerCase().includes(query);
        const matchesSlug = squad.slug?.toLowerCase().includes(query) ?? false;
        if (!matchesDisplay && !matchesSlug) return false;
      }

      // Filter by position
      if (filters.position?.trim()) {
        const positionQuery = filters.position.trim().toLowerCase();
        const squadPosition = squad.positionPrimary?.toLowerCase() ?? "";
        if (!squadPosition.includes(positionQuery)) return false;
      }

      // Filter by shirt number
      if (filters.shirtNumber !== undefined && squad.shirtNumber !== filters.shirtNumber) {
        return false;
      }

      return true;
    });
  }, [squads, selectedTeamId, selectedCompetitionId, filters]);

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
              className="admin-input"
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
              className="admin-input"
            />
          </label>

          {/* Actions */}
          <div className="admin-actions">
            <button
              type="button"
              className="admin-primary-button"
              disabled={loading || !selectedCompetitionId}
              onClick={() => {
                setEditData({
                  displayName: "",
                  position: undefined,
                  shirtNumber: undefined,
                  teamId: selectedTeamId || undefined,
                });
                setEditSquadId("");
                setEditFormOpen(true);
              }}
            >
              Add Squad Row
            </button>

            {selectedSquadIds.size > 0 && (
              <button
                type="button"
                className="admin-danger-button"
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
          empty={filteredSquads.length === 0 && (!!selectedCompetitionId || !!selectedTeamId || Object.keys(filters).length > 0)}
          emptyTitle={filteredSquads.length === 0 ? "No squad rows match the filters" : "No squad rows found"}
          emptyHint={filteredSquads.length === 0 ? "Adjust your filters to see squad rows" : "Add squad rows to get started"}
        >
          <table className="admin-table admin-sb-table">
            <thead>
              <tr>
                <th className="w-4">
                  <input
                    type="checkbox"
                    checked={selectedSquadIds.size === filteredSquads.length && filteredSquads.length > 0}
                    onChange={(e) => {
                      if (e.target.checked) {
                        filteredSquads.forEach(squad => selectedSquadIds.add(squad.squadId));
                      } else {
                        filteredSquads.forEach(squad => selectedSquadIds.delete(squad.squadId));
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
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredSquads.map((squad) => (
                <tr key={squad.squadId}>
                  <td className="w-4">
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
                    <div className="flex items-center space-x-2">
                      {squad.slug ? (
                        <Link
                          className="admin-inline-link"
                          to={`/players/${squad.slug}`}
                          title="View player profile"
                        >
                          {squad.displayName}
                        </Link>
                      ) : (
                        <span className="font-medium">{squad.displayName}</span>
                      )}
                    </div>
                  </td>
                  <td>{squad.positionPrimary ?? "-"}</td>
                  <td className="text-center">{squad.shirtNumber ?? "-"}</td>
                  <td>
                    <div className="flex items-center space-x-2">
                      <Link
                        className="admin-inline-link"
                        to={`/admin/scoreboard/teams/${squad.team.id}`}
                        title="View team"
                      >
                        {squad.team.name}
                      </Link>
                    </div>
                  </td>
                  <td>
                    <div className="flex items-center space-x-2">
                      <Link
                        className="admin-inline-link"
                        to={`/admin/scoreboard/competitions/${squad.team.competition.id}`}
                        title="View competition"
                      >
                        {squad.team.competition.name}
                      </Link>
                    </div>
                  </td>
                  <td className="text-right space-x-2">
                    <button
                      type="button"
                      className="admin-icon-button"
                      title="Edit squad row"
                      onClick={() => {
                        setEditData({
                          displayName: squad.displayName,
                          position: squad.positionPrimary ?? undefined,
                          shirtNumber: squad.shirtNumber,
                          teamId: squad.teamId ?? undefined,
                        });
                        setEditSquadId(squad.squadId);
                        setEditFormOpen(true);
                      }}
                    >
                      ✏️
                    </button>

                    <button
                      type="button"
                      className="admin-icon-button"
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
      <div className={`fixed inset-0 z-50 flex items-center justify-center ${createFormOpen || editFormOpen ? "block" : "hidden"}`}>
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm"></div>
        <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
          <div className="px-6 py-4 border-b">
            <h2 className="text-lg font-semibold">
              {editSquadId ? "Edit Squad Row" : "Add Squad Row"}
            </h2>
            <button
              type="button"
              className="float-right text-gray-500 hover:text-gray-700"
              onClick={() => {
                setCreateFormOpen(false);
                setEditFormOpen(false);
              }}
            >
              ×
            </button>
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (editSquadId) {
                await handleUpdateSquad(editSquadId, editData);
              } else {
                await handleCreateSquad(editData);
              }
            }}
            className="px-6 py-4"
          >
            <div className="grid grid-cols-1 gap-4">
              {/* Team Selection (disabled when editing) */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  Team *
                </label>
                <select
                  value={editData.teamId}
                  onChange={(e) => {
                    setEditData(prev => ({ ...prev, teamId: e.target.value }));
                  }}
                  disabled={!!editSquadId}
                  className="admin-input w-full"
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
                  <p className="text-xs text-red-500 mt-1">Team is required</p>
                )}
              </div>

              {/* Display Name */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  Player Name *
                </label>
                <input
                  type="text"
                  value={editData.displayName ?? ""}
                  onChange={(e) => {
                    setEditData(prev => ({ ...prev, displayName: e.target.value }));
                  }}
                  className="admin-input w-full"
                  required
                />
                {!editData.displayName && (
                  <p className="text-xs text-red-500 mt-1">Player name is required</p>
                )}
              </div>

              {/* Position */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  Position
                </label>
                <select
                  value={editData.position ?? ""}
                  onChange={(e) => {
                    const value = e.target.value;
                    setEditData(prev => ({ ...prev, position: value === "" ? undefined : value }));
                  }}
                  className="admin-input w-full"
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
              </div>

              {/* Shirt Number */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  Shirt Number
                </label>
                <input
                  type="number"
                  min="0"
                  max="99"
                  value={editData.shirtNumber === null ? "" : String(editData.shirtNumber)}
                  onChange={(e) => {
                    const value = e.target.value;
                    setEditData(prev => ({ ...prev, shirtNumber: value === "" ? null : Number(value) }));
                  }}
                  className="admin-input w-full"
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t">
              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  className="admin-outline-button"
                  onClick={() => {
                    setCreateFormOpen(false);
                    setEditFormOpen(false);
                  }}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  className="admin-primary-button"
                  disabled={loading || !editData.displayName || (!editSquadId && !editData.teamId)}
                >
                  {editSquadId ? "Update" : "Create"}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      {/* Bulk Delete Confirmation Modal */}
      <div className={`fixed inset-0 z-50 flex items-center justify-center ${bulkDeleteOpen ? "block" : "hidden"}`}>
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm"></div>
        <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
          <div className="px-6 py-4 border-b">
            <h2 className="text-lg font-semibold">Confirm Bulk Delete</h2>
            <button
              type="button"
              className="float-right text-gray-500 hover:text-gray-700"
              onClick={() => setBulkDeleteOpen(false)}
            >
              ×
            </button>
          </div>
          <div className="px-6 py-4">
            <p className="mb-4">
              Are you sure you want to delete <strong className="text-red-600">{selectedSquadIds.size}</strong>
              squad row(s)? This action cannot be undone.
            </p>

            <div className="flex justify-end space-x-3">
              <button
                type="button"
                className="admin-outline-button"
                onClick={() => setBulkDeleteOpen(false)}
              >
                Cancel
              </button>

              <button
                type="button"
                className="admin-danger-button"
                onClick={handleBulkDelete}
              >
                Delete {selectedSquadIds.size} Squad Row(s)
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}