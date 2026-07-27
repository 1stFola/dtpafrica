import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  adminApi,
  type AdminAcademy,
  type AdminPlayerListQuery,
  type AdminPlayerRow,
} from "../../../api/admin";
import { useDebouncedValue } from "../../../hooks/useDebouncedValue";
import { usePageTitle } from "../../../hooks/usePageTitle";
import {
  positionAbbreviationOptions,
  positionFullFromAbbreviation,
  resolvePositionFullLabel,
} from "../../../utils/positionLabels";
import {
  SCOUTING_PHILOSOPHY_IDS,
  isScoutingPhilosophyId,
} from "../../../utils/scoutingPhilosophies";
import { useAdminToast } from "../components/AdminToast";
import { AdminPageHeader } from "../components/AdminPageHeader";
import { AdminTableShell } from "../components/AdminTableShell";
import { PlayerBulkEditModal } from "../components/PlayerBulkEditModal";
import { PlayerSlugPreview } from "../components/PlayerSlugPreview";
import { PlayerQuickEditModal } from "../components/PlayerQuickEditModal";

const POSITION_OPTIONS = positionAbbreviationOptions();
const PAGE_SIZE = 50;

type ProfileFormState = {
  positionPrimary: string;
  positionFull: string;
  philosophyRank1: string;
  philosophyRank2: string;
};

function parsePhilosophies(value: AdminPlayerRow["playingPhilosophies"]): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((p): p is string => typeof p === "string" && isScoutingPhilosophyId(p));
}

function profileFormFromRow(row: AdminPlayerRow): ProfileFormState {
  const philosophies = parsePhilosophies(row.playingPhilosophies);
  return {
    positionPrimary: row.positionPrimary,
    positionFull:
      row.positionFull?.trim() ||
      positionFullFromAbbreviation(row.positionPrimary) ||
      "",
    philosophyRank1: philosophies[0] ?? "",
    philosophyRank2: philosophies[1] ?? "",
  };
}

function philosophiesFromForm(form: ProfileFormState): string[] {
  const out: string[] = [];
  for (const pick of [form.philosophyRank1, form.philosophyRank2]) {
    if (!pick || !isScoutingPhilosophyId(pick)) continue;
    if (out.includes(pick)) continue;
    out.push(pick);
    if (out.length >= 2) break;
  }
  return out;
}

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function AdminPlayersPage() {
  usePageTitle("Admin — Players");
  const toast = useAdminToast();
  const [rows, setRows] = useState<AdminPlayerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [academies, setAcademies] = useState<AdminAcademy[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q, 300);
  const [status, setStatus] = useState("");
  const [academyId, setAcademyId] = useState("");
  const [position, setPosition] = useState("");
  const [featured, setFeatured] = useState<"" | "true" | "false">("");
  const [hasMedia, setHasMedia] = useState<"" | "video" | "photo" | "any" | "none">("");
  const [sort, setSort] = useState<"name" | "date" | "rating">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [calibratingId, setCalibratingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [profileEditId, setProfileEditId] = useState<string | null>(null);
  const [profileForm, setProfileForm] = useState<ProfileFormState | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [quickEditId, setQuickEditId] = useState<string | null>(null);
  const [quickEditName, setQuickEditName] = useState("");

  const listQuery = useMemo<AdminPlayerListQuery>(
    () => ({
      q: debouncedQ || undefined,
      status: status || undefined,
      academyId: academyId || undefined,
      position: position || undefined,
      featured: featured || undefined,
      hasMedia: hasMedia || undefined,
      sort,
      sortDir,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [debouncedQ, status, academyId, position, featured, hasMedia, sort, sortDir, page]
  );

  useEffect(() => {
    setPage(0);
  }, [debouncedQ, status, academyId, position, featured, hasMedia, sort, sortDir]);

  const load = useCallback(() => {
    setLoading(true);
    adminApi
      .players(listQuery)
      .then((data) => {
        setRows(data.items);
        setTotal(data.total);
        setSelectedIds((prev) => {
          const next = new Set<string>();
          for (const id of prev) {
            if (data.items.some((row) => row.id === id)) next.add(id);
          }
          return next;
        });
      })
      .catch(() => {
        setRows([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
  }, [listQuery]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    adminApi
      .academyList()
      .then(setAcademies)
      .catch(() => setAcademies([]));
  }, []);

  const allVisibleSelected =
    rows.length > 0 && rows.every((row) => selectedIds.has(row.id));

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(rows.map((row) => row.id)));
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedSlugs = rows
    .filter((row) => selectedIds.has(row.id))
    .map((row) => row.slug)
    .filter((slug): slug is string => Boolean(slug));

  const patch = async (
    id: string,
    patch: Partial<Pick<AdminPlayerRow, "isFeatured" | "isPublic" | "registrationStatus">>
  ) => {
    try {
      await adminApi.updatePlayer(id, patch);
      toast.success("Saved");
      load();
    } catch (e) {
      toast.error(String(e));
    }
  };

  const startProfileEdit = (p: AdminPlayerRow) => {
    setProfileEditId(p.id);
    setProfileForm(profileFormFromRow(p));
    setEditingId(null);
  };

  const cancelProfileEdit = () => {
    setProfileEditId(null);
    setProfileForm(null);
  };

  const saveProfile = async (id: string) => {
    if (!profileForm) return;
    const positionPrimary = profileForm.positionPrimary.trim().toUpperCase();
    const positionFull = profileForm.positionFull.trim();
    if (!positionPrimary || !positionFull) {
      toast.error("Position abbreviation and full title are required");
      return;
    }
    setSavingProfile(true);
    try {
      await adminApi.updatePlayer(id, {
        positionPrimary,
        positionFull,
        playingPhilosophies: philosophiesFromForm(profileForm),
      });
      toast.success("Position and philosophies saved");
      cancelProfileEdit();
      load();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSavingProfile(false);
    }
  };

  const startEditName = (p: AdminPlayerRow) => {
    setEditingId(p.id);
    setEditName(p.displayName);
  };

  const saveDisplayName = async (id: string) => {
    if (!editName.trim()) {
      toast.error("Display name is required");
      return;
    }
    setSavingName(true);
    try {
      await adminApi.updatePlayer(id, { displayName: editName.trim() });
      toast.success("Player name and slug updated");
      setEditingId(null);
      load();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSavingName(false);
    }
  };

  const recalibrate = async (id: string) => {
    setCalibratingId(id);
    try {
      const result = await adminApi.calibratePlayer(id);
      toast.success(
        `Recalibrated ${result.displayName}: OVR ${result.calibratedSummary.overall_rating}`
      );
      load();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setCalibratingId(null);
    }
  };

  const exportCsv = () => {
    const header = [
      "Name",
      "Position",
      "Nationality",
      "Age",
      "Status",
      "Featured",
      "Public",
      "Overall",
      "Offensive",
      "Defensive",
      "Academy",
      "Slug",
    ];
    const lines = [
      header.map(csvCell).join(","),
      ...rows.map((p) =>
        [
          p.displayName,
          p.positionPrimary,
          p.nationality,
          p.age,
          p.registrationStatus,
          p.isFeatured,
          p.isPublic,
          p.overallRating,
          p.offensiveRating,
          p.defensiveRating,
          p.academy?.name ?? "",
          p.slug,
        ]
          .map(csvCell)
          .join(",")
      ),
    ];
    const url = URL.createObjectURL(
      new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" })
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "dtp-admin-players.csv";
    link.click();
    URL.revokeObjectURL(url);
    toast.success("CSV exported");
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageStart = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const pageEnd = Math.min(total, (page + 1) * PAGE_SIZE);

  return (
    <section className="admin-page admin-sb-section">
      <AdminPageHeader
        title="Players"
        description="Toggle featured and public visibility. Assign homepage philosophies (max 2) and full position titles."
        crumbs={[{ label: "Players" }]}
      />

      <div className="admin-sb-sticky-bar">
        <div className="admin-filters admin-filters--with-action">
          <input
            placeholder="Search name or slug…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search players"
          />
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <select
            value={academyId}
            onChange={(e) => setAcademyId(e.target.value)}
            aria-label="Academy"
          >
            <option value="">All academies</option>
            <option value="none">No academy</option>
            {academies.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <select
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            aria-label="Position"
          >
            <option value="">All positions</option>
            {POSITION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <select
            value={featured}
            onChange={(e) => setFeatured(e.target.value as "" | "true" | "false")}
            aria-label="Featured"
          >
            <option value="">Featured: any</option>
            <option value="true">Featured only</option>
            <option value="false">Not featured</option>
          </select>
          <select
            value={hasMedia}
            onChange={(e) =>
              setHasMedia(e.target.value as "" | "video" | "photo" | "any" | "none")
            }
            aria-label="Media"
          >
            <option value="">Media: any</option>
            <option value="video">Has video</option>
            <option value="photo">Has photo</option>
            <option value="any">Has video or photo</option>
            <option value="none">No media</option>
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as "name" | "date" | "rating")}
            aria-label="Sort by"
          >
            <option value="name">Sort: name</option>
            <option value="date">Sort: date</option>
            <option value="rating">Sort: rating</option>
          </select>
          <select
            value={sortDir}
            onChange={(e) => setSortDir(e.target.value as "asc" | "desc")}
            aria-label="Sort direction"
          >
            <option value="desc">Desc</option>
            <option value="asc">Asc</option>
          </select>
          <button
            type="button"
            className="admin-inline-button"
            onClick={() => setBulkOpen(true)}
            disabled={selectedIds.size === 0}
          >
            Bulk edit ({selectedIds.size})
          </button>
          <button
            type="button"
            className="admin-inline-button"
            onClick={exportCsv}
            disabled={rows.length === 0}
          >
            Export CSV
          </button>
          <button type="button" className="admin-inline-button" onClick={load}>
            Refresh
          </button>
        </div>
      </div>

      <div className="admin-sb-content-panel">
        <AdminTableShell
          loading={loading}
          empty={!loading && rows.length === 0}
          emptyTitle="No players match your filters"
          emptyHint="Adjust search or status filters, or approve pending registrations."
          columns={7}
        >
          <table className="admin-table admin-sb-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    aria-label="Select all visible players"
                    onChange={toggleSelectAll}
                  />
                </th>
                <th>Player</th>
                <th>OVR</th>
                <th>Status</th>
                <th>Homepage</th>
                <th>Public</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <Fragment key={p.id}>
                <tr
                  className={
                    editingId === p.id || profileEditId === p.id
                      ? "admin-sb-row--active"
                      : undefined
                  }
                >
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(p.id)}
                      aria-label={`Select ${p.displayName}`}
                      onChange={() => toggleSelect(p.id)}
                    />
                  </td>
                  <td>
                    {editingId === p.id ? (
                      <div className="admin-player-edit">
                        <input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          aria-label="Display name"
                        />
                        <PlayerSlugPreview
                          displayName={editName}
                          excludeId={p.id}
                          currentSlug={p.slug}
                        />
                        <div className="admin-player-edit__actions">
                          <button
                            type="button"
                            className="admin-inline-button admin-inline-button--primary"
                            disabled={savingName}
                            onClick={() => saveDisplayName(p.id)}
                          >
                            {savingName ? "…" : "Save name"}
                          </button>
                          <button
                            type="button"
                            className="admin-link"
                            onClick={() => setEditingId(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <strong>{p.displayName}</strong>
                        <br />
                        <span className="muted">
                          {resolvePositionFullLabel(p.positionPrimary, p.positionFull)} (
                          {p.positionPrimary})
                          {parsePhilosophies(p.playingPhilosophies).length > 0 &&
                            ` · ${parsePhilosophies(p.playingPhilosophies).join(", ")}`}
                          {p.academy ? ` · ${p.academy.name}` : ""}
                          {p.slug ? ` · /players/${p.slug}` : ""}
                        </span>
                        <br />
                        <button
                          type="button"
                          className="admin-link admin-btn-sm"
                          onClick={() => startEditName(p)}
                        >
                          Edit name
                        </button>
                      </>
                    )}
                  </td>
                  <td>
                    <strong>{p.overallRating ?? "—"}</strong>
                    <br />
                    <span className="muted">
                      O {p.offensiveRating ?? "—"} · D {p.defensiveRating ?? "—"}
                    </span>
                  </td>
                  <td>
                    <select
                      value={p.registrationStatus}
                      onChange={(e) =>
                        patch(p.id, { registrationStatus: e.target.value })
                      }
                    >
                      <option value="pending">pending</option>
                      <option value="approved">approved</option>
                      <option value="rejected">rejected</option>
                    </select>
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={p.isFeatured}
                      title="Feature on homepage carousel"
                      aria-label={`Feature ${p.displayName} on homepage carousel`}
                      onChange={(e) => patch(p.id, { isFeatured: e.target.checked })}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={p.isPublic}
                      onChange={(e) => patch(p.id, { isPublic: e.target.checked })}
                    />
                  </td>
                  <td className="admin-table__actions">
                    <button
                      type="button"
                      className="admin-link admin-btn-sm"
                      onClick={() => {
                        setQuickEditId(p.id);
                        setQuickEditName(p.displayName);
                      }}
                    >
                      Quick Edit Basic Info
                    </button>
                    <button
                      type="button"
                      className="admin-link admin-btn-sm"
                      onClick={() =>
                        profileEditId === p.id ? cancelProfileEdit() : startProfileEdit(p)
                      }
                    >
                      {profileEditId === p.id ? "Close profile" : "Profile"}
                    </button>
                    <button
                      type="button"
                      className="admin-inline-button"
                      disabled={calibratingId === p.id}
                      onClick={() => recalibrate(p.id)}
                    >
                      {calibratingId === p.id ? "…" : "Recalibrate"}
                    </button>
                    <Link to={`/admin/calibration?playerId=${p.id}`} className="text-link">
                      Open
                    </Link>
                    {p.isPublic && p.slug && (
                      <Link to={`/players/${p.slug}`} className="text-link" target="_blank">
                        View
                      </Link>
                    )}
                  </td>
                </tr>
                {profileEditId === p.id && profileForm && (
                  <tr key={`${p.id}-profile`} className="admin-sb-row--detail">
                    <td colSpan={7}>
                      <div className="admin-player-profile-panel">
                        <h4 className="admin-sb-form-heading">Homepage profile</h4>
                        <div className="admin-player-profile-panel__grid">
                          <label className="admin-sb-field">
                            <span>Position (abbrev.)</span>
                            <select
                              value={profileForm.positionPrimary}
                              onChange={(e) => {
                                const positionPrimary = e.target.value;
                                setProfileForm((f) =>
                                  f
                                    ? {
                                        ...f,
                                        positionPrimary,
                                        positionFull:
                                          positionFullFromAbbreviation(positionPrimary) ??
                                          f.positionFull,
                                      }
                                    : f
                                );
                              }}
                            >
                              {POSITION_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="admin-sb-field">
                            <span>Full position title</span>
                            <input
                              value={profileForm.positionFull}
                              onChange={(e) =>
                                setProfileForm((f) =>
                                  f ? { ...f, positionFull: e.target.value } : f
                                )
                              }
                              placeholder="ATTACKING MIDFIELDER"
                            />
                          </label>
                          <label className="admin-sb-field">
                            <span>Philosophy rank #1</span>
                            <select
                              value={profileForm.philosophyRank1}
                              onChange={(e) =>
                                setProfileForm((f) =>
                                  f ? { ...f, philosophyRank1: e.target.value } : f
                                )
                              }
                            >
                              <option value="">— None —</option>
                              {SCOUTING_PHILOSOPHY_IDS.map((id) => (
                                <option key={id} value={id}>
                                  {id}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="admin-sb-field">
                            <span>Philosophy rank #2</span>
                            <select
                              value={profileForm.philosophyRank2}
                              onChange={(e) =>
                                setProfileForm((f) =>
                                  f ? { ...f, philosophyRank2: e.target.value } : f
                                )
                              }
                            >
                              <option value="">— None —</option>
                              {SCOUTING_PHILOSOPHY_IDS.filter(
                                (id) => id !== profileForm.philosophyRank1
                              ).map((id) => (
                                <option key={id} value={id}>
                                  {id}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <p className="muted admin-player-profile-panel__hint">
                          Up to two philosophies appear on featured talent cards (label + fit %).
                          Percentages auto-fill from tactical scores; optional manual score
                          overrides use playing_philosophies JSON with id and score fields.
                        </p>
                        <div className="admin-player-edit__actions">
                          <button
                            type="button"
                            className="admin-inline-button admin-inline-button--primary"
                            disabled={savingProfile}
                            onClick={() => saveProfile(p.id)}
                          >
                            {savingProfile ? "…" : "Save profile"}
                          </button>
                          <button type="button" className="admin-link" onClick={cancelProfileEdit}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </AdminTableShell>
      </div>

      {total > PAGE_SIZE && (
        <div className="admin-pagination" aria-label="Players pagination">
          <p className="muted admin-pagination__meta">
            Showing {pageStart}–{pageEnd} of {total}
          </p>
          <div className="admin-pagination__controls">
            <button
              type="button"
              className="admin-inline-button"
              disabled={page <= 0 || loading}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Previous
            </button>
            <span className="muted">
              Page {page + 1} of {totalPages}
            </span>
            <button
              type="button"
              className="admin-inline-button"
              disabled={page + 1 >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}

      <PlayerQuickEditModal
        playerId={quickEditId}
        playerName={quickEditName}
        open={quickEditId != null}
        onClose={() => setQuickEditId(null)}
        onSaved={() => {
          toast.success("Basic profile info saved");
          load();
        }}
      />

      <PlayerBulkEditModal
        open={bulkOpen}
        selectedIds={[...selectedIds]}
        selectedSlugs={selectedSlugs}
        onClose={() => setBulkOpen(false)}
        onSaved={(count, action) => {
          toast.success(`${action === "deleted" ? "Deleted" : "Updated"} ${count} players`);
          setSelectedIds(new Set());
          load();
        }}
      />
    </section>
  );
}
