import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  adminScoreboardApi,
  type AdminHighlightRow,
} from "../../../../api/admin-scoreboard";
import type { SbMatchListItem } from "../../../../api/scoreboard";
import { usePageTitle } from "../../../../hooks/usePageTitle";
import { useAdminToast } from "../../components/AdminToast";
import { formatAdminScoreboardError } from "../admin-scoreboard-utils";
import { AdminSbPageHeader } from "../components/AdminSbPageHeader";
import { AdminSbTableShell } from "../components/AdminSbTableShell";
import { StatusBadge } from "../components/StatusBadge";
import { MediaUrlFieldHint } from "../../../../components/MediaUrlFieldHint";
import { MediaUrlPreview } from "../../../../components/MediaUrlPreview";

function matchLabel(row: AdminHighlightRow) {
  if (!row.match) return "-";
  return `${row.match.homeTeam.name} vs ${row.match.awayTeam.name}`;
}

function matchOptionLabel(match: SbMatchListItem) {
  const kickoff = match.kickoffAt ? new Date(match.kickoffAt).toLocaleString() : "";
  return [
    `${match.homeTeam.name} vs ${match.awayTeam.name}`,
    match.competition.name,
    match.roundLabel,
    match.venue,
    kickoff,
  ]
    .filter(Boolean)
    .join(" - ");
}

function filterMatches(matches: SbMatchListItem[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return matches;
  return matches.filter((match) => matchOptionLabel(match).toLowerCase().includes(normalized));
}

export function AdminScoreboardHighlightsPage() {
  usePageTitle("Admin - Match highlights");
  const toast = useAdminToast();
  const [matches, setMatches] = useState<SbMatchListItem[]>([]);
  const [rows, setRows] = useState<AdminHighlightRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [videoUrl, setVideoUrl] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [videoMatchSearch, setVideoMatchSearch] = useState("");
  const [photoMatchSearch, setPhotoMatchSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [matchRows, highlights] = await Promise.all([
        adminScoreboardApi.matches(),
        adminScoreboardApi.listHighlights(),
      ]);
      setMatches(matchRows);
      setRows(highlights.filter((h) => h.matchId && !h.duration));
    } catch {
      setMatches([]);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const videoRows = useMemo(
    () => rows.filter((row) => row.mediaType !== "photo"),
    [rows]
  );
  const photoRows = useMemo(
    () => rows.filter((row) => row.mediaType === "photo"),
    [rows]
  );
  const videoMatches = useMemo(
    () => filterMatches(matches, videoMatchSearch),
    [matches, videoMatchSearch]
  );
  const photoMatches = useMemo(
    () => filterMatches(matches, photoMatchSearch),
    [matches, photoMatchSearch]
  );

  const onVideoSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const matchId = String(fd.get("matchId"));
    const title = String(fd.get("title"));
    const youtubeUrl = String(fd.get("youtubeUrl"));
    const timelineMinute = fd.get("timelineMinute")
      ? Number(fd.get("timelineMinute"))
      : undefined;
    const thumb = String(fd.get("thumbnailUrl") || "") || undefined;
    try {
      await adminScoreboardApi.createHighlight({
        matchId,
        title,
        type: "video",
        youtubeUrl,
        timelineMinute,
        thumbnailUrl: thumb,
      });
      toast.success("Video clip queued (unpublished until reviewed)");
      form.reset();
      setVideoUrl("");
      setThumbnailUrl("");
      setVideoMatchSearch("");
      await load();
    } catch (err) {
      toast.error(formatAdminScoreboardError(err));
    }
  };

  const onPhotoSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const matchId = String(fd.get("matchId"));
    const title = String(fd.get("title"));
    const imageUrl = String(fd.get("imageUrl"));
    try {
      await adminScoreboardApi.createHighlight({
        matchId,
        title,
        type: "photo",
        imageUrl,
      });
      toast.success("Match photo queued (unpublished until reviewed)");
      form.reset();
      setPhotoUrl("");
      setPhotoMatchSearch("");
      await load();
    } catch (err) {
      toast.error(formatAdminScoreboardError(err));
    }
  };

  const togglePublish = async (row: AdminHighlightRow) => {
    try {
      await adminScoreboardApi.publishHighlight(row.id, !row.isPublished);
      toast.success(row.isPublished ? "Unpublished" : "Published");
      await load();
    } catch (err) {
      toast.error(formatAdminScoreboardError(err));
    }
  };

  const remove = async (row: AdminHighlightRow) => {
    if (!window.confirm(`Delete "${row.title}"?`)) return;
    try {
      await adminScoreboardApi.deleteHighlight(row.id);
      toast.success("Deleted");
      await load();
    } catch (err) {
      toast.error(formatAdminScoreboardError(err));
    }
  };

  return (
    <section className="admin-sb-section">
      <AdminSbPageHeader
        title="Match highlights"
        description="Attach video clips and match photos for ScoreBoard playback."
        crumbs={[{ label: "Highlights" }]}
        actions={
          <Link to="/admin/scoreboard/highlights-manager" className="text-link">
            Latest videos manager &rarr;
          </Link>
        }
      />

      {loading ? (
        <div
          className="admin-sb-panel admin-sb-highlight-form admin-sb-highlight-form--loading"
          aria-busy="true"
        >
          {Array.from({ length: 5 }).map((_, i) => (
            <span key={i} className="admin-sb-skeleton admin-sb-skeleton--field" />
          ))}
        </div>
      ) : matches.length === 0 ? (
        <div className="admin-sb-empty-state dtp-empty-state">
          <p className="admin-sb-empty-state__title dtp-empty-state__title">No matches available</p>
          <p className="muted">Create fixtures in Master records before attaching match clips.</p>
        </div>
      ) : (
        <>
          <form
            className="admin-blog-form admin-sb-highlight-form admin-sb-panel"
            onSubmit={onVideoSubmit}
          >
            <h3 className="admin-sb-form-heading">New match clip</h3>
            <label className="admin-sb-field admin-sb-field--wide">
              <span>Match search</span>
              <input
                type="search"
                value={videoMatchSearch}
                onChange={(e) => setVideoMatchSearch(e.target.value)}
                placeholder="Search by team, competition, venue, round, or kickoff"
                aria-label="Search video clip match"
              />
            </label>
            <label className="admin-sb-field">
              <span>Match reference</span>
              <select name="matchId" required>
                <option value="">Select match...</option>
                {videoMatches.length === 0 && (
                  <option value="" disabled>
                    No matches found
                  </option>
                )}
                {videoMatches.map((m) => (
                  <option key={m.id} value={m.id}>
                    {matchOptionLabel(m)}
                  </option>
                ))}
              </select>
            </label>
            <label className="admin-sb-field">
              <span>Title</span>
              <input name="title" required placeholder="e.g. Opening goal - 23'" />
            </label>
            <label className="admin-sb-field">
              <span>Timeline minute</span>
              <input name="timelineMinute" type="number" min={0} max={130} placeholder="23" />
            </label>
            <label className="admin-sb-field">
              <span>Video URL</span>
              <input
                name="youtubeUrl"
                type="url"
                required
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder="YouTube or Google Drive /file/d/.../view"
              />
              <MediaUrlFieldHint kind="video" />
              <MediaUrlPreview url={videoUrl} kind="video" />
            </label>
            <label className="admin-sb-field admin-sb-field--wide">
              <span>Thumbnail URL (optional)</span>
              <input
                name="thumbnailUrl"
                type="url"
                value={thumbnailUrl}
                onChange={(e) => setThumbnailUrl(e.target.value)}
                placeholder="Google Photos or https://... image"
              />
              <MediaUrlFieldHint kind="image" />
              <MediaUrlPreview url={thumbnailUrl} kind="image" />
            </label>
            <div className="admin-sb-form-actions">
              <button type="submit" className="admin-inline-button admin-inline-button--primary">
                Upload video clip
              </button>
            </div>
          </form>

          <form
            className="admin-blog-form admin-sb-highlight-form admin-sb-panel"
            onSubmit={onPhotoSubmit}
          >
            <h3 className="admin-sb-form-heading">New match photo</h3>
            <label className="admin-sb-field admin-sb-field--wide">
              <span>Match search</span>
              <input
                type="search"
                value={photoMatchSearch}
                onChange={(e) => setPhotoMatchSearch(e.target.value)}
                placeholder="Search by team, competition, venue, round, or kickoff"
                aria-label="Search match photo match"
              />
            </label>
            <label className="admin-sb-field">
              <span>Match reference</span>
              <select name="matchId" required>
                <option value="">Select match...</option>
                {photoMatches.length === 0 && (
                  <option value="" disabled>
                    No matches found
                  </option>
                )}
                {photoMatches.map((m) => (
                  <option key={m.id} value={m.id}>
                    {matchOptionLabel(m)}
                  </option>
                ))}
              </select>
            </label>
            <label className="admin-sb-field">
              <span>Title / caption</span>
              <input name="title" required placeholder="e.g. Full-time celebrations" />
            </label>
            <label className="admin-sb-field admin-sb-field--wide">
              <span>Photo URL</span>
              <input
                name="imageUrl"
                type="url"
                required
                value={photoUrl}
                onChange={(e) => setPhotoUrl(e.target.value)}
                placeholder="Google Photos or https://... image"
              />
              <MediaUrlFieldHint kind="image" />
              <MediaUrlPreview url={photoUrl} kind="image" />
            </label>
            <div className="admin-sb-form-actions">
              <button type="submit" className="admin-inline-button admin-inline-button--primary">
                Add match photo
              </button>
            </div>
          </form>
        </>
      )}

      {!loading && (
        <div className="admin-sb-content-panel">
          <header className="admin-sb-content-panel__header">
            <h3>Match video clips</h3>
            {videoRows.length > 0 && (
              <span className="admin-sb-badge">{videoRows.length} total</span>
            )}
          </header>
          <AdminSbTableShell
            loading={false}
            empty={videoRows.length === 0}
            emptyTitle="No match video clips yet"
            emptyHint="Upload a video clip above - it stays hidden until you publish."
            columns={5}
          >
            <table className="admin-table admin-sb-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Match</th>
                  <th>Status</th>
                  <th>Preview</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {videoRows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.title}</strong>
                      <br />
                      <a href={row.youtubeUrl} className="text-link" target="_blank" rel="noreferrer">
                        Video &rarr;
                      </a>
                    </td>
                    <td className="muted">{matchLabel(row)}</td>
                    <td>
                      <StatusBadge status={row.isPublished ? "ongoing" : "draft"} />
                    </td>
                    <td>
                      <MediaUrlPreview url={row.youtubeUrl} kind="video" />
                    </td>
                    <td className="admin-table__actions">
                      <button type="button" className="admin-link" onClick={() => void togglePublish(row)}>
                        {row.isPublished ? "Unpublish" : "Publish"}
                      </button>
                      <button type="button" className="admin-link-danger" onClick={() => void remove(row)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminSbTableShell>
        </div>
      )}

      {!loading && (
        <div className="admin-sb-content-panel">
          <header className="admin-sb-content-panel__header">
            <h3>Match photos</h3>
            {photoRows.length > 0 && (
              <span className="admin-sb-badge">{photoRows.length} total</span>
            )}
          </header>
          <AdminSbTableShell
            loading={false}
            empty={photoRows.length === 0}
            emptyTitle="No match photos yet"
            emptyHint="Add a photo above - it stays hidden until you publish."
            columns={5}
          >
            <table className="admin-table admin-sb-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Match</th>
                  <th>Status</th>
                  <th>Preview</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {photoRows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.title}</strong>
                      <br />
                      <a href={row.youtubeUrl} className="text-link" target="_blank" rel="noreferrer">
                        Image &rarr;
                      </a>
                    </td>
                    <td className="muted">{matchLabel(row)}</td>
                    <td>
                      <StatusBadge status={row.isPublished ? "ongoing" : "draft"} />
                    </td>
                    <td>
                      <MediaUrlPreview url={row.youtubeUrl} kind="image" />
                    </td>
                    <td className="admin-table__actions">
                      <button type="button" className="admin-link" onClick={() => void togglePublish(row)}>
                        {row.isPublished ? "Unpublish" : "Publish"}
                      </button>
                      <button type="button" className="admin-link-danger" onClick={() => void remove(row)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminSbTableShell>
        </div>
      )}
    </section>
  );
}
