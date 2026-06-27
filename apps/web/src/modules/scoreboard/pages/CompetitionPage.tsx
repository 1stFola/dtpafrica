import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  fetchCompetition,
  fetchMatches,
  fetchStandings,
  type SbMatchListItem,
  type SbTeamRef,
  type SbTeamWithSquad,
  type StandingRow,
} from "../../../api/scoreboard";
import { MatchCenterCard } from "../components/MatchCenterCard";
import { MatchTicker } from "../components/MatchTicker";
import { StatLeadersWidget } from "../components/StatLeadersWidget";
import { TeamCrest } from "../components/TeamCrest";
import { matchCenterPath } from "../utils/matchPath";
import { isAbortError } from "../../../api/client";
import { usePageTitle } from "../../../hooks/usePageTitle";

type CompetitionTab = "overview" | "fixtures" | "teams" | "history";

const TABS: { id: CompetitionTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "fixtures", label: "Fixtures" },
  { id: "teams", label: "Teams" },
  { id: "history", label: "History" },
];

const TAB_IDS = new Set<string>(TABS.map((t) => t.id));

const COMPETITION_DEFAULT_TAB: Partial<Record<string, CompetitionTab>> = {
  "ex-internationals-cup-2026": "fixtures",
};

function defaultTabForSlug(slug: string | undefined): CompetitionTab {
  return (slug && COMPETITION_DEFAULT_TAB[slug]) || "overview";
}

const COMPETITION_DESCRIPTION =
  "Public competition hub featuring standings, participating teams, and historical archives.";

const JAGABAN_FORMAT_COPY =
  "The top team from each group advances directly to the Grand Finale. The second-placed teams face off in the Third-Place Playoff to determine the bronze medal winner.";

const KNOCKOUT_FORMAT_COPY =
  "Single-elimination knockout: winners advance through Round of 16, quarter-finals, semi-finals, and the final. All Round of 32 ties are seeded (1v2, 3v4, … 31v32).";

const KNOCKOUT_STATUSES = new Set(["finished"]);
const LIVE_STATUSES = new Set(["live", "halftime"]);


/** Player guardrail: always route by slug, never the internal DB id. */
function slugifyName(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function fixtureSectionLabel(match: SbMatchListItem): string {
  const stage = match.stageKey ?? "";
  if (stage === "r32" || match.roundLabel === "Round of 32") return "Round of 32";
  if (stage === "third_place") return "Third-Place Playoff";
  if (stage === "grand_final") return "Grand Finale";
  if (match.matchday != null) return `Day ${match.matchday}`;
  const dayMatch = match.roundLabel?.match(/DAY\s*(\d+)/i);
  if (dayMatch) return `Day ${dayMatch[1]}`;
  if (match.roundLabel) return match.roundLabel;
  if (match.kickoffAt) return new Date(match.kickoffAt).toLocaleDateString();
  return "Unscheduled";
}

function isKnockoutSection(label: string): boolean {
  return /third[- ]?place|grand fina|^final/i.test(label);
}

/** Order fixtures so group days come first, knockout (final/3rd place) last. */
function fixtureSortKey(match: SbMatchListItem): number {
  const stage = match.stageKey ?? "";
  if (stage.startsWith("group_")) return (match.matchday ?? 0) * 10;
  if (stage === "r32") return 100 + (match.matchday ?? 0);
  if (stage === "third_place") return 9000;
  if (stage === "grand_final") return 9100;
  return 5000 + (match.matchday ?? 0);
}

function groupFixtures(matches: SbMatchListItem[]) {
  const sorted = [...matches].sort(
    (a, b) =>
      fixtureSortKey(a) - fixtureSortKey(b) ||
      (a.kickoffAt && b.kickoffAt
        ? new Date(a.kickoffAt).getTime() - new Date(b.kickoffAt).getTime()
        : 0)
  );
  return sorted.reduce<Array<{ label: string; matches: SbMatchListItem[] }>>(
    (groups, match) => {
      const label = fixtureSectionLabel(match);
      const group = groups.find((item) => item.label === label);
      if (group) group.matches.push(match);
      else groups.push({ label, matches: [match] });
      return groups;
    },
    []
  );
}

type ExIntlFixtureTab = "first_leg" | "second_leg" | "r16" | "qf" | "sf" | "final";

const EX_INTL_FIXTURE_TABS: { id: ExIntlFixtureTab; label: string }[] = [
  { id: "first_leg", label: "1st Leg" },
  { id: "second_leg", label: "2nd Leg" },
  { id: "r16", label: "Round of 16" },
  { id: "qf", label: "Quarter Final" },
  { id: "sf", label: "Semi Final" },
  { id: "final", label: "Final" },
];

/** Assign ex-internationals fixtures to a leg/stage tab via meta.leg, stageKey, roundLabel. */
function exIntlFixtureTab(match: SbMatchListItem): ExIntlFixtureTab | null {
  const stage = (match.stageKey ?? "").toLowerCase();
  const leg = match.meta?.leg;
  const round = (match.roundLabel ?? "").toLowerCase();

  if (stage === "r16" || round.includes("round of 16")) return "r16";
  if (stage === "qf" || round.includes("quarter")) return "qf";
  if (stage === "sf" || round.includes("semi")) return "sf";
  if (
    stage === "final" ||
    stage === "grand_final" ||
    round === "final" ||
    /^final\b/.test(round)
  ) {
    return "final";
  }
  if (stage === "r32") {
    return leg === "second_leg" ? "second_leg" : "first_leg";
  }
  return null;
}

function filterExIntlFixtures(
  matches: SbMatchListItem[],
  tab: ExIntlFixtureTab
): SbMatchListItem[] {
  return matches.filter((m) => exIntlFixtureTab(m) === tab);
}

function defaultExIntlFixtureTab(matches: SbMatchListItem[]): ExIntlFixtureTab {
  for (const tab of EX_INTL_FIXTURE_TABS) {
    if (filterExIntlFixtures(matches, tab.id).length > 0) return tab.id;
  }
  return "first_leg";
}

function matchNarrative(match: SbMatchListItem): string | null {
  const narrative = match.stats?.narrative;
  return typeof narrative === "string" && narrative.trim() ? narrative.trim() : null;
}

function deriveShortCode(name: string, shortName?: string | null): string {
  const stored = shortName?.trim();
  if (stored) return stored.toUpperCase();
  const cleaned = name.replace(/\b(FC|SC|FA|AFC)\b/gi, "").trim() || name;
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words
    .slice(0, 3)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

/** Winner side of a finished match, settling level scores via the shootout meta. */
function matchWinner(match: SbMatchListItem): "home" | "away" | null {
  if (!KNOCKOUT_STATUSES.has(match.status)) return null;
  if (match.homeScore > match.awayScore) return "home";
  if (match.awayScore > match.homeScore) return "away";
  return match.meta?.penaltyShootout?.winner ?? null;
}

type Placement = {
  rank: 1 | 2 | 3;
  label: string;
  team: SbTeamRef | null;
};

type Scorer = {
  key: string;
  name: string;
  slug: string;
  goals: number;
  team: SbTeamRef | null;
};

function findKnockout(
  matches: SbMatchListItem[],
  stageKey: string,
  roundMatcher: RegExp
): SbMatchListItem | undefined {
  return (
    matches.find((m) => (m.stageKey ?? "") === stageKey) ??
    matches.find((m) => roundMatcher.test(m.roundLabel ?? ""))
  );
}

/**
 * Derive 1st/2nd/3rd from the knockout results: the Grand Finale decides the
 * champion + runner-up, the Third-Place Playoff decides the bronze winner.
 */
function derivePlacements(matches: SbMatchListItem[]): Placement[] | null {
  const final = findKnockout(matches, "grand_final", /grand fina|^final/i);
  const third = findKnockout(matches, "third_place", /third[- ]?place/i);
  if (!final && !third) return null;

  const finalWinner = final ? matchWinner(final) : null;
  const champion =
    final && finalWinner ? (finalWinner === "home" ? final.homeTeam : final.awayTeam) : null;
  const runnerUp =
    final && finalWinner ? (finalWinner === "home" ? final.awayTeam : final.homeTeam) : null;
  const thirdWinner = third ? matchWinner(third) : null;
  const thirdPlace =
    third && thirdWinner ? (thirdWinner === "home" ? third.homeTeam : third.awayTeam) : null;

  return [
    { rank: 1, label: "Champions", team: champion },
    { rank: 2, label: "Runner Up", team: runnerUp },
    { rank: 3, label: "Third Place", team: thirdPlace },
  ];
}

/** Aggregate goal events into a scorer leaderboard (per player + club). */
function deriveTopScorers(matches: SbMatchListItem[]): Scorer[] {
  const byKey = new Map<string, Scorer>();
  for (const match of matches) {
    for (const event of match.events ?? []) {
      if (event.type !== "goal") continue;
      const name = event.player?.displayName ?? event.playerLabel;
      if (!name || /^(unknown|player\s*[12])$/i.test(name.trim())) continue;
      const team =
        event.teamId === match.homeTeam.id
          ? match.homeTeam
          : event.teamId === match.awayTeam.id
            ? match.awayTeam
            : null;
      const slug = event.player?.slug ?? slugifyName(name);
      const key = `${slug}::${team?.id ?? "free"}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.goals += 1;
      } else {
        byKey.set(key, { key, name, slug, goals: 1, team });
      }
    }
  }
  return [...byKey.values()]
    .sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name))
    .slice(0, 10);
}

function StateBadge({ matches, loading }: { matches: SbMatchListItem[]; loading: boolean }) {
  if (loading) return null;
  const live = matches.some((m) => LIVE_STATUSES.has(m.status));
  const final = matches.find(
    (m) => (m.stageKey ?? "") === "grand_final" || /grand fina|^final/i.test(m.roundLabel ?? "")
  );
  if (live) return <span className="sbc-pill sbc-pill--live">Live</span>;
  if (final && final.status === "finished")
    return <span className="sbc-pill sbc-pill--done">Concluded · Finals</span>;
  if (matches.length > 0 && matches.every((m) => m.status === "finished"))
    return <span className="sbc-pill sbc-pill--done">Concluded</span>;
  return <span className="sbc-pill sbc-pill--scheduled">In Progress</span>;
}

function StandingsCard({
  groupKey,
  rows,
  rankLabel,
}: {
  groupKey: string;
  rows: StandingRow[];
  rankLabel: (rank: number) => string | null;
}) {
  return (
    <div className="sbc-standings-card">
      <div className="sbc-standings-card__head">
        <h3>Group {groupKey}</h3>
        <span className="sbc-standings-card__count">{rows.length} teams</span>
      </div>
      <table className="sbc-standings-table">
        <thead>
          <tr>
            <th className="sbc-col-pos">Pos</th>
            <th className="sbc-col-team">Team</th>
            <th>P</th>
            <th>GD</th>
            <th>Pts</th>
            <th className="sbc-col-form">Form</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const tag = rankLabel(row.rank ?? 0);
            return (
              <tr key={row.teamId}>
                <td className="sbc-col-pos">
                  <span className={`sbc-rank sbc-rank--${row.rank ?? 0}`}>{row.rank ?? "-"}</span>
                </td>
                <td className="sbc-col-team">
                  <div className="sbc-team-cell">
                    <TeamCrest team={{ name: row.teamName, shortName: row.shortName, logoUrl: null }} size="sm" />
                    <div className="sbc-team-cell__id">
                      <span className="sbc-team-cell__name">{row.teamName}</span>
                      {tag && (
                        <span
                          className={`sbc-qual ${
                            (row.rank ?? 0) === 1 ? "sbc-qual--finalist" : "sbc-qual--playoff"
                          }`}
                        >
                          {tag}
                        </span>
                      )}
                    </div>
                  </div>
                </td>
                <td>{row.played}</td>
                <td>{row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}</td>
                <td>
                  <strong className="sbc-pts">{row.points}</strong>
                </td>
                <td className="sbc-col-form">
                  <span className="sb-form-badges" aria-label={`Form ${(row.form ?? []).join(" ")}`}>
                    {(row.form ?? []).map((f, i) => (
                      <span key={`${row.teamId}-f-${i}`} className={`sb-form-badge sb-form-badge--${f.toLowerCase()}`}>
                        {f}
                      </span>
                    ))}
                    {(row.form ?? []).length === 0 && "—"}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PodiumCard({ placement }: { placement: Placement }) {
  const medal = placement.rank === 1 ? "🥇" : placement.rank === 2 ? "🥈" : "🥉";
  return (
    <div className={`sbc-podium sbc-podium--${placement.rank}`}>
      <div className="sbc-podium__rank">
        <span className="sbc-podium__medal" aria-hidden="true">
          {medal}
        </span>
        <span className="sbc-podium__place">{placement.rank}</span>
      </div>
      <div className="sbc-podium__body">
        <span className="sbc-podium__label">{placement.label}</span>
        {placement.team ? (
          <div className="sbc-podium__team">
            <TeamCrest team={{ name: placement.team.name, shortName: placement.team.shortName, logoUrl: placement.team.logoUrl ?? null }} size="sm" />
            <span className="sbc-podium__name">{placement.team.name}</span>
          </div>
        ) : (
          <span className="sbc-podium__name sbc-podium__name--tbd">To be decided</span>
        )}
      </div>
    </div>
  );
}

function ScorerRow({
  scorer,
  rank,
  competition,
}: {
  scorer: Scorer;
  rank: number;
  competition?: string;
}) {
  return (
    <li className="sbc-scorer">
      <span className="sbc-scorer__rank">{rank}</span>
      <span className="sbc-scorer__avatar" aria-hidden="true">
        {scorer.name
          .split(/\s+/)
          .slice(0, 2)
          .map((w) => w[0])
          .join("")
          .toUpperCase()}
      </span>
      <div className="sbc-scorer__id">
        <Link
          to={`/player/${scorer.slug}`}
          state={{
            displayName: scorer.name,
            club: scorer.team?.name ?? undefined,
            competition,
          }}
          className="sbc-scorer__name"
        >
          {scorer.name}
        </Link>
        {scorer.team && (
          <span className="sbc-scorer__team">
            <TeamCrest team={{ name: scorer.team.name, shortName: scorer.team.shortName, logoUrl: scorer.team.logoUrl ?? null }} size="sm" />
            {scorer.team.name}
          </span>
        )}
      </div>
      <span className="sbc-scorer__goals">
        {scorer.goals}
        <small>{scorer.goals === 1 ? "goal" : "goals"}</small>
      </span>
    </li>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12 2a7 7 0 0 0-7 7c0 4.7 6.1 12.2 6.36 12.51a.83.83 0 0 0 1.28 0C12.9 21.2 19 13.7 19 9a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z"
      />
    </svg>
  );
}

function TrophyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M18 4h-1V3a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v1H6a2 2 0 0 0-2 2v2a4 4 0 0 0 3.55 3.97A5 5 0 0 0 11 14.9V17H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.1a5 5 0 0 0 3.45-2.93A4 4 0 0 0 20 8V6a2 2 0 0 0-2-2ZM6 8V6h1v3.83A2 2 0 0 1 6 8Zm12 0a2 2 0 0 1-1 1.73V6h1v2Z"
      />
    </svg>
  );
}

const TEAM_DESCRIPTION =
  "Team page with recent results, upcoming matches, player list, and competition participation history.";

function CompetitionTeamCard({
  team,
  competitionLabel,
}: {
  team: SbTeamWithSquad;
  competitionLabel: string;
}) {
  const shortCode = deriveShortCode(team.name, team.shortName);
  const active = team.squad.length > 0;
  return (
    <Link to={`/scoreboard/team/${team.id}`} className="dbx-team-card">
      <div className="dbx-comp-card__tags">
        <span className="dbx-tag dbx-tag--team">TEAM</span>
        {active && <span className="dbx-tag dbx-tag--active">ACTIVE</span>}
      </div>
      <div className="dbx-team-card__heading">
        <div className="dbx-team-card__id">
          <TeamCrest team={{ name: team.name, shortName: team.shortName, logoUrl: team.logoUrl ?? null }} />
          <h3 className="dbx-comp-card__title">{team.name}</h3>
        </div>
        <span className="dbx-team-card__arrow" aria-hidden="true">
          →
        </span>
      </div>
      <p className="dbx-comp-card__geo">Club Profile · {shortCode}</p>
      <p className="dbx-comp-card__desc">{TEAM_DESCRIPTION}</p>
      <div className="dbx-comp-card__foot">
        <span className="dbx-foot-marker">
          <PinIcon />
          {team.city?.trim() || "Location pending"}
        </span>
        <span className="dbx-foot-marker">
          <TrophyIcon />
          {competitionLabel}
        </span>
      </div>
    </Link>
  );
}

type HistoryMilestone = {
  id: string;
  title: string;
  body: string;
  date?: string;
  done: boolean;
  match?: SbMatchListItem;
};

function formatMatchDate(match: SbMatchListItem): string | undefined {
  const raw = match.kickoffAt;
  if (raw == null || typeof raw === "object") return undefined;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function deriveHistoryMilestones(
  matches: SbMatchListItem[],
  placements: Placement[] | null
): HistoryMilestone[] {
  const milestones: HistoryMilestone[] = [];
  const groupMatches = matches.filter((m) => (m.stageKey ?? "").startsWith("group_"));
  const groupDone =
    groupMatches.length > 0 && groupMatches.every((m) => m.status === "finished");
  const lastGroupDay = groupMatches.reduce(
    (max, m) => Math.max(max, m.matchday ?? 0),
    0
  );
  const lastGroupMatch = [...groupMatches]
    .filter((m) => m.matchday === lastGroupDay)
    .sort((a, b) => (a.kickoffAt && b.kickoffAt ? new Date(b.kickoffAt).getTime() - new Date(a.kickoffAt).getTime() : 0))[0];

  milestones.push({
    id: "group-stage",
    title: groupDone ? "Group Stage Complete" : "Group Stage In Progress",
    body: groupDone
      ? `All ${groupMatches.length} group fixtures concluded across ${lastGroupDay || "multiple"} matchdays. Top teams from each group advanced to the knockout rounds.`
      : `${groupMatches.filter((m) => m.status === "finished").length} of ${groupMatches.length} group fixtures played.`,
    date: groupDone ? formatMatchDate(lastGroupMatch ?? groupMatches[groupMatches.length - 1]) : undefined,
    done: groupDone,
  });

  const third = findKnockout(matches, "third_place", /third[- ]?place/i);
  if (third) {
    const winner = matchWinner(third);
    milestones.push({
      id: "third-place",
      title: third.status === "finished" ? "Third-Place Decided" : "Third-Place Playoff",
      body:
        third.status === "finished" && winner
          ? `${winner === "home" ? third.homeTeam.name : third.awayTeam.name} claimed bronze after a ${third.homeScore}–${third.awayScore} result.`
          : "Second-placed teams from each group compete for the bronze medal.",
      date: formatMatchDate(third),
      done: third.status === "finished",
      match: third,
    });
  }

  const final = findKnockout(matches, "grand_final", /grand fina|^final/i);
  if (final) {
    const champion = placements?.find((p) => p.rank === 1)?.team;
    milestones.push({
      id: "champion",
      title: final.status === "finished" ? "Champion Crowned" : "Grand Finale",
      body:
        final.status === "finished" && champion
          ? `${champion.name} lifted the trophy after defeating their opponents ${final.homeScore}–${final.awayScore}.`
          : "Group winners meet in the Grand Finale to decide the champion.",
      date: formatMatchDate(final),
      done: final.status === "finished",
      match: final,
    });
  }

  return milestones;
}

function HistoryMilestoneItem({ milestone }: { milestone: HistoryMilestone }) {
  return (
    <li className={`sbc-milestone ${milestone.done ? "sbc-milestone--done" : "sbc-milestone--pending"}`}>
      <span className="sbc-milestone__dot" aria-hidden="true" />
      <div className="sbc-milestone__card">
        <div className="sbc-milestone__head">
          <h3 className="sbc-milestone__title">{milestone.title}</h3>
          {milestone.date && <span className="sbc-milestone__date">{milestone.date}</span>}
        </div>
        <p className="sbc-milestone__body">{milestone.body}</p>
        {milestone.match && milestone.match.status === "finished" && (
          <Link
            to={matchCenterPath(milestone.match)}
            className="sbc-milestone__scoreline text-link"
          >
            {milestone.match.homeTeam.name} {milestone.match.homeScore}–{milestone.match.awayScore}{" "}
            {milestone.match.awayTeam.name}
          </Link>
        )}
      </div>
    </li>
  );
}

function KnockoutBracketSection({ imageUrl }: { imageUrl: string }) {
  return (
    <section className="sbc-block sbc-bracket" aria-labelledby="sbc-bracket-title">
      <h2 id="sbc-bracket-title" className="sbc-block__title">
        Knockout Bracket
      </h2>
      <figure className="sbc-bracket__figure">
        <img
          src={imageUrl}
          alt="Ex Internationals Cup Knockout Draw"
          className="sbc-bracket__visual"
          loading="lazy"
          decoding="async"
        />
      </figure>
    </section>
  );
}

function NarrativeHighlight({ match }: { match: SbMatchListItem }) {
  const narrative = matchNarrative(match);
  if (!narrative) return null;
  return (
    <article className="sbc-narrative">
      <div className="sbc-narrative__match">
        <span>{match.roundLabel ?? "Match Report"}</span>
        <span className="sbc-narrative__score">
          {match.homeTeam.name} {match.homeScore}–{match.awayScore} {match.awayTeam.name}
        </span>
      </div>
      <p className="sbc-narrative__text">{narrative}</p>
    </article>
  );
}

export function CompetitionPage() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const [name, setName] = useState("");
  const [season, setSeason] = useState("");
  const [formatType, setFormatType] = useState<string | null>(null);
  const [bracketImageUrl, setBracketImageUrl] = useState<string | null>(null);
  const [teams, setTeams] = useState<SbTeamWithSquad[]>([]);
  const [matches, setMatches] = useState<SbMatchListItem[]>([]);
  const [standings, setStandings] = useState<StandingRow[]>([]);
  const [standingsGroups, setStandingsGroups] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<CompetitionTab>(() => {
    if (tabParam && TAB_IDS.has(tabParam)) return tabParam as CompetitionTab;
    return defaultTabForSlug(slug);
  });
  const [exIntlFixtureTab, setExIntlFixtureTab] = useState<ExIntlFixtureTab>("first_leg");
  const exIntlTabInitialized = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selectTab = (tab: CompetitionTab) => {
    setActiveTab(tab);
    const next = new URLSearchParams(searchParams);
    const slugDefault = defaultTabForSlug(slug);
    // Only omit tab from the URL when overview is this competition's default.
    // Competitions with a non-overview default (e.g. ex-intl → fixtures) must
    // persist tab=overview or the sync effect falls back to the slug default.
    if (tab === "overview" && slugDefault === "overview") {
      next.delete("tab");
    } else {
      next.set("tab", tab);
    }
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    if (!slug) return;
    if (tabParam && TAB_IDS.has(tabParam)) {
      setActiveTab(tabParam as CompetitionTab);
      return;
    }
    const def = defaultTabForSlug(slug);
    setActiveTab(def);
    if (def !== "overview") {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("tab", def);
          return next;
        },
        { replace: true }
      );
    }
  }, [slug, tabParam, setSearchParams]);

  usePageTitle(name || "Competition");

  useEffect(() => {
    if (!slug) return;
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchCompetition(slug, controller.signal)
      .then((c) => {
        if (cancelled) return null;
        setName(c.name);
        setSeason(c.season);
        setFormatType(c.formatType ?? c.type);
        setTeams(c.teams);
        const cfg = c.formatConfig as Record<string, unknown> | null | undefined;
        const bracketFromConfig =
          (typeof cfg?.bracketImageUrl === "string" && cfg.bracketImageUrl) ||
          (typeof cfg?.bannerUrl === "string" && cfg.bannerUrl) ||
          (slug === "ex-internationals-cup-2026"
            ? "/scoreboard/ex-internationals-cup-2026-bracket.png"
            : null);
        setBracketImageUrl(bracketFromConfig);
        return Promise.all([
          fetchMatches({ competitionId: c.id }, controller.signal).then((m) => {
            if (!cancelled) setMatches(m);
          }),
          fetchStandings(c.id, controller.signal).then((s) => {
            if (cancelled) return;
            setStandings(s.rows);
            setStandingsGroups(s.groups ?? []);
            if (s.formatType) setFormatType(s.formatType);
          }),
        ]);
      })
      .catch((e) => {
        if (!cancelled && !isAbortError(e)) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [slug]);

  const isExIntlCup = slug === "ex-internationals-cup-2026";

  useEffect(() => {
    exIntlTabInitialized.current = false;
    setExIntlFixtureTab("first_leg");
  }, [slug]);

  useEffect(() => {
    if (!isExIntlCup || matches.length === 0 || exIntlTabInitialized.current) return;
    exIntlTabInitialized.current = true;
    setExIntlFixtureTab(defaultExIntlFixtureTab(matches));
  }, [isExIntlCup, matches.length]);

  const seasonYear = season.match(/\d{4}/)?.[0] ?? season;
  // Competition names often already embed the year (e.g. "Jagaban Cup 2026"),
  // so only append the season when it isn't already present.
  const competitionLabel = name
    ? seasonYear && !name.includes(seasonYear)
      ? `${name} ${seasonYear}`
      : name
    : "";
  const fixtureMatches = useMemo(() => {
    if (isExIntlCup) return filterExIntlFixtures(matches, exIntlFixtureTab);
    return matches;
  }, [isExIntlCup, matches, exIntlFixtureTab]);
  const groupedFixtures = useMemo(() => groupFixtures(fixtureMatches), [fixtureMatches]);
  const placements = useMemo(() => derivePlacements(matches), [matches]);
  const topScorers = useMemo(() => deriveTopScorers(matches), [matches]);
  const totalGoals = useMemo(
    () => matches.reduce((sum, m) => sum + m.homeScore + m.awayScore, 0),
    [matches]
  );
  const isKnockoutFormat =
    formatType === "KNOCKOUT_CUP" || slug === "ex-internationals-cup-2026";
  const isGroupFormat =
    !isKnockoutFormat &&
    (formatType === "JAGABAN_CUP_STANDARD" ||
      formatType === "HYBRID_CHAMPIONS_LEAGUE" ||
      standingsGroups.length > 0);
  const showKnockoutBracket = Boolean(bracketImageUrl && isKnockoutFormat);

  const groups = standingsGroups.length ? standingsGroups : isGroupFormat ? [] : [""];

  const renderStandings = () => {
    if (loading) {
      return (
        <div className="sbc-standings-grid">
          {[0, 1].map((i) => (
            <div key={i} className="sbc-standings-card sbc-standings-card--skeleton">
              <span className="dtp-skeleton dtp-skeleton--line" style={{ width: "30%" }} />
              <span className="dtp-skeleton" style={{ height: "12rem", width: "100%" }} />
            </div>
          ))}
        </div>
      );
    }
    if (standings.length === 0) {
      return (
        <div className="dtp-empty-state sb-empty">
          <p className="dtp-empty-state__title">No standings yet</p>
          <p>Standings appear once group matches are completed.</p>
        </div>
      );
    }
    return (
      <div className="sbc-standings-grid">
        {groups.map((groupKey) => {
          const rows = groupKey
            ? standings.filter((r) => r.groupKey === groupKey)
            : standings;
          return (
            <StandingsCard
              key={groupKey || "all"}
              groupKey={groupKey || "Standings"}
              rows={rows}
              rankLabel={(rank) =>
                !isGroupFormat
                  ? null
                  : rank === 1
                    ? "Finalist"
                    : rank === 2
                      ? "3rd-Place Playoff"
                      : null
              }
            />
          );
        })}
      </div>
    );
  };

  const renderOverview = () => (
    <div className="sbc-overview">
      {isGroupFormat && (
        <div className="sbc-alert" role="note">
          <span className="sbc-alert__icon" aria-hidden="true">
            🏆
          </span>
          <div>
            <p className="sbc-alert__title">Tournament Format</p>
            <p className="sbc-alert__body">{JAGABAN_FORMAT_COPY}</p>
          </div>
        </div>
      )}

      {isKnockoutFormat && (
        <div className="sbc-alert" role="note">
          <span className="sbc-alert__icon" aria-hidden="true">
            🏆
          </span>
          <div>
            <p className="sbc-alert__title">Knockout Format</p>
            <p className="sbc-alert__body">{KNOCKOUT_FORMAT_COPY}</p>
          </div>
        </div>
      )}

      {showKnockoutBracket && bracketImageUrl && (
        <KnockoutBracketSection imageUrl={bracketImageUrl} />
      )}

      {!isKnockoutFormat && (
        <section className="sbc-block">
          <h2 className="sbc-block__title">Standings</h2>
          {renderStandings()}
        </section>
      )}

      {!loading && placements && (
        <section className="sbc-block">
          <h2 className="sbc-block__title">Final Placements</h2>
          <div className="sbc-podium-row">
            {placements.map((p) => (
              <PodiumCard key={p.rank} placement={p} />
            ))}
          </div>
        </section>
      )}

      {!loading && matches.length > 0 && (
        <section className="sbc-block">
          <h2 className="sbc-block__title">Tournament Totals</h2>
          <div className="sbc-totals">
            <div className="sbc-total">
              <span className="sbc-total__value">{matches.length}</span>
              <span className="sbc-total__label">Matches</span>
            </div>
            <div className="sbc-total">
              <span className="sbc-total__value">{totalGoals}</span>
              <span className="sbc-total__label">Goals</span>
            </div>
            <div className="sbc-total">
              <span className="sbc-total__value">{teams.length}</span>
              <span className="sbc-total__label">Teams</span>
            </div>
            <div className="sbc-total">
              <span className="sbc-total__value">
                {matches.length ? (totalGoals / matches.length).toFixed(1) : "0.0"}
              </span>
              <span className="sbc-total__label">Goals / Match</span>
            </div>
          </div>
        </section>
      )}

      <section className="sbc-block">
        <h2 className="sbc-block__title">Top Scorers</h2>
        {loading ? (
          <div className="sbc-scorer-list" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="dtp-skeleton dtp-skeleton--line" style={{ height: "3rem" }} />
            ))}
          </div>
        ) : topScorers.length === 0 ? (
          <div className="dtp-empty-state">
            <p className="dtp-empty-state__title">No goals recorded yet</p>
            <p>Scorers appear here once goal events are published.</p>
          </div>
        ) : (
          <ol className="sbc-scorer-list">
            {topScorers.map((scorer, i) => (
              <ScorerRow
                key={scorer.key}
                scorer={scorer}
                rank={i + 1}
                competition={competitionLabel}
              />
            ))}
          </ol>
        )}
      </section>
    </div>
  );

  const renderFixtures = () => {
    if (loading) {
      return (
        <div className="sbc-fixtures" aria-busy="true">
          {[0, 1].map((i) => (
            <div key={i} className="sbc-matchday">
              <span className="dtp-skeleton dtp-skeleton--line" style={{ width: "35%", height: "2.5rem" }} />
              <div className="sb-mc-grid">
                {[0, 1].map((j) => (
                  <span key={j} className="dtp-skeleton sb-mc-skeleton" />
                ))}
              </div>
            </div>
          ))}
        </div>
      );
    }
    if (!isExIntlCup && groupedFixtures.length === 0) {
      return (
        <div className="dtp-empty-state">
          <p className="dtp-empty-state__title">No matches scheduled</p>
          <p>Fixtures will appear here once matchdays are published.</p>
        </div>
      );
    }
    return (
      <div className="sbc-fixtures">
        {isExIntlCup && matches.length > 0 && (
          <div
            className="dbx-segmented sbc-fixture-tabs"
            role="tablist"
            aria-label="Fixture round filters"
          >
            {EX_INTL_FIXTURE_TABS.map((tab) => {
              const count = filterExIntlFixtures(matches, tab.id).length;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={exIntlFixtureTab === tab.id}
                  className={
                    exIntlFixtureTab === tab.id
                      ? "dbx-segmented__btn active"
                      : "dbx-segmented__btn"
                  }
                  onClick={() => setExIntlFixtureTab(tab.id)}
                >
                  {tab.label}
                  {count > 0 && (
                    <span className="sbc-fixture-tabs__count" aria-hidden="true">
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
        {isExIntlCup && groupedFixtures.length === 0 && (
          <div className="dtp-empty-state sbc-fixtures-empty">
            <p className="dtp-empty-state__title">Fixtures coming soon</p>
            <p>No matches scheduled yet for this round.</p>
          </div>
        )}
        {groupedFixtures.map((group) => (
          <section
            key={group.label}
            className={`sbc-matchday${isKnockoutSection(group.label) ? " sbc-matchday--knockout" : ""}`}
          >
            <div className="sbc-matchday__head">
              <h3 className="sbc-matchday__title">{group.label}</h3>
              <span className="sbc-matchday__count">
                {group.matches.length} {group.matches.length === 1 ? "match" : "matches"}
              </span>
            </div>
            <div className="sb-mc-grid">
              {group.matches.map((m) => (
                <MatchCenterCard key={m.id} match={m} />
              ))}
            </div>
          </section>
        ))}
      </div>
    );
  };

  const renderTeams = () => {
    if (loading) {
      return (
        <div className="dbx-team-grid" aria-busy="true">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="dbx-comp-card dbx-comp-card--skeleton">
              <span className="dtp-skeleton dtp-skeleton--line" style={{ width: "55%" }} />
              <span className="dtp-skeleton dtp-skeleton--line" style={{ width: "45%" }} />
              <span className="dtp-skeleton dtp-skeleton--line" style={{ width: "90%" }} />
              <span className="dtp-skeleton dtp-skeleton--line" style={{ width: "60%" }} />
            </div>
          ))}
        </div>
      );
    }
    if (teams.length === 0) {
      return (
        <div className="dtp-empty-state">
          <p className="dtp-empty-state__title">No teams registered</p>
          <p>Teams appear here once they are added to this competition.</p>
        </div>
      );
    }
    return (
      <div className="sbc-teams">
        <div className="sbc-teams-toolbar">
          <span className="sbc-teams-toolbar__count">
            {teams.length} {teams.length === 1 ? "club" : "clubs"} in this edition
          </span>
        </div>
        <div className="dbx-team-grid">
          {teams.map((team) => (
            <CompetitionTeamCard key={team.id} team={team} competitionLabel={competitionLabel} />
          ))}
        </div>
      </div>
    );
  };

  const historyMilestones = useMemo(
    () => deriveHistoryMilestones(matches, placements),
    [matches, placements]
  );
  const narrativeHighlights = useMemo(
    () =>
      matches
        .filter((m) => m.status === "finished" && matchNarrative(m))
        .sort((a, b) => {
          const knockout = (m: SbMatchListItem) =>
            (m.stageKey ?? "") === "grand_final" || (m.stageKey ?? "") === "third_place" ? 1 : 0;
          return knockout(b) - knockout(a) || b.homeScore + b.awayScore - (a.homeScore + a.awayScore);
        })
        .slice(0, 4),
    [matches]
  );

  const renderHistory = () => {
    if (loading) {
      return (
        <div className="sbc-history" aria-busy="true">
          <span className="dtp-skeleton" style={{ height: "10rem", width: "100%", borderRadius: "var(--radius-lg)" }} />
          <span className="dtp-skeleton" style={{ height: "14rem", width: "100%" }} />
          <span className="dtp-skeleton" style={{ height: "8rem", width: "100%" }} />
        </div>
      );
    }
    const champion = placements?.find((p) => p.rank === 1)?.team;
    const concluded = matches.length > 0 && matches.every((m) => m.status === "finished");
    return (
      <div className="sbc-history">
        <div className="sbc-history__hero">
          <span className="sbc-history__eyebrow">{seasonYear} Edition</span>
          <h2 className="sbc-history__title">{name}</h2>
          <p className="sbc-history__status">
            {concluded ? "This edition has concluded." : "This edition is in progress."}
          </p>
          {champion && (
            <div className="sbc-history__champ">
              <span className="sbc-history__champ-label">Champions</span>
              <div className="sbc-podium__team">
                <TeamCrest team={{ name: champion.name, shortName: champion.shortName, logoUrl: champion.logoUrl ?? null }} />
                <span className="sbc-podium__name">{champion.name}</span>
              </div>
            </div>
          )}
        </div>

        {historyMilestones.length > 0 && (
          <section className="sbc-block">
            <h2 className="sbc-block__title">Tournament Timeline</h2>
            <ol className="sbc-timeline">
              {historyMilestones.map((m) => (
                <HistoryMilestoneItem key={m.id} milestone={m} />
              ))}
            </ol>
          </section>
        )}

        {placements && (
          <section className="sbc-block">
            <h2 className="sbc-block__title">Final Placements</h2>
            <div className="sbc-podium-row">
              {placements.map((p) => (
                <PodiumCard key={p.rank} placement={p} />
              ))}
            </div>
          </section>
        )}

        {matches.length > 0 && (
          <section className="sbc-block">
            <h2 className="sbc-block__title">Edition Stats</h2>
            <div className="sbc-totals">
              <div className="sbc-total">
                <span className="sbc-total__value">{matches.length}</span>
                <span className="sbc-total__label">Matches</span>
              </div>
              <div className="sbc-total">
                <span className="sbc-total__value">{totalGoals}</span>
                <span className="sbc-total__label">Goals</span>
              </div>
              <div className="sbc-total">
                <span className="sbc-total__value">{teams.length}</span>
                <span className="sbc-total__label">Teams</span>
              </div>
              <div className="sbc-total">
                <span className="sbc-total__value">
                  {matches.length ? (totalGoals / matches.length).toFixed(1) : "0.0"}
                </span>
                <span className="sbc-total__label">Goals / Match</span>
              </div>
            </div>
          </section>
        )}

        {topScorers.length > 0 && (
          <section className="sbc-block">
            <h2 className="sbc-block__title">Top Scorers</h2>
            <ol className="sbc-scorer-list sbc-scorer-list--compact">
              {topScorers.slice(0, 5).map((scorer, i) => (
                <ScorerRow
                  key={scorer.key}
                  scorer={scorer}
                  rank={i + 1}
                  competition={competitionLabel}
                />
              ))}
            </ol>
          </section>
        )}

        {narrativeHighlights.length > 0 && (
          <section className="sbc-block">
            <h2 className="sbc-block__title">Match Highlights</h2>
            <div className="sbc-narratives">
              {narrativeHighlights.map((m) => (
                <NarrativeHighlight key={m.id} match={m} />
              ))}
            </div>
          </section>
        )}
      </div>
    );
  };

  return (
    <div className="sb-page dbx-page sbc-page">
      <MatchTicker />

      <div className="sbc-meta" aria-label="Competition meta">
        <span className="sbc-pill sbc-pill--year">{seasonYear || "Season"}</span>
        <StateBadge matches={matches} loading={loading} />
        <span className="sbc-pill sbc-pill--official">Official Tournament</span>
      </div>

      <header className="sbc-hero">
        <div className="sbc-hero__badge" aria-hidden="true">
          <span>{(name || "Cup").slice(0, 1).toUpperCase()}</span>
        </div>
        <div className="sbc-hero__main">
          <h1 className="sbc-hero__title">
            {name || (loading ? "Loading competition…" : "Competition")}
          </h1>
          <p className="sbc-hero__desc">{COMPETITION_DESCRIPTION}</p>
        </div>
      </header>

      {error && (
        <p className="dtp-error-banner" role="alert">
          {error}
        </p>
      )}

      <div className="dbx-segmented sbc-tabs" role="tablist" aria-label="Competition sections">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? "dbx-segmented__btn active" : "dbx-segmented__btn"}
            onClick={() => selectTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="sbc-comp-layout">
        <div className="sbc-comp-layout__main">
          {activeTab === "overview" && renderOverview()}
          {activeTab === "fixtures" && <div className="sbc-overview">{renderFixtures()}</div>}
          {activeTab === "teams" && <div className="sbc-overview">{renderTeams()}</div>}
          {activeTab === "history" && <div className="sbc-overview">{renderHistory()}</div>}
        </div>
        {slug && (
          <aside className="sbc-comp-layout__sidebar" aria-label="Competition stats">
            <StatLeadersWidget competitionSlug={slug} competitionLabel={competitionLabel} />
          </aside>
        )}
      </div>
    </div>
  );
}
