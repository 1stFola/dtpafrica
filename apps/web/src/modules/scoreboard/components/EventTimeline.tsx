import { Link } from "react-router-dom";
import { EVENT_LABELS, type SbMatchEvent } from "../../../api/scoreboard";

const EVENT_MARKERS: Record<string, string> = {
  goal: "GOAL",
  own_goal: "OG",
  yellow_card: "YC",
  red_card: "RC",
  substitution: "SUB",
  injury: "INJ",
};

function PlayerLink({
  slug,
  label,
}: {
  slug: string | null | undefined;
  label: string;
}) {
  if (!slug) return <>{label}</>;
  return (
    <Link to={`/player/${slug}`} className="text-link">
      {label}
    </Link>
  );
}

export function EventTimeline({ events }: { events: SbMatchEvent[] }) {
  if (events.length === 0) {
    return <p className="muted">No events recorded yet.</p>;
  }

  return (
    <ul className="sb-timeline">
      {events.map((ev) => (
        <li key={ev.id} className={`sb-timeline__item sb-timeline__item--${ev.type}`}>
          <span className="sb-timeline__min">{ev.minute}&apos;</span>
          <span className="sb-timeline__marker">{EVENT_MARKERS[ev.type] ?? "EV"}</span>
          <span className="sb-timeline__type">{EVENT_LABELS[ev.type] ?? ev.type}</span>
          <span className="sb-timeline__who">
            <PlayerLink
              slug={ev.player?.slug}
              label={ev.player?.displayName ?? ev.playerLabel ?? "-"}
            />
            {(ev.assistPlayer || ev.assistLabel) && (
              <small>
                Assist:{" "}
                <PlayerLink
                  slug={ev.assistPlayer?.slug}
                  label={ev.assistPlayer?.displayName ?? ev.assistLabel ?? "Uncredited"}
                />
              </small>
            )}
            {ev.detail ? ` (${ev.detail})` : ""}
            {ev.highlights && ev.highlights.length > 0 && (
              <a
                href={ev.highlights[0].youtubeUrl}
                target="_blank"
                rel="noreferrer"
                className="sb-event-clip"
              >
                Watch clip
              </a>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
