import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { adminApi, type AdminPlayerRow } from "../../../api/admin";
import { usePageTitle } from "../../../hooks/usePageTitle";

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function AdminPlayersPage() {
  usePageTitle("Admin — Players");
  const [rows, setRows] = useState<AdminPlayerRow[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [calibratingId, setCalibratingId] = useState<string | null>(null);

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
    setMessage(null);
    try {
      await adminApi.updatePlayer(id, patch);
      setMessage("Saved");
      load();
    } catch (e) {
      setMessage(String(e));
    }
  };

  const recalibrate = async (id: string) => {
    setMessage(null);
    setCalibratingId(id);
    try {
      const result = await adminApi.calibratePlayer(id);
      setMessage(
        `Recalibrated ${result.displayName}: OVR ${result.calibratedSummary.overall_rating}`
      );
      load();
    } catch (e) {
      setMessage(String(e));
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
          Toggle featured and public visibility. Recalibrate ratings from stored match metrics.
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

      {message && <p className="muted">{message}</p>}

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
                  <strong>{p.displayName}</strong>
                  <br />
                  <span className="muted">
                    {p.positionPrimary}
                    {p.slug ? ` · /player/${p.slug}` : ""}
                  </span>
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
