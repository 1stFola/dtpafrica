import { useEffect, useState } from "react";
import {
  fetchLiveStreams,
  fetchMatches,
  type SbLiveStream,
  type SbMatchListItem,
} from "../../../api/scoreboard";
import { LiveStreamCard } from "../components/LiveStreamCard";
import { MatchCard } from "../components/MatchCard";
import { usePageTitle } from "../../../hooks/usePageTitle";

export function LiveMatchesPage() {
  usePageTitle("Live matches");
  const [matches, setMatches] = useState<SbMatchListItem[]>([]);
  const [streams, setStreams] = useState<SbLiveStream[]>([]);

  useEffect(() => {
    const load = () => fetchMatches({ status: "live" }).then(setMatches).catch(() => {});
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  /* Streams are polled on their own, slower clock: a published stream is a decision an
     admin makes once per broadcast, and re-rendering the player every fifteen seconds
     would restart it. Only a changed list reaches state, so a running player is left be. */
  useEffect(() => {
    const load = () =>
      fetchLiveStreams()
        .then((next) =>
          setStreams((prev) =>
            prev.length === next.length && prev.every((s, i) => sameStream(s, next[i]))
              ? prev
              : next
          )
        )
        .catch(() => {});
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="sb-page">
      {streams.length > 0 && (
        <section className="sb-live-streams" aria-label="Live streams">
          <div className="sb-live-streams__grid" data-count={Math.min(streams.length, 2)}>
            {streams.map((stream) => (
              <LiveStreamCard key={stream.id} stream={stream} />
            ))}
          </div>
        </section>
      )}
      <p className="muted">Auto-refreshes every 15 seconds.</p>
      {matches.length === 0 ? (
        <p className="muted">No live matches right now.</p>
      ) : (
        <div className="sb-match-grid">
          {matches.map((m) => (
            <MatchCard key={m.id} match={m} />
          ))}
        </div>
      )}
    </div>
  );
}

function sameStream(a: SbLiveStream, b: SbLiveStream | undefined): boolean {
  return (
    !!b &&
    a.id === b.id &&
    a.title === b.title &&
    a.videoId === b.videoId &&
    a.youtubeUrl === b.youtubeUrl &&
    a.match?.id === b.match?.id &&
    a.competition?.id === b.competition?.id
  );
}
