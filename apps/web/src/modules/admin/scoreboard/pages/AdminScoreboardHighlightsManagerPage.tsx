import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  adminScoreboardApi,
  type AdminHighlightRow,
} from "../../../../api/admin-scoreboard";
import { usePageTitle } from "../../../../hooks/usePageTitle";
import { useAdminToast } from "../../components/AdminToast";
import { DurationInput, isValidDuration } from "../../components/DurationInput";
import { formatAdminScoreboardError } from "../admin-scoreboard-utils";
import { AdminSbPageHeader } from "../components/AdminSbPageHeader";
import { AdminSbTableShell } from "../components/AdminSbTableShell";
import { StatusBadge } from "../components/StatusBadge";
import { MediaUrlFieldHint } from "../../../../components/MediaUrlFieldHint";
import { MediaUrlPreview } from "../../../../components/MediaUrlPreview";

type FormState = {
  title: string;
  youtubeUrl: string;
  duration: string;
  competitionId: string;
};

const emptyForm = (): FormState => ({
  title: "",
  youtubeUrl: "",
  duration: "",
  competitionId: "",
});

export function AdminScoreboardHighlightsManagerPage() {
  usePageTitle("Admin — Latest highlights");
  const toast = useAdminToast();
  const [rows, setRows] = useState<AdminHighlightRow[]>([]);
  const [competitions, setCompetitions] = useState<
    Array<{ id: string; name: string; slug: string; season: string }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editId, setEditId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [highlights, picker] = await Promise.all([
        adminScoreboardApi.listHighlights(),
        adminScoreboardApi.competitionPicker(),
      ]);
      setRows(highlights.filter((h) => !h.matchId || h.duration));
      setCompetitions(picker);
      setForm((prev) => ({
        ...prev,
        competitionId: prev.competitionId || picker[0]?.id || "",
      }));
    } catch (e) {
      toast.error(formatAdminScoreboardError(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const resetForm = () => {
    setEditId(null);
    setForm({ ...emptyForm(), competitionId: competitions[0]?.id ?? "" });
  };

  const startEdit = (row: AdminHighlightRow) => {
    setEditId(row.id);
    setForm({
      title: row.title,
      youtubeUrl: row.youtubeUrl,
      duration: row.duration ?? "",
      competitionId: row.competitionId ?? competitions[0]?.id ?? "",
    });
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isValidDuration(form.duration)) {
      toast.error("Duration must be MM:SS (e.g. 03:45)");
      return;
    }
    if (!form.competitionId) {
      toast.error("Select a competition");
      return;
    }
    setSaving(true);
    try {
      if (editId) {
        await adminScoreboardApi.updateHighlight(editId, {
          title: form.title.trim(),
          youtubeUrl: form.youtubeUrl.trim(),
          duration: form.duration.trim(),
          competitionId: form.competitionId,
        });
        toast.success("Highlight updated");
      } else {
        await adminScoreboardApi.createLandingHighlight({
          title: form.title.trim(),
          youtubeUrl: form.youtubeUrl.trim(),
          duration: form.duration.trim(),
          competitionId: form.competitionId,
        });
        toast.success("Highlight created (unpublished until toggled)");
      }
      resetForm();
      await load();
    } catch (err) {
      toast.error(formatAdminScoreboardError(err));
    } finally {
      setSaving(false);
    }
  };

  const togglePublish = async (row: AdminHighlightRow) => {
    try {
      await adminScoreboardApi.publishHighlight(row.id, !row.isPublished);
      toast.success(row.isPublished ? "Highlight hidden" : "Highlight published");
      await load();
    } catch (e) {
      toast.error(formatAdminScoreboardError(e));
    }
  };

  const remove = async (row: AdminHighlightRow) => {
    if (!window.confirm(`Delete "${row.title}"?`)) return;
    try {
      await adminScoreboardApi.deleteHighlight(row.id);
      toast.success("Highlight deleted");
      if (editId === row.id) resetForm();
      await load();
    } catch (e) {
      toast.error(formatAdminScoreboardError(e));
    }
  };

  return (
    <section className="admin-sb-section">
      <AdminSbPageHeader
        title="Latest highlights"
        description="Manage landing-page video cards shown on ScoreBoard home and highlights feed."
        crumbs={[{ label: "Highlights manager" }]}
        actions={
          <a href="/scoreboard/highlights" target="_blank" rel="noreferrer" className="text-link">
            Public highlights tab ↗
          </a>
        }
      />

      <form className="admin-blog-form admin-sb-panel admin-sb-highlight-form" onSubmit={onSubmit}>
        <h3 className="admin-sb-form-heading">{editId ? "Edit highlight" : "Add highlight"}</h3>
        <label className="admin-sb-field">
          <span>Title</span>
          <input
            required
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="Jagaban Cup final highlights"
          />
        </label>
        <label className="admin-sb-field">
          <span>Video URL</span>
          <input
            required
            type="url"
            value={form.youtubeUrl}
            onChange={(e) => setForm((f) => ({ ...f, youtubeUrl: e.target.value }))}
            placeholder="YouTube or Google Drive /file/d/…/view"
          />
          <MediaUrlFieldHint kind="video" />
          <MediaUrlPreview url={form.youtubeUrl} kind="video" />
        </label>
        <label className="admin-sb-field">
          <span>Duration (MM:SS)</span>
          <DurationInput
            required
            value={form.duration}
            onChange={(duration) => setForm((f) => ({ ...f, duration }))}
          />
        </label>
        <label className="admin-sb-field">
          <span>Competition</span>
          <select
            required
            value={form.competitionId}
            onChange={(e) => setForm((f) => ({ ...f, competitionId: e.target.value }))}
          >
            <option value="">Select competition…</option>
            {competitions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.season})
              </option>
            ))}
          </select>
        </label>
        <div className="admin-sb-form-actions">
          <button type="submit" className="admin-inline-button admin-inline-button--primary" disabled={saving || loading}>
            {saving ? "Saving…" : editId ? "Save changes" : "Create highlight"}
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
            <p className="muted">Landing-page cards — toggle publish to show on public ScoreBoard.</p>
          </div>
          {!loading && rows.length > 0 && (
            <span className="admin-sb-badge">{rows.length} total</span>
          )}
        </header>
        <div className="admin-sb-content-panel">
      <AdminSbTableShell
        loading={loading}
        empty={!loading && rows.length === 0}
        emptyTitle="No landing highlights yet"
        emptyHint="Create a highlight above — it stays hidden until you publish."
        columns={6}
      >
        <table className="admin-table admin-sb-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Duration</th>
              <th>Competition</th>
              <th>Status</th>
              <th>Published</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={editId === row.id ? "admin-sb-row--active" : undefined}>
                <td>
                  <strong>{row.title}</strong>
                  <br />
                  <a href={row.youtubeUrl} className="text-link" target="_blank" rel="noreferrer">
                    Video ↗
                  </a>
                </td>
                <td>
                  <code>{row.duration ?? "—"}</code>
                </td>
                <td>{row.competition?.name ?? "—"}</td>
                <td>
                  <StatusBadge status={row.isPublished ? "ongoing" : "draft"} />
                </td>
                <td className="muted">
                  {row.publishedAt
                    ? new Date(row.publishedAt).toLocaleDateString()
                    : "—"}
                </td>
                <td className="admin-table__actions">
                  <button type="button" className="admin-link" onClick={() => startEdit(row)}>
                    Edit
                  </button>
                  <button type="button" className="admin-link" onClick={() => togglePublish(row)}>
                    {row.isPublished ? "Unpublish" : "Publish"}
                  </button>
                  <button type="button" className="admin-link-danger" onClick={() => remove(row)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </AdminSbTableShell>
        </div>
      </div>
    </section>
  );
}
