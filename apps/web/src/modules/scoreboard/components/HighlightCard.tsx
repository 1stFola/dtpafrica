import { useEffect, useMemo, useState } from "react";
import { type SbHighlight } from "../../../api/scoreboard";
import { MediaVideoEmbed } from "../../../components/MediaVideoEmbed";
import { highlightThumbnailUrl, youtubeVideoId } from "../../../utils/media-url";

type Props = {
  highlight: SbHighlight;
  /** When true, embed video inline (match center tab). */
  inlinePlayer?: boolean;
};

export function HighlightCard({ highlight, inlinePlayer }: Props) {
  const tag = highlight.competition?.name ?? null;
  const matchup = highlight.match
    ? `${highlight.match.homeTeam.name} vs. ${highlight.match.awayTeam.name}`
    : null;
  const thumbCandidates = useMemo(() => {
    const urls = new Set<string>();
    if (highlight.thumbnailUrl?.trim()) urls.add(highlight.thumbnailUrl.trim());

    const id = youtubeVideoId(highlight.youtubeUrl);
    if (id) {
      urls.add(`https://i.ytimg.com/vi/${id}/maxresdefault.jpg`);
      urls.add(`https://i.ytimg.com/vi/${id}/sddefault.jpg`);
      urls.add(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
      urls.add(`https://i.ytimg.com/vi/${id}/mqdefault.jpg`);
    }

    const derived = highlightThumbnailUrl(highlight.youtubeUrl);
    if (derived) urls.add(derived);
    return Array.from(urls);
  }, [highlight.thumbnailUrl, highlight.youtubeUrl]);
  const [thumbIndex, setThumbIndex] = useState(0);
  const thumb = thumbCandidates[thumbIndex] ?? null;
  const publishedDate = highlight.publishedAt ? new Date(highlight.publishedAt) : null;
  const published =
    publishedDate && !Number.isNaN(publishedDate.getTime())
      ? publishedDate.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : null;

  const videoMediaType =
    highlight.mediaType === "photo" ? undefined : highlight.mediaType;

  useEffect(() => {
    setThumbIndex(0);
  }, [highlight.id, thumbCandidates.length]);

  if (inlinePlayer) {
    return (
      <article className="sb-hl-card sb-hl-card--inline">
        <MediaVideoEmbed
          url={highlight.youtubeUrl}
          title={highlight.title}
          mediaType={videoMediaType}
          embedUrl={highlight.videoEmbedUrl}
        />
        <div className="sb-hl-card__meta">
          {(tag || matchup) && (
            <span className="sb-hl-card__tag">{tag ?? matchup}</span>
          )}
          <h3 className="sb-hl-card__title">{highlight.title}</h3>
          {published && <span className="muted">{published}</span>}
        </div>
      </article>
    );
  }

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
          <img
            src={thumb}
            alt=""
            loading="lazy"
            className="sb-hl-card__thumb"
            referrerPolicy="no-referrer"
            onError={() => setThumbIndex((index) => index + 1)}
          />
        ) : (
          <div className="sb-hl-card__thumb sb-hl-card__thumb--fallback" aria-hidden="true">
            <span className="sb-hl-card__fallback-mark">DTP</span>
            <span className="sb-hl-card__fallback-title">{matchup ?? tag ?? "Match highlight"}</span>
            <span className="sb-hl-card__fallback-subtitle">Video highlight</span>
          </div>
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
