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
  full_time: "🏁",
  penalty_shootout: "⚽",
};

/** Match-wide events — centered cards, never home/away aligned (mirrors FLOW_CSV_TYPES + specials). */
const NEUTRAL_EVENT_TYPES = new Set([
  "kick_off",
  "match_flow",
  "pressure",
  "half_time",
  "second_half_kickoff",
  "added_time",
  "score_update",
  "water_break",
  "midfield_battle",
  "match_control",
  "goal_scorers_update",
  "full_time",
  "penalty_shootout",
]);

/** assist_name column label by event type (CSV secondary player). */
const ASSIST_LABEL_BY_TYPE: Record<string, string> = {
  substitution: "On ",
  blocked_shot: "Stopped by ",
  late_defense: "Stopped by ",
  interception: "Stopped by ",
  shot_off_target: "Played by ",
  double_save: "Played by ",
  penalty_saved: "Played by ",
};

/** Show secondary player in parentheses on the type line (no prefix). */
const PAREN_SECONDARY_TYPES = new Set([
  "yellow_card",
  "red_card",
  "save",
]);

const SAVE_DISPLAY_TYPES = new Set(["save"]);

const EVENT_ICON_FALLBACKS: Record<string, string> = {
  aerial_duel_won: "^",
  dangerous_attack: "!",
  dangerous_cross: "x",
  dangerous_run: ">>",
  dominance: "%",
  game_management: "G",
  goal_kick: "GK",
  goal_line_clearance: "GL",
  goal_penalty: "P",
  goalkeeper_claim: "GC",
  goalkeeper_command: "CMD",
  goalkeeper_distribution: "GD",
  goalkeeper_error: "GE",
  goalkeeper_intervention: "GI",
  header_missed: "H",
  injury_substitution: "+/-",
  medical_timeout: "+",
  one_on_one: "1v1",
  poor_delivery: "x",
  possession_lost: "-",
  recovery_tackle: "T",
  restart_play: ">",
  sustained_pressure: "!!",
  tactical_substitution: "T/S",
  volley_missed: "V",
};

const UNKNOWN_PLAYER_RE = /^unknown$/i;

function isUnknownPlayer(name: string | null | undefined): boolean {
  if (!name?.trim()) return false;
  return UNKNOWN_PLAYER_RE.test(name.trim());
}

function visiblePlayerLabel(name: string | null | undefined): string | null {
  if (!name?.trim() || isUnknownPlayer(name)) return null;
  return name.trim();
}

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

type EventSide = "home" | "away" | "neutral";

function isNeutralEvent(ev: SbMatchEvent): boolean {
  const csvType = resolveCsvEventType(ev);
  if (NEUTRAL_EVENT_TYPES.has(csvType)) return true;
  return ev.type === "match_flow";
}

function eventSide(
  ev: SbMatchEvent,
  homeTeam: SbTeamRef,
  awayTeam: SbTeamRef
): EventSide {
  if (isNeutralEvent(ev)) return "neutral";
  if (ev.teamId === homeTeam.id) return "home";
  if (ev.teamId === awayTeam.id) return "away";
  return "neutral";
}

function oppositeSide(side: EventSide): "home" | "away" | null {
  if (side === "home") return "away";
  if (side === "away") return "home";
  return null;
}

function teamNameForSide(
  side: "home" | "away",
  homeTeam: SbTeamRef,
  awayTeam: SbTeamRef
): string {
  return side === "home" ? homeTeam.name : awayTeam.name;
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
  if (typeof flowKind === "string" && EVENT_ICON_FALLBACKS[flowKind]) {
    return EVENT_ICON_FALLBACKS[flowKind];
  }
  return EVENT_ICONS[ev.type] ?? EVENT_ICON_FALLBACKS[ev.type] ?? "•";
}

function isNarrativeEvent(ev: SbMatchEvent): boolean {
  if (ev.type === "match_flow") return true;
  const flowKind = ev.metadata?.flowKind ?? ev.metadata?.csvEventType;
  return flowKind === "score_update" || flowKind === "match_flow";
}

function usesParenSecondaryFormat(ev: SbMatchEvent): boolean {
  const csvType = resolveCsvEventType(ev);
  return PAREN_SECONDARY_TYPES.has(csvType) || PAREN_SECONDARY_TYPES.has(ev.type);
}

function parentheticalPlayerName(
  playerLabel: string | null,
  assistLabel: string | null
): string | null {
  return assistLabel ?? playerLabel;
}

function isSaveDisplayEvent(ev: SbMatchEvent, csvType: string): boolean {
  return SAVE_DISPLAY_TYPES.has(csvType) || SAVE_DISPLAY_TYPES.has(ev.type);
}

function namesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  return Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());
}

function extractShooterFromSaveDetail(detail: string | null | undefined): string | null {
  if (!detail) return null;
  const match = detail.match(
    /\bfrom\s+(.+?)(?:'s|\s+(?:low|high|driven|curling|point-blank|free-kick|freekick|shot|effort|attempt|strike|header)\b|[.,;:]|$)/i
  );
  const value = match?.[1]?.replace(/\s+/g, " ").trim();
  return value || null;
}

type SaveDisplay = {
  kickerLabel: string | null;
  kickerSlug: string | null | undefined;
  goalkeeperLabel: string | null;
  goalkeeperSlug: string | null | undefined;
  goalkeeperClub?: string;
};

function resolveSaveDisplay(
  ev: SbMatchEvent,
  playerLabel: string | null,
  playerLabel2: string | null,
  assistLabel: string | null,
  club?: string
): SaveDisplay | null {
  const detailShooter = extractShooterFromSaveDetail(ev.detail);
  let kickerLabel = detailShooter ?? playerLabel2 ?? assistLabel;
  let goalkeeperLabel = playerLabel;
  let kickerSlug: string | null | undefined = null;
  let goalkeeperSlug: string | null | undefined = ev.player?.slug;

  if (detailShooter) {
    if (namesMatch(detailShooter, playerLabel)) {
      kickerSlug = ev.player?.slug;
      goalkeeperLabel = playerLabel2 ?? assistLabel;
      goalkeeperSlug = null;
    } else if (namesMatch(detailShooter, playerLabel2)) {
      goalkeeperLabel = playerLabel ?? assistLabel;
    } else if (namesMatch(detailShooter, assistLabel)) {
      goalkeeperLabel = playerLabel ?? playerLabel2;
    }
  }

  if (!kickerLabel && playerLabel && playerLabel2 && !namesMatch(playerLabel, playerLabel2)) {
    kickerLabel = playerLabel2;
  }

  if (kickerLabel && namesMatch(kickerLabel, goalkeeperLabel)) {
    const fallbackGoalkeeper = [playerLabel, assistLabel, playerLabel2].find(
      (label) => label && !namesMatch(label, kickerLabel)
    );
    goalkeeperLabel = fallbackGoalkeeper ?? null;
    goalkeeperSlug = namesMatch(goalkeeperLabel, playerLabel) ? ev.player?.slug : null;
  }

  if (!kickerLabel) return null;

  return {
    kickerLabel,
    kickerSlug,
    goalkeeperLabel,
    goalkeeperSlug,
    goalkeeperClub: club,
  };
}

type ParsedEvent = {
  ev: SbMatchEvent;
  side: EventSide;
  csvType: string;
  playerLabel: string | null;
  playerLabel2: string | null;
  assistLabel: string | null;
  typeLabel: string;
  baseLabel: string;
  narrative: boolean;
  showDetail: boolean;
  showPrimary: boolean;
  showAssist: boolean;
  saveDisplay: SaveDisplay | null;
  club?: string;
};

function parseEvent(
  ev: SbMatchEvent,
  homeTeam: SbTeamRef,
  awayTeam: SbTeamRef
): ParsedEvent {
  const side = eventSide(ev, homeTeam, awayTeam);
  const club = teamNameForEvent(ev, homeTeam, awayTeam);
  const csvType = resolveCsvEventType(ev);
  const playerLabel = visiblePlayerLabel(ev.player?.displayName ?? ev.playerLabel);
  const playerLabel2 = visiblePlayerLabel(ev.playerLabel2);
  const assistLabel = visiblePlayerLabel(ev.assistPlayer?.displayName ?? ev.assistLabel);
  const saveDisplay = isSaveDisplayEvent(ev, csvType)
    ? resolveSaveDisplay(ev, playerLabel, playerLabel2, assistLabel, club)
    : null;
  const parenFormat = !saveDisplay && usesParenSecondaryFormat(ev);
  const parenName = parenFormat ? parentheticalPlayerName(playerLabel, assistLabel) : null;
  const baseLabel = resolveEventLabel(ev);
  const typeLabel = parenName ? `${baseLabel} (${parenName})` : baseLabel;
  const narrative = isNarrativeEvent(ev);
  const showDetail = Boolean(ev.detail?.trim());
  const showPrimary = !parenFormat && Boolean(playerLabel);
  const showAssist = !parenFormat && Boolean(assistLabel);

  return {
    ev,
    side,
    csvType,
    playerLabel,
    playerLabel2,
    assistLabel,
    typeLabel,
    baseLabel,
    narrative,
    showDetail,
    showPrimary,
    showAssist,
    saveDisplay,
    club,
  };
}

function EventCard({
  parsed,
  competition,
  align,
}: {
  parsed: ParsedEvent;
  competition?: string;
  align: "home" | "away";
}) {
  const {
    ev,
    typeLabel,
    showDetail,
    showPrimary,
    showAssist,
    playerLabel,
    assistLabel,
    saveDisplay,
    club,
  } = parsed;

  return (
    <div className={`sbm-event__card sbm-event__card--${align}`}>
      <div className="sbm-event__head">
        <span className="sbm-event__type">{typeLabel}</span>
      </div>
      {(saveDisplay || showPrimary || showAssist || showDetail || (ev.highlights?.length ?? 0) > 0) && (
        <div className="sbm-event__body">
          {showDetail && <p className="sbm-event__comment">{ev.detail}</p>}
          {saveDisplay?.kickerLabel && (
            <>
              <PlayerLink
                slug={saveDisplay.kickerSlug}
                label={saveDisplay.kickerLabel}
                club={club}
                competition={competition}
              />
              {saveDisplay.goalkeeperLabel && (
                <span className="sbm-event__assist">
                  Saved by{" "}
                  <PlayerLink
                    slug={saveDisplay.goalkeeperSlug}
                    label={saveDisplay.goalkeeperLabel}
                    club={saveDisplay.goalkeeperClub}
                    competition={competition}
                  />
                </span>
              )}
            </>
          )}
          {showPrimary && playerLabel && (
            <PlayerLink
              slug={ev.player?.slug}
              label={playerLabel}
              club={club}
              competition={competition}
            />
          )}
          {showAssist && assistLabel && (
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
  );
}

function OppositePlayerTag({
  label,
  side,
  homeTeam,
  awayTeam,
  competition,
}: {
  label: string;
  side: "home" | "away";
  homeTeam: SbTeamRef;
  awayTeam: SbTeamRef;
  competition?: string;
}) {
  const club = teamNameForSide(side, homeTeam, awayTeam);
  return (
    <div className={`sbm-event__card sbm-event__card--${side} sbm-event__card--secondary`}>
      <PlayerLink slug={null} label={label} club={club} competition={competition} />
    </div>
  );
}

function NeutralEventCard({ parsed }: { parsed: ParsedEvent }) {
  const { ev, typeLabel, showDetail } = parsed;
  return (
    <article className="sbm-event__neutral-card">
      <div className="sbm-event__neutral-head">
        <span className="sbm-event__type">{typeLabel}</span>
      </div>
      {showDetail && <p className="sbm-event__detail sbm-event__detail--neutral">{ev.detail}</p>}
    </article>
  );
}

function NeutralTimelineRow({ parsed }: { parsed: ParsedEvent }) {
  const { ev, csvType } = parsed;
  const icon = resolveEventIcon(ev);

  return (
    <li
      className={`sbm-timeline__row sbm-timeline__row--neutral sbm-event--${csvType}`}
    >
      <div className="sbm-timeline__neutral-break">
        <div className="sbm-timeline__neutral-marker">
          <span className="sbm-timeline__minute">{ev.minute}&apos;</span>
          <span className="sbm-timeline__marker">
            <span className="sbm-event__icon sbm-timeline__icon" aria-hidden>
              {icon}
            </span>
          </span>
        </div>
        <NeutralEventCard parsed={parsed} />
      </div>
    </li>
  );
}

function TeamTimelineRow({
  parsed,
  homeTeam,
  awayTeam,
  competition,
}: {
  parsed: ParsedEvent;
  homeTeam: SbTeamRef;
  awayTeam: SbTeamRef;
  competition?: string;
}) {
  const { ev, side, csvType, playerLabel2 } = parsed;
  const icon = resolveEventIcon(ev);
  const opp = oppositeSide(side);
  const player2Side = opp && playerLabel2 && !parsed.saveDisplay ? opp : null;

  return (
    <li
      className={`sbm-timeline__row sbm-timeline__row--${side} sbm-event--${csvType}`}
    >
      <div className="sbm-timeline__col sbm-timeline__col--home">
        {side === "home" && (
          <EventCard parsed={parsed} competition={competition} align="home" />
        )}
        {player2Side === "home" && playerLabel2 && (
          <OppositePlayerTag
            label={playerLabel2}
            side="home"
            homeTeam={homeTeam}
            awayTeam={awayTeam}
            competition={competition}
          />
        )}
      </div>

      <div className="sbm-timeline__axis" aria-hidden="false">
        <span className="sbm-timeline__minute">{ev.minute}&apos;</span>
        <span className="sbm-timeline__marker">
          <span className="sbm-event__icon sbm-timeline__icon" aria-hidden>
            {icon}
          </span>
          <span className="sbm-timeline__dot" />
        </span>
      </div>

      <div className="sbm-timeline__col sbm-timeline__col--away">
        {side === "away" && (
          <EventCard parsed={parsed} competition={competition} align="away" />
        )}
        {side === "home" && (
          <div className="sbm-timeline__mobile-only">
            <EventCard parsed={parsed} competition={competition} align="home" />
          </div>
        )}
        {player2Side === "away" && playerLabel2 && (
          <OppositePlayerTag
            label={playerLabel2}
            side="away"
            homeTeam={homeTeam}
            awayTeam={awayTeam}
            competition={competition}
          />
        )}
        {player2Side === "home" && playerLabel2 && (
          <div className="sbm-timeline__mobile-only">
            <OppositePlayerTag
              label={playerLabel2}
              side="home"
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              competition={competition}
            />
          </div>
        )}
      </div>
    </li>
  );
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
        const parsed = parseEvent(ev, homeTeam, awayTeam);
        if (parsed.side === "neutral") {
          return <NeutralTimelineRow key={ev.id} parsed={parsed} />;
        }
        return (
          <TeamTimelineRow
            key={ev.id}
            parsed={parsed}
            homeTeam={homeTeam}
            awayTeam={awayTeam}
            competition={competition}
          />
        );
      })}
    </ol>
  );
}
