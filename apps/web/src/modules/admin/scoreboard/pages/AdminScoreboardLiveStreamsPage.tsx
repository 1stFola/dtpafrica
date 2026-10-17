import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  adminScoreboardApi,
  type AdminLiveStreamRow,
} from "../../../../api/admin-scoreboard";
import type { SbMatchListItem } from "../../../../api/scoreboard";
import { usePageTitle } from "../../../../hooks/usePageTitle";
import { useAdminToast } from "../../components/AdminToast";
import { formatAdminScoreboardError } from "../admin-scoreboard-utils";
import { AdminSbPageHeader } from "../components/AdminSbPageHeader";
import { AdminSbTableShell } from "../components/AdminSbTableShell";
import { StatusBadge } from "../components/StatusBadge";
import { MediaUrlPreview } from "../../../../components/MediaUrlPreview";
import { isYoutubeUrl } from "../../../../utils/media-url";

/*
 * Live streams are managed the way Latest videos are, not as a field on the match: a
 * match only reads as live once its recorder kicks off or an admin passes the roster
 * guard, and a stream link that waited on either would never show. Here the admin pastes
 * the YouTube link, publishes it when the broadcast is up, and unpublishes it after.
 */

type FormState = {
  title: string;
  youtubeUrl: string;
  competitionId: string;
  matchId: string;
  sortOrder: string;
};

const emptyForm = (): FormState => ({
  title: "",
  youtubeUrl: "",
  competitionId: "",
  matchId: "",
  sortOrder: "0",
});

function matchOptionLabel(match: SbMatchListItem) {
  const kickoff = match.kickoffAt ? new Date(match.kickoffAt).toLocaleString() : "";
  return [`${match.homeTeam.name} vs ${match.awayTeam.name}`, match.roundLabel, kickoff]
    .filter(Boolean)
    .join(" - ");
}

/** What the public card will say the stream is about. */
function linkedToLabel(row: AdminLiveStreamRow) {
  if (row.match) return `${row.match.homeTeam.name} vs ${row.match.awayTeam.name}`;
  if (row.competition) return row.competition.name;
  return "—";
}

export function AdminScoreboardLiveStreamsPage() {
  usePageTitle("Admin — Live streams");
  const toast = useAdminToast();
  const [rows, setRows] = useState<AdminLiveStreamRow[]>([]);
  const [competitions, setCompetitions] = useState<
    Array<{ id: string; name: string; slug: string; season: string }>
  >([]);
  const [matches, setMatches] = useState<SbMatchListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editId, setEditId] = useState<string | null>(null);
  const [matchSearch, setMatchSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [streams, picker, matchRows] = await Promise.all([
        adminScoreboardApi.listLiveStreams(),
        adminScoreboardApi.competitionPicker(),
        adminScoreboardApi.matches(),
      ]);
      setRows(streams);
      setCompetitions(picker);
      setMatches(matchRows);
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

  /* The fixture list follows the chosen competition, and the search narrows it further.
     Scheduled and live fixtures come first: those are the ones a broadcast is about. */
  const matchOptions = useMemo(() => {
    const query = matchSearch.trim().toLowerCase();
    const inScope = matches.filter(
      (m) => !form.competitionId || m.competition.id === form.competitionId
    );
    const filtered = query
      ? inScope.filter((m) =>
          `${matchOptionLabel(m)} ${m.competition.name} ${m.venue ?? ""}`
            .toLowerCase()
            .includes(query)
        )
      : inScope;
    const rank = (m: SbMatchListItem) =>
      m.status === "live" || m.status === "halftime" ? 0 : m.status === "scheduled" ? 1 : 2;
    return [...filtered].sort((a, b) => rank(a) - rank(b));
  }, [matches, matchSearch, form.competitionId]);

  const resetForm = () => {
    setEditId(null);
    setForm(emptyForm());
    setMatchSearch("");
  };

  const startEdit = (row: AdminLiveStreamRow) => {
    setEditId(row.id);
    setForm({
      title: row.title,
      youtubeUrl: row.youtubeUrl,
      competitionId: row.competitionId ?? "",
      matchId: row.matchId ?? "",
      sortOrder: String(row.sortOrder),
    });
    setMatchSearch("");
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const youtubeUrl = form.youtubeUrl.trim();
    if (!isYoutubeUrl(youtubeUrl)) {
      toast.error("Paste a YouTube link: youtube.com/watch, youtu.be or youtube.com/live");
      return;
    }
    const sortOrder = Number.parseInt(form.sortOrder, 10);
    const body = {
      title: form.title.trim(),
      youtubeUrl,
      competitionId: form.competitionId,
      matchId: form.matchId,
      sortOrder: Number.isFinite(sortOrder) && sortOrder >= 0 ? sortOrder : 0,
    };
    setSaving(true);
    try {
      if (editId) {
        await adminScoreboardApi.updateLiveStream(editId, body);
        toast.success("Live stream updated");
      } else {
        await adminScoreboardApi.createLiveStream(body);
        toast.success("Live stream created (hidden until you publish it)");
      }
      resetForm();
      await load();
    } catch (err) {
      toast.error(formatAdminScoreboardError(err));
    } finally {
      setSaving(false);
    }
  };

  const togglePublish = async (row: AdminLiveStreamRow) => {
    try {
      await adminScoreboardApi.publishLiveStream(row.id, !row.isPublished);
      toast.success(row.isPublished ? "Stream taken off Live Games" : "Stream published to Live Games");
      await load();
    } catch (e) {
      toast.error(formatAdminScoreboardError(e));
    }
  };

  const remove = async (row: AdminLiveStreamRow) => {
    if (!window.confirm(`Delete "${row.title}"?`)) return;
    try {
      await adminScoreboardApi.deleteLiveStream(row.id);
      toast.success("Live stream deleted");
      if (editId === row.id) resetForm();
      await load();
    } catch (e) {
      toast.error(formatAdminScoreboardError(e));
    }
  };

  return (
    <section className="admin-sb-section">
      <AdminSbPageHeader
        title="Live streams"
        description="YouTube broadcasts that play on the public Live Games page. Publish when the stream is up and unpublish when it ends."
        crumbs={[{ label: "Live streams" }]}
        actions={
          <a href="/scoreboard/live" target="_blank" rel="noreferrer" className="text-link">
            Public Live Games tab ↗
          </a>
        }
      />

      <form className="admin-blog-form admin-sb-panel admin-sb-highlight-form" onSubmit={onSubmit}>
        <h3 className="admin-sb-form-heading">{editId ? "Edit live stream" : "Add live stream"}</h3>
        <label className="admin-sb-field">
          <span>Title</span>
          <input
            required
            maxLength={160}
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="UFC League matchday 3 — live from Abuja"
          />
        </label>
        <label className="admin-sb-field">
          <span>YouTube URL</span>
          <input
            required
            type="url"
            value={form.youtubeUrl}
            onChange={(e) => setForm((f) => ({ ...f, youtubeUrl: e.target.value }))}
            placeholder="https://www.youtube.com/live/… or https://youtu.be/…"
          />
          <span className="muted admin-sb-field-hint">
            The share link of the live broadcast: <code>youtube.com/live/…</code>,{" "}
            <code>youtube.com/watch?v=…</code> or <code>youtu.be/…</code>. It plays embedded on the
            Live Games page, so the video must allow embedding.
          </span>
          <MediaUrlPreview url={form.youtubeUrl} kind="video" />
        </label>
        <label className="admin-sb-field">
          <span>Competition (optional)</span>
          <select
            value={form.competitionId}
            onChange={(e) =>
              setForm((f) => ({ ...f, competitionId: e.target.value, matchId: "" }))
            }
          >
            <option value="">No competition</option>
            {competitions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.season})
              </option>
            ))}
          </select>
        </label>
        <label className="admin-sb-field admin-sb-field--wide">
          <span>Fixture search (optional)</span>
          <input
            type="search"
            value={matchSearch}
            onChange={(e) => setMatchSearch(e.target.value)}
            placeholder="Search by team, round or kickoff"
            aria-label="Search fixtures"
          />
        </label>
        <label className="admin-sb-field">
          <span>Fixture (optional)</span>
          <select
            value={form.matchId}
            onChange={(e) => setForm((f) => ({ ...f, matchId: e.target.value }))}
          >
            <option value="">No fixture</option>
            {matchOptions.length === 0 && (
              <option value="" disabled>
                No fixtures found
              </option>
            )}
            {matchOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {matchOptionLabel(m)}
              </option>
            ))}
          </select>
          <span className="muted admin-sb-field-hint">
            Linking a fixture puts its teams and a Match Centre link on the card.
          </span>
        </label>
        <label className="admin-sb-field">
          <span>Order</span>
          <input
            type="number"
            min={0}
            max={999}
            value={form.sortOrder}
            onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))}
          />
          <span className="muted admin-sb-field-hint">Lower numbers play first.</span>
        </label>
        <div className="admin-sb-form-actions">
          <button
            type="submit"
            className="admin-inline-button admin-inline-button--primary"
            disabled={saving || loading}
          >
            {saving ? "Saving…" : editId ? "Save changes" : "Create live stream"}
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
            <h3>Streams</h3>
            <p className="muted">
              Published streams play on the Live Games page in this order; unpublished ones stay
              here.
            </p>
          </div>
          {!loading && rows.length > 0 && (
            <span className="admin-sb-badge">{rows.length} total</span>
          )}
        </header>
        <div className="admin-sb-content-panel">
          <AdminSbTableShell
            loading={loading}
            empty={!loading && rows.length === 0}
            emptyTitle="No live streams yet"
            emptyHint="Add a stream above — it stays hidden until you publish it."
            columns={6}
          >
            <table className="admin-table admin-sb-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Linked to</th>
                  <th>Order</th>
                  <th>Status</th>
                  <th>Published</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className={editId === row.id ? "admin-sb-row--active" : undefined}
                  >
                    <td>
                      <strong>{row.title}</strong>
                      <br />
                      <a
                        href={row.youtubeUrl}
                        className="text-link"
                        target="_blank"
                        rel="noreferrer"
                      >
                        YouTube ↗
                      </a>
                    </td>
                    <td className="muted">{linkedToLabel(row)}</td>
                    <td>
                      <code>{row.sortOrder}</code>
                    </td>
                    <td>
                      <StatusBadge status={row.isPublished ? "ongoing" : "draft"} />
                    </td>
                    <td className="muted">
                      {row.publishedAt ? new Date(row.publishedAt).toLocaleString() : "—"}
                    </td>
                    <td className="admin-table__actions">
                      <button type="button" className="admin-link" onClick={() => startEdit(row)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="admin-link"
                        onClick={() => void togglePublish(row)}
                      >
                        {row.isPublished ? "Unpublish" : "Publish"}
                      </button>
                      <button
                        type="button"
                        className="admin-link-danger"
                        onClick={() => void remove(row)}
                      >
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
