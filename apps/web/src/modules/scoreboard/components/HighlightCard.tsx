import { type SbHighlight, youtubeThumbnail } from "../../../api/scoreboard";

export function HighlightCard({ highlight }: { highlight: SbHighlight }) {
  const thumb = youtubeThumbnail(highlight.youtubeUrl);
  const tag = highlight.competition?.name ?? null;
  const matchup = highlight.match
    ? `${highlight.match.homeTeam.name} vs. ${highlight.match.awayTeam.name}`
    : null;
  const publishedDate = highlight.publishedAt ? new Date(highlight.publishedAt) : null;
  const published =
    publishedDate && !Number.isNaN(publishedDate.getTime())
      ? publishedDate.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : null;

  return (
    <a
      href={highlight.youtubeUrl}
      target="_blank"
      rel="noreferrer"
      className="sb-hl-card"
      aria-label={`Watch: ${highlight.title}`}
    >
      <div className="sb-hl-card__media">
        {thumb ? (
          <img src={thumb} alt="" loading="lazy" className="sb-hl-card__thumb" />
        ) : (
          <div className="sb-hl-card__thumb sb-hl-card__thumb--fallback" aria-hidden="true" />
        )}
        <span className="sb-hl-card__play" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>
        {published && <span className="sb-hl-card__date">{published}</span>}
        {highlight.duration && (
          <span className="sb-hl-card__duration">{highlight.duration}</span>
        )}
      </div>
      <div className="sb-hl-card__meta">
        {(tag || matchup) && (
          <span className="sb-hl-card__tag">{tag ?? matchup}</span>
        )}
        <h3 className="sb-hl-card__title">{highlight.title}</h3>
      </div>
    </a>
  );
}
