import { useCallback, useEffect, useMemo, useState } from "react";
import { adminApi, type AdminContactMessage } from "../../../api/admin";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { useAdminToast } from "../components/AdminToast";
import { AdminPageHeader } from "../components/AdminPageHeader";
import { AdminTableShell } from "../components/AdminTableShell";

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function AdminInboxPage() {
  usePageTitle("Admin — Inbox");
  const toast = useAdminToast();
  const [rows, setRows] = useState<AdminContactMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState("active");
  const [q, setQ] = useState("");

  const selected = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? rows[0] ?? null,
    [rows, selectedId]
  );

  const load = useCallback(() => {
    setLoading(true);
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
      .catch((e) => {
        toast.error(String(e));
        setRows([]);
      })
      .finally(() => setLoading(false));
  }, [q, status, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const runAction = async (action: () => Promise<unknown>, ok: string) => {
    try {
      await action();
      toast.success(ok);
      load();
    } catch (e) {
      toast.error(String(e));
    }
  };

  const deleteSelected = async () => {
    if (!selected || !window.confirm("Delete this message permanently?")) return;
    await runAction(() => adminApi.inboxDelete(selected.id), "Message deleted");
  };

  return (
    <section className="admin-page admin-sb-section">
      <AdminPageHeader
        title="Inbox"
        description="Review contact form submissions and keep active work visible."
        crumbs={[{ label: "Inbox" }]}
      />

      <div className="admin-sb-sticky-bar">
        <div className="admin-filters admin-filters--with-action">
          <input
            placeholder="Search name, email, subject…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search messages"
          />
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter">
            <option value="active">Active</option>
            <option value="unread">Unread</option>
            <option value="read">Read</option>
            <option value="archived">Archived</option>
            <option value="all">All</option>
          </select>
          <button type="button" className="admin-inline-button" onClick={load}>
            Refresh
          </button>
        </div>
      </div>

      <div className="admin-split">
        <div className="admin-sb-content-panel admin-split__list">
          <AdminTableShell
            loading={loading}
            empty={!loading && rows.length === 0}
            emptyTitle="No messages match this filter"
            emptyHint="Try a different status or search term."
            columns={4}
          >
            <table className="admin-table admin-sb-table admin-table--clickable">
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
                    className={row.id === selected?.id ? "admin-sb-row--active" : undefined}
                    onClick={() => setSelectedId(row.id)}
                  >
                    <td>
                      <strong>{row.name}</strong>
                      <br />
                      <span className="muted">{row.email}</span>
                    </td>
                    <td>{row.subject || "Contact form message"}</td>
                    <td>
                      <span
                        className={
                          row.archivedAt
                            ? "admin-sb-status admin-sb-status--archived"
                            : row.readAt
                              ? "admin-sb-status admin-sb-status--draft"
                              : "admin-sb-status admin-sb-status--live"
                        }
                      >
                        {row.archivedAt ? "archived" : row.readAt ? "read" : "unread"}
                      </span>
                    </td>
                    <td>{formatDate(row.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminTableShell>
        </div>

        <aside className="admin-detail-panel admin-sb-panel">
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
                <span
                  className={
                    selected.archivedAt
                      ? "admin-sb-status admin-sb-status--archived"
                      : selected.readAt
                        ? "admin-sb-status admin-sb-status--draft"
                        : "admin-sb-status admin-sb-status--live"
                  }
                >
                  {selected.archivedAt ? "archived" : selected.readAt ? "read" : "unread"}
                </span>
              </div>
              <p className="admin-message-body">{selected.message}</p>
              <p className="muted">Received {formatDate(selected.createdAt)}</p>
              <div className="admin-table__actions">
                <button
                  type="button"
                  className="admin-inline-button"
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
                  className="admin-inline-button"
                  onClick={() =>
                    runAction(
                      () => adminApi.inboxArchive(selected.id, !selected.archivedAt),
                      selected.archivedAt ? "Restored" : "Archived"
                    )
                  }
                >
                  {selected.archivedAt ? "Restore" : "Archive"}
                </button>
                <button type="button" className="admin-link-danger" onClick={deleteSelected}>
                  Delete
                </button>
              </div>
            </>
          ) : (
            <div className="admin-sb-empty-state dtp-empty-state admin-sb-empty-state--compact">
              <p className="admin-sb-empty-state__title dtp-empty-state__title">
                Select a message
              </p>
              <p className="muted">Choose a row from the list to read and take action.</p>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
