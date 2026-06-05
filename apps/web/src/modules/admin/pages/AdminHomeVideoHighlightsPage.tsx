import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { adminApi } from "../../../api/admin";
import type { HomeVideoHighlight } from "../../../api/client";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { useAdminToast } from "../components/AdminToast";
import { AdminPageHeader } from "../components/AdminPageHeader";
import { AdminTableShell } from "../components/AdminTableShell";

const CONTENT_KEY = "homepage.video-highlights";

type FormState = {
  playerName: string;
  title: string;
  description: string;
  youtubeUrl: string;
};

const emptyForm = (): FormState => ({
  playerName: "",
  title: "",
  description: "",
  youtubeUrl: "",
});

function parseHighlights(raw?: string): HomeVideoHighlight[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as HomeVideoHighlight[]) : [];
  } catch {
    return [];
  }
}

export function AdminHomeVideoHighlightsPage() {
  usePageTitle("Admin — Homepage video highlights");
  const toast = useAdminToast();
  const [rows, setRows] = useState<HomeVideoHighlight[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editId, setEditId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const content = await adminApi.contentList();
      const row = content.find((r) => r.key === CONTENT_KEY);
      setRows(parseHighlights(row?.value));
    } catch (e) {
      toast.error(String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const persist = async (next: HomeVideoHighlight[]) => {
    setSaving(true);
    try {
      await adminApi.contentUpsert(CONTENT_KEY, JSON.stringify(next, null, 2));
      setRows(next);
      toast.success("Video highlights saved");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setEditId(null);
    setForm(emptyForm());
  };

  const startEdit = (row: HomeVideoHighlight) => {
    setEditId(row.id);
    setForm({
      playerName: row.playerName,
      title: row.title,
      description: row.description ?? "",
      youtubeUrl: row.youtubeUrl,
    });
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const playerName = form.playerName.trim();
    const title = form.title.trim();
    const description = form.description.trim();
    const youtubeUrl = form.youtubeUrl.trim();
    if (!playerName || !title || !youtubeUrl) {
      toast.error("Player name, title, and YouTube URL are required");
      return;
    }

    if (editId) {
      const next = rows.map((row) =>
        row.id === editId
          ? { ...row, playerName, title, description: description || undefined, youtubeUrl }
          : row
      );
      await persist(next);
      resetForm();
      return;
    }

    const next: HomeVideoHighlight[] = [
      ...rows,
      {
        id: crypto.randomUUID(),
        playerName,
        title,
        description: description || undefined,
        youtubeUrl,
        sortOrder: rows.length,
      },
    ];
    await persist(next);
    resetForm();
  };

  const remove = async (row: HomeVideoHighlight) => {
    if (!window.confirm(`Delete "${row.title}"?`)) return;
    const next = rows
      .filter((r) => r.id !== row.id)
      .map((r, index) => ({ ...r, sortOrder: index }));
    await persist(next);
    if (editId === row.id) resetForm();
  };

  const move = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    await persist(next.map((r, i) => ({ ...r, sortOrder: i })));
  };

  return (
    <section className="admin-page admin-sb-section">
      <AdminPageHeader
        title="Homepage video highlights"
        description="Manage YouTube clips shown in the Player Highlights section on the public homepage."
        crumbs={[
          { label: "Homepage", to: "/admin/homepage" },
          { label: "Video highlights" },
        ]}
        actions={
          <Link to="/" target="_blank" rel="noreferrer" className="text-link">
            View homepage ↗
          </Link>
        }
      />

      <form className="admin-blog-form admin-sb-panel admin-sb-highlight-form" onSubmit={onSubmit}>
        <h3 className="admin-sb-form-heading">
          {editId ? "Edit highlight" : "Add highlight"}
        </h3>
        <label className="admin-sb-field">
          <span>Player name</span>
          <input
            required
            value={form.playerName}
            onChange={(e) => setForm((f) => ({ ...f, playerName: e.target.value }))}
            placeholder="Sikiru"
          />
        </label>
        <label className="admin-sb-field">
          <span>Highlight title</span>
          <input
            required
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="Defensive prowess vs Ikorodu City"
          />
        </label>
        <label className="admin-sb-field admin-sb-field--wide">
          <span>Custom description</span>
          <textarea
            rows={3}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="Optional context shown under the title on the homepage carousel."
          />
        </label>
        <label className="admin-sb-field admin-sb-field--wide">
          <span>YouTube URL</span>
          <input
            required
            type="url"
            value={form.youtubeUrl}
            onChange={(e) => setForm((f) => ({ ...f, youtubeUrl: e.target.value }))}
            placeholder="https://youtube.com/watch?v=…"
          />
        </label>
        <div className="admin-sb-form-actions">
          <button
            type="submit"
            className="admin-inline-button admin-inline-button--primary"
            disabled={saving || loading}
          >
            {saving ? "Saving…" : editId ? "Save changes" : "Add highlight"}
          </button>
          {editId && (
            <button type="button" className="dtp-btn dtp-btn--secondary" onClick={resetForm}>
              Cancel edit
            </button>
          )}
        </div>
      </form>

      <div className="admin-sb-data-section">
        <header className="admin-sb-data-section__head">
          <div>
            <h3>Published catalog</h3>
            <p className="muted">Order controls homepage carousel sequence (left to right).</p>
          </div>
          {!loading && rows.length > 0 && (
            <span className="admin-sb-badge">{rows.length} total</span>
          )}
        </header>
        <div className="admin-sb-content-panel">
          <AdminTableShell
            loading={loading}
            empty={!loading && rows.length === 0}
            emptyTitle="No homepage highlights yet"
            emptyHint="Add a YouTube clip above — it appears in the Player Highlights section."
            columns={5}
          >
            <table className="admin-table admin-sb-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Player</th>
                  <th>Title</th>
                  <th>Video</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr
                    key={row.id}
                    className={editId === row.id ? "admin-sb-row--active" : undefined}
                  >
                    <td>
                      <div className="admin-table__actions">
                        <button
                          type="button"
                          className="admin-link"
                          disabled={index === 0 || saving}
                          onClick={() => move(index, -1)}
                          aria-label="Move up"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="admin-link"
                          disabled={index === rows.length - 1 || saving}
                          onClick={() => move(index, 1)}
                          aria-label="Move down"
                        >
                          ↓
                        </button>
                      </div>
                    </td>
                    <td>
                      <strong>{row.playerName}</strong>
                    </td>
                    <td>
                      {row.title}
                      {row.description && (
                        <>
                          <br />
                          <span className="muted">{row.description}</span>
                        </>
                      )}
                    </td>
                    <td>
                      <a href={row.youtubeUrl} className="text-link" target="_blank" rel="noreferrer">
                        Watch ↗
                      </a>
                    </td>
                    <td className="admin-table__actions">
                      <button type="button" className="admin-link" onClick={() => startEdit(row)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="admin-link-danger"
                        disabled={saving}
                        onClick={() => remove(row)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminTableShell>
        </div>
      </div>
    </section>
  );
}
