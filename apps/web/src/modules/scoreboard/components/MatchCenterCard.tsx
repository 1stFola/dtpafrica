import { Link } from "react-router-dom";
import type { SbMatchGoal, SbMatchListItem } from "../../../api/scoreboard";
import { matchCenterPath } from "../utils/matchPath";
import { TeamCrest } from "./TeamCrest";

type StatusKind = "live" | "ht" | "ft" | "scheduled" | "other";

type DisplayScorer = {
  id: string;
  name: string;
  minute: number | null;
  isOwnGoal?: boolean;
  isPenalty?: boolean;
};

function statusKind(status: string): StatusKind {
  if (status === "live") return "live";
  if (status === "halftime") return "ht";
  if (status === "finished") return "ft";
  if (status === "scheduled") return "scheduled";
  return "other";
}

function statusLabel(match: SbMatchListItem): string {
  switch (statusKind(match.status)) {
    case "live":
      return match.minute != null ? `LIVE ${match.minute}'` : "LIVE";
    case "ht":
      return "HT";
    case "ft":
      return "FT";
    case "scheduled":
      return "UPCOMING";
    default:
      return match.status.toUpperCase();
  }
}

function scorerName(goal: SbMatchGoal): string {
  return goal.player?.displayName ?? goal.playerLabel ?? "Unknown";
}

function normalizeLabel(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function teamLabels(match: SbMatchListItem, side: "home" | "away") {
  const team = side === "home" ? match.homeTeam : match.awayTeam;
  return [team.name, team.shortName, side, side === "home" ? "home team" : "away team"]
    .filter(Boolean)
    .map((label) => normalizeLabel(label));
}

function parseMinute(raw: string): number | null {
  const match = raw.match(/(?:^|[\s(])(\d{1,3})(?:\s*\+\s*(\d{1,2}))?\s*(?:'|min\b|m\b)?/i);
  return match ? Number(match[1]) + Number(match[2] ?? 0) : null;
}

function parseManualScorerItem(raw: string, idPrefix: string): DisplayScorer | null {
  const cleaned = raw
    .replace(/\s+/g, " ")
    .replace(/^[\-\u2022]\s*/, "")
    .trim();
  if (!cleaned) return null;

  const minute = parseMinute(cleaned);
  const isPenalty = /\b(?:pen|penalty|pk)\b/i.test(cleaned) || /\((?:p|pen)\)/i.test(cleaned);
  const isOwnGoal = /\b(?:og|own goal)\b/i.test(cleaned);

  let name = cleaned
    .replace(/(?:^|[\s(])\d{1,3}(?:\s*\+\s*\d{1,2})?\s*(?:'|min\b|m\b)?/i, " ")
    .replace(/\([^)]*(?:pen|penalty|pk|og|own goal|p)[^)]*\)/gi, "")
    .replace(/\b(?:pen|penalty|pk|og|own goal)\b/gi, "")
    .replace(/[,;|\-\u2013\u2014]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!name) return null;

  return {
    id: `${idPrefix}-${normalizeLabel(name)}-${minute ?? "na"}-${isPenalty ? "p" : "g"}`,
    name,
    minute,
    isPenalty,
    isOwnGoal,
  };
}

function parseManualGoalScorers(match: SbMatchListItem) {
  const text = match.meta?.goalScorers?.trim();
  const parsed = { home: [] as DisplayScorer[], away: [] as DisplayScorer[] };
  if (!text) return parsed;

  const homeLabels = teamLabels(match, "home");
  const awayLabels = teamLabels(match, "away");

  text
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean)
    .forEach((row, rowIndex) => {
      const [maybeLabel, ...scorerParts] = row.split(":");
      if (scorerParts.length === 0) return;

      const label = normalizeLabel(maybeLabel);
      const side = homeLabels.includes(label)
        ? "home"
        : awayLabels.includes(label)
          ? "away"
          : null;
      if (!side) return;

      scorerParts
        .join(":")
        .split(/[,;|]+/)
        .map((item) => parseManualScorerItem(item, `${side}-${rowIndex}`))
        .filter((item): item is DisplayScorer => Boolean(item))
        .forEach((item) => parsed[side].push(item));
    });

  return parsed;
}

function goalEventToDisplay(goal: SbMatchGoal): DisplayScorer {
  return {
    id: goal.id,
    name: scorerName(goal),
    minute: goal.minute,
    isOwnGoal: goal.type === "own_goal",
    isPenalty: goal.type === "goal_penalty",
  };
}

function ScorerBadge({ scorer, away = false }: { scorer: DisplayScorer; away?: boolean }) {
  return (
    <>
      {away && scorer.isOwnGoal && <span className="sb-mc-scorers__og">OG</span>}
      {away && scorer.isPenalty && <span className="sb-mc-scorers__og">PEN</span>}
      {away && scorer.minute != null && (
        <span className="sb-mc-scorers__min">{scorer.minute}&apos;</span>
      )}
      <span>{scorer.name}</span>
      {!away && scorer.minute != null && (
        <span className="sb-mc-scorers__min">{scorer.minute}&apos;</span>
      )}
      {!away && scorer.isPenalty && <span className="sb-mc-scorers__og">PEN</span>}
      {!away && scorer.isOwnGoal && <span className="sb-mc-scorers__og">OG</span>}
    </>
  );
}

export function MatchCenterCard({
  match,
  compact = false,
}: {
  match: SbMatchListItem;
  compact?: boolean;
}) {
  const kind = statusKind(match.status);
  const live = kind === "live" || kind === "ht";
  const goals = match.events ?? [];
  const homeGoals = goals.filter((g) => g.teamId === match.homeTeam.id);
  const awayGoals = goals.filter((g) => g.teamId === match.awayTeam.id);
  const manualGoals = parseManualGoalScorers(match);
  const displayHomeGoals = homeGoals.length > 0 ? homeGoals.map(goalEventToDisplay) : manualGoals.home;
  const displayAwayGoals = awayGoals.length > 0 ? awayGoals.map(goalEventToDisplay) : manualGoals.away;
  const allDisplayGoals = [...displayHomeGoals, ...displayAwayGoals];
  const penaltyShootout = match.meta?.penaltyShootout ?? null;
  const hasScore = match.status !== "scheduled";

  return (
    <Link
      to={matchCenterPath(match)}
      className={`sb-mc-card${compact ? " sb-mc-card--compact" : ""}`}
      data-status={kind}
    >
      <div className="sb-mc-card__head">
        <span className="sb-mc-tag">{match.competition.name}</span>
        <span className={`sb-mc-status sb-mc-status--${kind}`}>
          {live && <span className="sb-mc-status__dot" aria-hidden="true" />}
          {statusLabel(match)}
        </span>
      </div>

      <div className="sb-mc-card__body">
        <div className="sb-mc-team">
          <TeamCrest team={match.homeTeam} />
          <span className="sb-mc-team__name">{match.homeTeam.name}</span>
        </div>

        <div className="sb-mc-score" aria-label="Scoreline">
          {hasScore ? (
            <>
              <span className="sb-mc-score__main">
                <span>{match.homeScore}</span>
                <span className="sb-mc-score__dash">-</span>
                <span>{match.awayScore}</span>
              </span>
              {penaltyShootout && (
                <span className="sb-mc-score__pens">
                  Pens {penaltyShootout.home} - {penaltyShootout.away}
                </span>
              )}
            </>
          ) : (
            <span className="sb-mc-score__vs">vs</span>
          )}
        </div>

        <div className="sb-mc-team sb-mc-team--away">
          <TeamCrest team={match.awayTeam} />
          <span className="sb-mc-team__name">{match.awayTeam.name}</span>
        </div>
      </div>

      {!compact && allDisplayGoals.length > 0 && (
        <div className="sb-mc-card__timeline">
          <ul className="sb-mc-scorers">
            {displayHomeGoals.map((scorer) => (
              <li key={scorer.id}>
                <span className="sb-mc-scorers__ball" aria-hidden="true">⚽</span>
                <ScorerBadge scorer={scorer} />
              </li>
            ))}
          </ul>
          <ul className="sb-mc-scorers sb-mc-scorers--away">
            {displayAwayGoals.map((scorer) => (
              <li key={scorer.id}>
                <ScorerBadge scorer={scorer} away />
                <span className="sb-mc-scorers__ball" aria-hidden="true">⚽</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {compact && allDisplayGoals.length > 0 && (
        <div className="sb-mc-card__mini-timeline" aria-label="Goal scorers">
          {allDisplayGoals
            .sort((a, b) => (a.minute ?? 999) - (b.minute ?? 999))
            .slice(0, 4)
            .map((scorer) => (
              <span key={scorer.id} className="sb-mc-card__mini-goal">
                {scorer.minute != null ? `${scorer.minute}' ` : ""}
                {scorer.name}
                {scorer.isPenalty ? " (pen)" : ""}
              </span>
            ))}
          {allDisplayGoals.length > 4 && (
            <span className="sb-mc-card__mini-more">+{allDisplayGoals.length - 4}</span>
          )}
        </div>
      )}

      <div className="sb-mc-card__foot">
        {match.roundLabel && <span>{match.roundLabel}</span>}
        {!compact && match.venue && <span>{match.venue}</span>}
        {kind === "scheduled" && match.kickoffAt && (
          <span>
            {new Date(match.kickoffAt).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        )}
      </div>
    </Link>
  );
}
