import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { adminApi, type AdminPlayerRow } from "../../../api/admin";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { useAdminToast } from "../components/AdminToast";
import { PlayerSlugPreview } from "../components/PlayerSlugPreview";

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function AdminPlayersPage() {
  usePageTitle("Admin — Players");
  const toast = useAdminToast();
  const [rows, setRows] = useState<AdminPlayerRow[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [calibratingId, setCalibratingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [savingName, setSavingName] = useState(false);

  const load = useCallback(() => {
    adminApi.players(q || undefined, status || undefined).then(setRows).catch(() => {});
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
  };

  return (
    <div className="admin-page">
      <header className="page-header">
        <h1>Players</h1>
        <p className="muted">
          Toggle featured and public visibility. Edit display names with live slug preview.
        </p>
      </header>

      <div className="admin-filters">
        <input
          placeholder="Search name…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">approved</option>
          <option value="rejected">rejected</option>
        </select>
        <button
          type="button"
          className="dtp-btn dtp-btn--secondary"
          onClick={exportCsv}
          disabled={rows.length === 0}
        >
          Export CSV
        </button>
        <button type="button" className="dtp-btn dtp-btn--secondary" onClick={load}>
          Refresh
        </button>
      </div>

      <div className="admin-table-wrap">
        <table className="sip-table admin-table">
          <thead>
            <tr>
              <th>Player</th>
              <th>OVR</th>
              <th>Status</th>
              <th>Featured</th>
              <th>Public</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
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
                          className="dtp-btn dtp-btn--secondary admin-btn-sm"
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
                        {p.positionPrimary}
                        {p.slug ? ` · /player/${p.slug}` : ""}
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
                    className="dtp-btn dtp-btn--secondary admin-btn-sm"
                    disabled={calibratingId === p.id}
                    onClick={() => recalibrate(p.id)}
                  >
                    {calibratingId === p.id ? "…" : "Recalibrate"}
                  </button>
                  <Link
                    to={`/admin/calibration?playerId=${p.id}`}
                    className="text-link"
                  >
                    Open
                  </Link>
                  {p.isPublic && p.slug && (
                    <Link to={`/player/${p.slug}`} className="text-link" target="_blank">
                      View
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
