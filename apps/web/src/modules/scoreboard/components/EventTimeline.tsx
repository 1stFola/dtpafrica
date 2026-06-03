import { Link } from "react-router-dom";
import { EVENT_LABELS, type SbMatchEvent, type SbTeamRef } from "../../../api/scoreboard";

const EVENT_ICONS: Record<string, string> = {
  goal: "⚽",
  own_goal: "⚽",
  yellow_card: "🟨",
  red_card: "🟥",
  substitution: "↔",
  injury: "✚",
};

function slugifyName(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function PlayerLink({
  slug,
  label,
  club,
  competition,
}: {
  slug: string | null | undefined;
  label: string;
  club?: string;
  competition?: string;
}) {
  const resolvedSlug = slug ?? slugifyName(label);
  return (
    <Link
      to={`/player/${resolvedSlug}`}
      state={{ displayName: label, club, competition }}
      className="sbm-event__player"
    >
      {label}
    </Link>
  );
}

function eventSide(
  ev: SbMatchEvent,
  homeTeam: SbTeamRef,
  awayTeam: SbTeamRef
): "home" | "away" | "neutral" {
  if (ev.teamId === homeTeam.id) return "home";
  if (ev.teamId === awayTeam.id) return "away";
  return "neutral";
}

function teamNameForEvent(
  ev: SbMatchEvent,
  homeTeam: SbTeamRef,
  awayTeam: SbTeamRef
): string | undefined {
  if (ev.teamId === homeTeam.id) return homeTeam.name;
  if (ev.teamId === awayTeam.id) return awayTeam.name;
  return undefined;
}

export function EventTimeline({
  events,
  homeTeam,
  awayTeam,
  competition,
}: {
  events: SbMatchEvent[];
  homeTeam: SbTeamRef;
  awayTeam: SbTeamRef;
  competition?: string;
}) {
  const sorted = [...events].sort((a, b) => a.minute - b.minute || a.id.localeCompare(b.id));

  if (sorted.length === 0) {
    return (
      <div className="dtp-empty-state">
        <p className="dtp-empty-state__title">No events yet</p>
        <p>Goals, cards, and substitutions appear here once the match is underway.</p>
      </div>
    );
  }

  return (
    <ol className="sbm-timeline">
      {sorted.map((ev) => {
        const side = eventSide(ev, homeTeam, awayTeam);
        const club = teamNameForEvent(ev, homeTeam, awayTeam);
        const playerLabel = ev.player?.displayName ?? ev.playerLabel ?? "Unknown";
        const assistLabel = ev.assistPlayer?.displayName ?? ev.assistLabel;

        return (
          <li
            key={ev.id}
            className={`sbm-event sbm-event--${ev.type} sbm-event--${side}`}
          >
            <span className="sbm-event__rail" aria-hidden="true">
              <span className="sbm-event__dot" />
            </span>
            <div className="sbm-event__card">
              <div className="sbm-event__head">
                <span className="sbm-event__min">{ev.minute}&apos;</span>
                <span className="sbm-event__icon" aria-hidden="true">
                  {EVENT_ICONS[ev.type] ?? "•"}
                </span>
                <span className="sbm-event__type">{EVENT_LABELS[ev.type] ?? ev.type}</span>
                {ev.detail && <span className="sbm-event__detail">{ev.detail}</span>}
              </div>
              <div className="sbm-event__body">
                <PlayerLink
                  slug={ev.player?.slug}
                  label={playerLabel}
                  club={club}
                  competition={competition}
                />
                {assistLabel && (
                  <span className="sbm-event__assist">
                    Assist{" "}
                    <PlayerLink
                      slug={ev.assistPlayer?.slug}
                      label={assistLabel}
                      club={club}
                      competition={competition}
                    />
                  </span>
                )}
                {ev.highlights && ev.highlights.length > 0 && (
                  <a
                    href={ev.highlights[0].youtubeUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="sbm-event__clip"
                  >
                    Watch clip
                  </a>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
