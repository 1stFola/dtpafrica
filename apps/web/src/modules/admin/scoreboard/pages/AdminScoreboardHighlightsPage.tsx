import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { adminScoreboardApi } from "../../../../api/admin-scoreboard";
import type { SbMatchListItem } from "../../../../api/scoreboard";
import { usePageTitle } from "../../../../hooks/usePageTitle";
import { useAdminToast } from "../../components/AdminToast";
import { formatAdminScoreboardError } from "../admin-scoreboard-utils";
import { AdminSbPageHeader } from "../components/AdminSbPageHeader";

export function AdminScoreboardHighlightsPage() {
  usePageTitle("Admin — Match highlights");
  const toast = useAdminToast();
  const [matches, setMatches] = useState<SbMatchListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminScoreboardApi
      .matches()
      .then(setMatches)
      .catch(() => setMatches([]))
      .finally(() => setLoading(false));
  }, []);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const matchId = String(fd.get("matchId"));
    const title = String(fd.get("title"));
    const youtubeUrl = String(fd.get("youtubeUrl"));
    const timelineMinute = fd.get("timelineMinute")
      ? Number(fd.get("timelineMinute"))
      : undefined;
    const thumbnailUrl = String(fd.get("thumbnailUrl") || "") || undefined;
    try {
      await adminScoreboardApi.createHighlight({
        matchId,
        title,
        youtubeUrl,
        timelineMinute,
        thumbnailUrl,
      });
      toast.success("Highlight queued (unpublished until reviewed)");
      e.currentTarget.reset();
    } catch (err) {
      toast.error(formatAdminScoreboardError(err));
    }
  };

  return (
    <section className="admin-sb-section">
      <AdminSbPageHeader
        title="Match highlights"
        description="Attach YouTube clips with timeline minutes for ScoreBoard playback."
        crumbs={[{ label: "Highlights" }]}
        actions={
          <Link to="/admin/scoreboard/highlights-manager" className="text-link">
            Latest videos manager →
          </Link>
        }
      />

      {loading ? (
        <div className="admin-sb-panel admin-sb-highlight-form admin-sb-highlight-form--loading" aria-busy="true">
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
      <form className="admin-blog-form admin-sb-highlight-form admin-sb-panel" onSubmit={onSubmit}>
        <h3 className="admin-sb-form-heading">New match clip</h3>
        <label className="admin-sb-field">
          <span>Match reference</span>
          <select name="matchId" required>
            <option value="">Select match…</option>
            {matches.map((m) => (
              <option key={m.id} value={m.id}>
                {m.homeTeam.name} vs {m.awayTeam.name} — {m.competition.name}
              </option>
            ))}
          </select>
        </label>
        <label className="admin-sb-field">
          <span>Title</span>
          <input name="title" required placeholder="e.g. Opening goal — 23'" />
        </label>
        <label className="admin-sb-field">
          <span>Timeline minute</span>
          <input name="timelineMinute" type="number" min={0} max={130} placeholder="23" />
        </label>
        <label className="admin-sb-field">
          <span>Video URL (YouTube)</span>
          <input name="youtubeUrl" type="url" required placeholder="https://youtube.com/..." />
        </label>
        <label className="admin-sb-field admin-sb-field--wide">
          <span>Thumbnail URL</span>
          <input name="thumbnailUrl" type="url" placeholder="https://…/thumb.jpg" />
        </label>
        <div className="admin-sb-form-actions">
          <button type="submit" className="admin-inline-button admin-inline-button--primary">
            Upload highlight
          </button>
        </div>
      </form>
      )}
    </section>
  );
}
