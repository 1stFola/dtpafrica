import { useEffect, useState } from "react";
import { fetchHighlights, type SbHighlight } from "../../../api/scoreboard";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { HighlightCard } from "../components/HighlightCard";

export function HighlightsPage() {
  usePageTitle("Highlights");
  const [items, setItems] = useState<SbHighlight[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetchHighlights()
      .then(setItems)
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  return (
    <div className="sb-page">
      <header className="page-header">
        <h1>Latest Highlights</h1>
        <p className="muted">Published match videos from competitions.</p>
      </header>
      {loaded && items.length === 0 ? (
        <div className="dtp-empty-state">
          <p className="dtp-empty-state__title">No highlights published yet</p>
          <p>Video moments will appear here as soon as spotters publish clips.</p>
        </div>
      ) : (
        <div className="sb-hl-grid">
          {items.map((h) => (
            <HighlightCard key={h.id} highlight={h} />
          ))}
        </div>
      )}
    </div>
  );
}
