import { Link } from "react-router-dom";
import type { SbLiveStream } from "../../../api/scoreboard";
import { matchCenterPath } from "../utils/matchPath";

/**
 * One published broadcast on the Live Games page: the YouTube player, muted and started
 * where the browser allows it (muted autoplay is what browsers permit without a click),
 * with the title and the fixture or competition the admin linked it to.
 */
export function LiveStreamCard({ stream }: { stream: SbLiveStream }) {
  const params = new URLSearchParams({
    autoplay: "1",
    mute: "1",
    playsinline: "1",
    rel: "0",
  });
  const src = stream.videoId ? `https://www.youtube.com/embed/${stream.videoId}?${params}` : null;
  const fixture = stream.match
    ? `${stream.match.homeTeam.name} vs ${stream.match.awayTeam.name}`
    : null;

  return (
    <article className="sb-live-stream" data-testid="live-stream">
      <div className="sb-media-video sb-live-stream__player">
        {src ? (
          <iframe
            src={src}
            title={stream.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            className="sb-media-video__iframe"
          />
        ) : (
          <p className="sb-media-video__fallback muted">
            <a href={stream.youtubeUrl} target="_blank" rel="noreferrer" className="text-link">
              Watch on YouTube ↗
            </a>
          </p>
        )}
      </div>
      <div className="sb-live-stream__meta">
        <span className="sb-live-badge">LIVE</span>
        <h2 className="sb-live-stream__title">{stream.title}</h2>
        {(fixture || stream.competition) && (
          <p className="sb-live-stream__context muted">
            {fixture && stream.match ? (
              <Link to={matchCenterPath(stream.match)} className="text-link">
                {fixture}
              </Link>
            ) : null}
            {fixture && stream.competition ? " · " : null}
            {stream.competition ? <span>{stream.competition.name}</span> : null}
          </p>
        )}
        <a
          href={stream.youtubeUrl}
          target="_blank"
          rel="noreferrer"
          className="text-link sb-live-stream__open"
        >
          Open on YouTube ↗
        </a>
      </div>
    </article>
  );
}
