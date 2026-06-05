import { useCallback, useEffect, useMemo, useState } from "react";
import { adminApi, type AdminContactMessage } from "../../../api/admin";
import { usePageTitle } from "../../../hooks/usePageTitle";

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function AdminInboxPage() {
  usePageTitle("Admin — Inbox");
  const [rows, setRows] = useState<AdminContactMessage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState("active");
  const [q, setQ] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const selected = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? rows[0] ?? null,
    [rows, selectedId]
  );

  const load = useCallback(() => {
    adminApi
      .inbox(status, q || undefined)
      .then((items) => {
        setRows(items);
        setSelectedId((current) =>
          current && items.some((item) => item.id === current)
            ? current
            : items[0]?.id ?? null
        );
      })
      .catch((e) => setMessage(String(e)));
  }, [q, status]);

  useEffect(() => {
    load();
  }, [load]);

  const runAction = async (action: () => Promise<unknown>, ok: string) => {
    setMessage(null);
    try {
      await action();
      setMessage(ok);
      load();
    } catch (e) {
      setMessage(String(e));
    }
  };

  const deleteSelected = async () => {
    if (!selected || !window.confirm("Delete this message permanently?")) return;
    await runAction(() => adminApi.inboxDelete(selected.id), "Deleted");
  };

  return (
    <div className="admin-page">
      <header className="page-header admin-page-header">
        <div>
          <h1>Inbox</h1>
          <p className="muted">Review contact form submissions and keep active work visible.</p>
        </div>
      </header>

      <div className="admin-filters">
        <input
          placeholder="Search name, email, subject…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="active">Active</option>
          <option value="unread">Unread</option>
          <option value="read">Read</option>
          <option value="archived">Archived</option>
          <option value="all">All</option>
        </select>
        <button type="button" className="dtp-btn dtp-btn--secondary" onClick={load}>
          Refresh
        </button>
      </div>

      {message && <p className="muted">{message}</p>}

      <div className="admin-split">
        <div className="admin-table-wrap">
          <table className="sip-table admin-table">
            <thead>
              <tr>
                <th>Sender</th>
                <th>Subject</th>
                <th>Status</th>
                <th>Received</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className={row.id === selected?.id ? "admin-row-active" : undefined}
                  onClick={() => setSelectedId(row.id)}
                >
                  <td>
                    <strong>{row.name}</strong>
                    <br />
                    <span className="muted">{row.email}</span>
                  </td>
                  <td>{row.subject || "Contact form message"}</td>
                  <td>
                    <span className={row.readAt ? "admin-pill" : "admin-pill admin-pill--live"}>
                      {row.archivedAt ? "archived" : row.readAt ? "read" : "unread"}
                    </span>
                  </td>
                  <td>{formatDate(row.createdAt)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    No contact messages match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <aside className="admin-detail-panel">
          {selected ? (
            <>
              <div className="admin-detail-panel__header">
                <div>
                  <h2>{selected.subject || "Contact form message"}</h2>
                  <p className="muted">
                    {selected.name} ·{" "}
                    <a href={`mailto:${selected.email}`} className="text-link">
                      {selected.email}
                    </a>
                    {selected.phone ? ` · ${selected.phone}` : ""}
                  </p>
                </div>
                <span className={selected.readAt ? "admin-pill" : "admin-pill admin-pill--live"}>
                  {selected.archivedAt ? "archived" : selected.readAt ? "read" : "unread"}
                </span>
              </div>
              <p className="admin-message-body">{selected.message}</p>
              <p className="muted">Received {formatDate(selected.createdAt)}</p>
              <div className="admin-table__actions">
                <button
                  type="button"
                  className="dtp-btn dtp-btn--secondary admin-btn-sm"
                  onClick={() =>
                    runAction(
                      () => adminApi.inboxRead(selected.id, !selected.readAt),
                      selected.readAt ? "Marked unread" : "Marked read"
                    )
                  }
                >
                  {selected.readAt ? "Mark unread" : "Mark read"}
                </button>
                <button
                  type="button"
                  className="dtp-btn dtp-btn--secondary admin-btn-sm"
                  onClick={() =>
                    runAction(
                      () => adminApi.inboxArchive(selected.id, !selected.archivedAt),
                      selected.archivedAt ? "Restored" : "Archived"
                    )
                  }
                >
                  {selected.archivedAt ? "Restore" : "Archive"}
                </button>
                <button
                  type="button"
                  className="admin-link-danger"
                  onClick={deleteSelected}
                >
                  Delete
                </button>
              </div>
            </>
          ) : (
            <p className="muted">Select a message to view details.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
