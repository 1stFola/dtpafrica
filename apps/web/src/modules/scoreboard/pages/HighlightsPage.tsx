import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchHighlights, type SbHighlight } from "../../../api/scoreboard";
import { usePageTitle } from "../../../hooks/usePageTitle";

export function HighlightsPage() {
  usePageTitle("Highlights");
  const [items, setItems] = useState<SbHighlight[]>([]);

  useEffect(() => {
    fetchHighlights().then(setItems).catch(() => {});
  }, []);

  return (
    <div className="sb-page">
      <header className="page-header">
        <h1>Highlights</h1>
        <p className="muted">Published match videos from competitions.</p>
      </header>
      <ul className="sb-highlight-list">
        {items.map((h) => (
          <li key={h.id} className="sb-highlight-item">
            <h3>{h.title}</h3>
            {h.match && (
              <p className="muted">
                <Link to={`/scoreboard/match/${h.match.id}`} className="text-link">
                  {h.match.homeTeam.name} vs {h.match.awayTeam.name}
                </Link>
                {h.event ? ` - ${h.event.minute}' ${h.event.playerLabel ?? h.event.type}` : ""}
              </p>
            )}
            <a
              href={h.youtubeUrl}
              target="_blank"
              rel="noreferrer"
              className="text-link"
            >
              Watch on YouTube
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
