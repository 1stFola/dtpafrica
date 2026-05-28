import { FormEvent, useEffect, useState } from "react";
import { adminScoreboardApi } from "../../../../api/admin-scoreboard";
import type { SbMatchListItem } from "../../../../api/scoreboard";
import { usePageTitle } from "../../../../hooks/usePageTitle";

export function AdminScoreboardHighlightsPage() {
  usePageTitle("Admin — Match highlights");
  const [matches, setMatches] = useState<SbMatchListItem[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    adminScoreboardApi.matches().then(setMatches).catch(() => {});
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
      setMessage("Highlight queued (unpublished until reviewed)");
      e.currentTarget.reset();
    } catch (err) {
      setMessage(String(err));
    }
  };

  return (
    <section className="admin-sb-section">
      <p className="admin-sb-lead muted">
        Attach YouTube highlights to matches with timeline minutes for ScoreBoard playback.
      </p>

      <form className="admin-blog-form admin-sb-highlight-form admin-sb-panel" onSubmit={onSubmit}>
        <label>
          Match reference
          <select name="matchId" required>
            <option value="">Select match…</option>
            {matches.map((m) => (
              <option key={m.id} value={m.id}>
                {m.homeTeam.name} vs {m.awayTeam.name} — {m.competition.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Title
          <input name="title" required placeholder="e.g. Opening goal — 23'" />
        </label>
        <label>
          Timeline minute
          <input name="timelineMinute" type="number" min={0} max={130} placeholder="23" />
        </label>
        <label>
          Video URL (YouTube)
          <input name="youtubeUrl" type="url" required placeholder="https://youtube.com/..." />
        </label>
        <label>
          Thumbnail URL
          <input name="thumbnailUrl" type="url" placeholder="https://…/thumb.jpg" />
        </label>
        <button type="submit" className="admin-inline-button">
          Upload highlight
        </button>
      </form>
      {message && <p className="admin-sb-msg">{message}</p>}
    </section>
  );
}
