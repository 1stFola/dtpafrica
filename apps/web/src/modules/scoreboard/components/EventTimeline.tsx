import { Link } from "react-router-dom";
import { EVENT_LABELS, type SbMatchEvent, type SbTeamRef } from "../../../api/scoreboard";

const EVENT_ICONS: Record<string, string> = {
  goal: "⚽",
  own_goal: "⚽",
  yellow_card: "🟨",
  red_card: "🟥",
  substitution: "↔",
  injury: "✚",
  match_flow: "⏱",
  kick_off: "▶",
  half_time: "◐",
  second_half_kickoff: "▶",
  added_time: "+",
  score_update: "📋",
  pressure: "↑",
  freekick: "🎯",
  corner_kick: "🚩",
  save: "🧤",
  chance: "◎",
  close_chance: "◎",
  blocked_shot: "🛡",
  throw_in: "↗",
  offside: "🚫",
  possession: "◉",
  foul: "⚠",
  clearance: "↩",
  shot_off_target: "○",
  penalty_awarded: "⚠",
  penalty_saved: "🧤",
  woodwork: "⊓",
  midfield_battle: "⚔",
  double_save: "🧤",
  long_throw: "↗",
  water_break: "💧",
  interception: "✋",
  match_control: "◉",
  goal_scorers_update: "📋",
  missed_chance: "○",
  disallowed_goal: "🚫",
  counter_attack: "⚡",
  late_defense: "🛡",
};

/** assist_name column label by event type (CSV secondary player). */
const ASSIST_LABEL_BY_TYPE: Record<string, string> = {
  substitution: "On ",
  clearance: "Stopped by ",
  blocked_shot: "Stopped by ",
  late_defense: "Stopped by ",
  interception: "Stopped by ",
  shot_off_target: "Played by ",
  save: "Played by ",
  double_save: "Played by ",
  penalty_saved: "Played by ",
};

function resolveCsvEventType(ev: SbMatchEvent): string {
  const meta = ev.metadata;
  if (meta?.csvEventType && typeof meta.csvEventType === "string") return meta.csvEventType;
  if (meta?.flowKind && typeof meta.flowKind === "string") return meta.flowKind;
  return ev.type;
}

function assistPrefixForEvent(ev: SbMatchEvent): string {
  const csvType = resolveCsvEventType(ev);
  return ASSIST_LABEL_BY_TYPE[csvType] ?? ASSIST_LABEL_BY_TYPE[ev.type] ?? "Assist ";
}

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

function resolveEventLabel(ev: SbMatchEvent): string {
  const flowKind = ev.metadata?.flowKind ?? ev.metadata?.csvEventType;
  if (typeof flowKind === "string" && EVENT_LABELS[flowKind]) {
    return EVENT_LABELS[flowKind];
  }
  if (ev.type === "match_flow" && ev.detail) return ev.detail;
  return EVENT_LABELS[ev.type] ?? ev.type;
}

function resolveEventIcon(ev: SbMatchEvent): string {
  const flowKind = ev.metadata?.flowKind ?? ev.metadata?.csvEventType;
  if (typeof flowKind === "string" && EVENT_ICONS[flowKind]) {
    return EVENT_ICONS[flowKind];
  }
  return EVENT_ICONS[ev.type] ?? "•";
}

function isNarrativeEvent(ev: SbMatchEvent): boolean {
  if (ev.type === "match_flow") return true;
  const flowKind = ev.metadata?.flowKind ?? ev.metadata?.csvEventType;
  return flowKind === "score_update" || flowKind === "match_flow";
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
        const playerLabel = ev.player?.displayName ?? ev.playerLabel;
        const assistLabel = ev.assistPlayer?.displayName ?? ev.assistLabel;
        const narrative = isNarrativeEvent(ev);
        const showDetail =
          ev.detail && (!narrative || ev.detail !== resolveEventLabel(ev));

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
                  {resolveEventIcon(ev)}
                </span>
                <span className="sbm-event__type">{resolveEventLabel(ev)}</span>
                {showDetail && <span className="sbm-event__detail">{ev.detail}</span>}
              </div>
              {(playerLabel || assistLabel) && (
                <div className="sbm-event__body">
                  {playerLabel && (
                    <PlayerLink
                      slug={ev.player?.slug}
                      label={playerLabel}
                      club={club}
                      competition={competition}
                    />
                  )}
                  {assistLabel && (
                    <span className="sbm-event__assist">
                      {assistPrefixForEvent(ev)}
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
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
