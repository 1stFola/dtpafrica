import { Fragment, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { adminApi, type AdminPlayerRow } from "../../../api/admin";
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
import { PlayerSlugPreview } from "../components/PlayerSlugPreview";

const POSITION_OPTIONS = positionAbbreviationOptions();

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
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [calibratingId, setCalibratingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [profileEditId, setProfileEditId] = useState<string | null>(null);
  const [profileForm, setProfileForm] = useState<ProfileFormState | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    adminApi
      .players(q || undefined, status || undefined)
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [q, status]);

  useEffect(() => {
    load();
  }, [load]);

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
            placeholder="Search name…"
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
          columns={6}
        >
          <table className="admin-table admin-sb-table">
            <thead>
              <tr>
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
                    <td colSpan={6}>
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
    </section>
  );
}
