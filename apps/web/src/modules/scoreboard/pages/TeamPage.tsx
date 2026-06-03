import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  fetchTeam,
  type SbMatchListItem,
  type SbSquadPlayer,
  type SbTeamDetail,
} from "../../../api/scoreboard";
import { isAbortError } from "../../../api/client";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { MatchCenterCard } from "../components/MatchCenterCard";
import { MatchTicker } from "../components/MatchTicker";
import { TeamCrest } from "../components/TeamCrest";

type TeamTab = "overview" | "fixtures" | "squad" | "stats";

const TABS: { id: TeamTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "fixtures", label: "Fixtures" },
  { id: "squad", label: "Squad" },
  { id: "stats", label: "Stats" },
];

const TEAM_DESCRIPTION =
  "Team page with recent results, upcoming matches, player list, and competition participation history.";

const FINISHED_STATUSES = new Set(["finished"]);
const UPCOMING_STATUSES = new Set(["scheduled"]);
const LIVE_STATUSES = new Set(["live", "halftime"]);

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

function slugifyName(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function resultForTeam(match: SbMatchListItem, teamId: string): "W" | "D" | "L" {
  const isHome = match.homeTeam.id === teamId;
  const goalsFor = isHome ? match.homeScore : match.awayScore;
  const goalsAgainst = isHome ? match.awayScore : match.homeScore;
  if (goalsFor > goalsAgainst) return "W";
  if (goalsFor < goalsAgainst) return "L";
  return "D";
}

function fixtureSectionLabel(match: SbMatchListItem, teamId: string): string {
  const isHome = match.homeTeam.id === teamId;
  const stage = match.stageKey ?? "";
  if (stage === "third_place") return "Third-Place Playoff";
  if (stage === "grand_final") return "Grand Finale";
  if (match.matchday != null) return `Day ${match.matchday} · ${isHome ? "Home" : "Away"}`;
  const dayMatch = match.roundLabel?.match(/DAY\s*(\d+)/i);
  if (dayMatch) return `Day ${dayMatch[1]} · ${isHome ? "Home" : "Away"}`;
  if (match.roundLabel) return `${match.roundLabel} · ${isHome ? "Home" : "Away"}`;
  if (match.kickoffAt) {
    return `${new Date(match.kickoffAt).toLocaleDateString()} · ${isHome ? "Home" : "Away"}`;
  }
  return isHome ? "Home fixtures" : "Away fixtures";
}

function fixtureSortKey(match: SbMatchListItem): number {
  const stage = match.stageKey ?? "";
  if (stage.startsWith("group_")) return (match.matchday ?? 0) * 10;
  if (stage === "third_place") return 9000;
  if (stage === "grand_final") return 9100;
  return 5000 + (match.matchday ?? 0);
}

function isKnockoutSection(label: string): boolean {
  return /third[- ]?place|grand fina|^final/i.test(label);
}

function groupFixtures(matches: SbMatchListItem[], teamId: string) {
  const sorted = [...matches].sort(
    (a, b) =>
      fixtureSortKey(a) - fixtureSortKey(b) ||
      (a.kickoffAt && b.kickoffAt
        ? new Date(a.kickoffAt).getTime() - new Date(b.kickoffAt).getTime()
        : 0)
  );
  return sorted.reduce<Array<{ label: string; matches: SbMatchListItem[] }>>(
    (groups, match) => {
      const label = fixtureSectionLabel(match, teamId);
      const group = groups.find((item) => item.label === label);
      if (group) group.matches.push(match);
      else groups.push({ label, matches: [match] });
      return groups;
    },
    []
  );
}

type TeamRecord = {
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  cleanSheets: number;
};

function deriveTeamRecord(matches: SbMatchListItem[], teamId: string): TeamRecord {
  const record: TeamRecord = {
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    points: 0,
    cleanSheets: 0,
  };

  for (const match of matches) {
    if (!FINISHED_STATUSES.has(match.status)) continue;
    const isHome = match.homeTeam.id === teamId;
    const gf = isHome ? match.homeScore : match.awayScore;
    const ga = isHome ? match.awayScore : match.homeScore;
    record.played += 1;
    record.goalsFor += gf;
    record.goalsAgainst += ga;
    if (ga === 0) record.cleanSheets += 1;
    const result = resultForTeam(match, teamId);
    if (result === "W") {
      record.won += 1;
      record.points += 3;
    } else if (result === "D") {
      record.drawn += 1;
      record.points += 1;
    } else {
      record.lost += 1;
    }
  }

  record.goalDifference = record.goalsFor - record.goalsAgainst;
  return record;
}

type TeamScorer = {
  key: string;
  name: string;
  slug: string;
  goals: number;
};

function deriveTeamTopScorers(matches: SbMatchListItem[], teamId: string): TeamScorer[] {
  const byKey = new Map<string, TeamScorer>();
  for (const match of matches) {
    for (const event of match.events ?? []) {
      if (event.type !== "goal" || event.teamId !== teamId) continue;
      const name = event.player?.displayName ?? event.playerLabel;
      if (!name) continue;
      const slug = event.player?.slug ?? slugifyName(name);
      const key = slug;
      const existing = byKey.get(key);
      if (existing) existing.goals += 1;
      else byKey.set(key, { key, name, slug, goals: 1 });
    }
  }
  return [...byKey.values()]
    .sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name))
    .slice(0, 10);
}

function playerInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

function squadPlayerLink(
  row: SbSquadPlayer,
  team: SbTeamDetail
): { path: string; state: { displayName: string; club: string; competition: string } } | null {
  const linked = row.player?.isPublic ? row.player : null;
  if (!linked) return null;
  const displayName = linked.displayName ?? row.displayName;
  const slug = linked.slug ?? slugifyName(displayName);
  const seasonYear = team.competition.season.match(/\d{4}/)?.[0] ?? "";
  const competitionLabel = team.competition.name.includes(seasonYear)
    ? team.competition.name
    : `${team.competition.name}${seasonYear ? ` ${seasonYear}` : ""}`;
  return {
    path: `/player/${slug}`,
    state: { displayName, club: team.name, competition: competitionLabel },
  };
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

function TeamScorerRow({
  scorer,
  rank,
  team,
  competitionLabel,
}: {
  scorer: TeamScorer;
  rank: number;
  team: SbTeamDetail;
  competitionLabel: string;
}) {
  return (
    <li className="sbc-scorer">
      <span className="sbc-scorer__rank">{rank}</span>
      <span className="sbc-scorer__avatar" aria-hidden="true">
        {playerInitials(scorer.name)}
      </span>
      <div className="sbc-scorer__id">
        <Link
          to={`/player/${scorer.slug}`}
          state={{
            displayName: scorer.name,
            club: team.name,
            competition: competitionLabel,
          }}
          className="sbc-scorer__name"
        >
          {scorer.name}
        </Link>
        <span className="sbc-scorer__team">
          <TeamCrest
            team={{ name: team.name, shortName: team.shortName, logoUrl: team.logoUrl }}
            size="sm"
          />
          {team.name}
        </span>
      </div>
      <span className="sbc-scorer__goals">
        {scorer.goals}
        <small>{scorer.goals === 1 ? "goal" : "goals"}</small>
      </span>
    </li>
  );
}

function SquadPlayerRow({ row, team }: { row: SbSquadPlayer; team: SbTeamDetail }) {
  const link = squadPlayerLink(row, team);
  const position = row.position ?? row.player?.positionPrimary ?? "Position pending";
  const displayName = row.player?.displayName ?? row.displayName;

  return (
    <li className="sbt-squad-player">
      <span className="sbt-squad-player__avatar" aria-hidden="true">
        {row.player?.playerPhotoUrl ? (
          <img src={row.player.playerPhotoUrl} alt="" loading="lazy" width={40} height={40} />
        ) : (
          playerInitials(displayName)
        )}
      </span>
      <div className="sbt-squad-player__body">
        {link ? (
          <Link to={link.path} state={link.state} className="sbt-squad-player__name">
            {displayName}
          </Link>
        ) : (
          <span className="sbt-squad-player__name sbt-squad-player__name--plain">{displayName}</span>
        )}
        <span className="sbt-squad-player__meta">{position}</span>
      </div>
      <span className="sbt-squad-player__number">{row.shirtNumber ?? "—"}</span>
    </li>
  );
}

function TeamPageSkeleton() {
  return (
    <div className="sb-page dbx-page sbc-page sbt-page" aria-busy="true">
      <MatchTicker />
      <span className="dtp-skeleton dtp-skeleton--line" style={{ width: "8rem" }} />
      <div className="dbx-comp-card__tags">
        {[0, 1, 2].map((i) => (
          <span key={i} className="dtp-skeleton dtp-skeleton--line" style={{ width: "4.5rem", height: "1.4rem" }} />
        ))}
      </div>
      <header className="sbt-hero sbt-hero--skeleton">
        <span className="dtp-skeleton" style={{ width: "5rem", height: "5rem", borderRadius: "var(--radius-md)" }} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <span className="dtp-skeleton dtp-skeleton--line" style={{ width: "55%", height: "2.2rem" }} />
          <span className="dtp-skeleton dtp-skeleton--line" style={{ width: "80%" }} />
          <span className="dtp-skeleton dtp-skeleton--line" style={{ width: "40%" }} />
        </div>
      </header>
      <div className="sbc-totals">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <span key={i} className="dtp-skeleton" style={{ height: "4.5rem", flex: "1 1 6rem" }} />
        ))}
      </div>
      <span className="dtp-skeleton dtp-skeleton--line" style={{ width: "100%", height: "2.5rem" }} />
      <div className="sb-mc-grid">
        {[0, 1].map((i) => (
          <span key={i} className="dtp-skeleton sb-mc-skeleton" />
        ))}
      </div>
    </div>
  );
}

export function TeamPage() {
  const { id } = useParams<{ id: string }>();
  const [team, setTeam] = useState<SbTeamDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TeamTab>("overview");

  usePageTitle(team ? team.name : "Team");

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    let cancelled = false;
    setTeam(null);
    setError(null);
    setLoading(true);
    fetchTeam(id, controller.signal)
      .then((data) => {
        if (!cancelled) setTeam(data);
      })
      .catch((err) => {
        if (!cancelled && !isAbortError(err)) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [id]);

  const shortCode = team ? deriveShortCode(team.name, team.shortName) : "";
  const seasonYear = team?.competition.season.match(/\d{4}/)?.[0] ?? "";
  const competitionLabel = team
    ? team.competition.name.includes(seasonYear)
      ? team.competition.name
      : `${team.competition.name}${seasonYear ? ` ${seasonYear}` : ""}`
    : "";

  const record = useMemo(
    () => (team ? deriveTeamRecord(team.matches, team.id) : null),
    [team]
  );

  const recentForm = useMemo(
    () =>
      team?.matches
        .filter((m) => FINISHED_STATUSES.has(m.status))
        .slice(0, 5)
        .map((m) => resultForTeam(m, team.id)) ?? [],
    [team]
  );

  const recentResults = useMemo(
    () => team?.matches.filter((m) => FINISHED_STATUSES.has(m.status)).slice(0, 5) ?? [],
    [team]
  );

  const upcomingMatches = useMemo(
    () =>
      team?.matches.filter(
        (m) => UPCOMING_STATUSES.has(m.status) || LIVE_STATUSES.has(m.status)
      ) ?? [],
    [team]
  );

  const groupedFixtures = useMemo(
    () => (team ? groupFixtures(team.matches, team.id) : []),
    [team]
  );

  const topScorers = useMemo(
    () => (team ? deriveTeamTopScorers(team.matches, team.id) : []),
    [team]
  );

  const isActive = (team?.squad.length ?? 0) > 0 || (team?.matches.length ?? 0) > 0;
  const hasLiveMatch = team?.matches.some((m) => LIVE_STATUSES.has(m.status)) ?? false;

  if (loading && !team) {
    return <TeamPageSkeleton />;
  }

  if (error && !team) {
    return (
      <div className="sb-page dbx-page sbc-page sbt-page">
        <MatchTicker />
        <p className="dtp-error-banner" role="alert">
          {error}
        </p>
        <Link to="/scoreboard/browse" className="sbt-back text-link">
          ← Back to browse
        </Link>
      </div>
    );
  }

  if (!team) return null;

  const renderOverview = () => (
    <div className="sbc-overview">
      {recentForm.length > 0 && (
        <section className="sbc-block">
          <h2 className="sbc-block__title">Recent Form</h2>
          <span className="sb-form-badges" aria-label={`Form ${recentForm.join(" ")}`}>
            {recentForm.map((f, i) => (
              <span key={`${f}-${i}`} className={`sb-form-badge sb-form-badge--${f.toLowerCase()}`}>
                {f}
              </span>
            ))}
          </span>
        </section>
      )}

      <section className="sbc-block">
        <h2 className="sbc-block__title">Recent Results</h2>
        {recentResults.length === 0 ? (
          <div className="dtp-empty-state">
            <p className="dtp-empty-state__title">No completed matches yet</p>
            <p>Results appear here once fixtures are played.</p>
          </div>
        ) : (
          <div className="sb-mc-grid">
            {recentResults.map((match) => (
              <MatchCenterCard key={match.id} match={match} />
            ))}
          </div>
        )}
      </section>

      {upcomingMatches.length > 0 && (
        <section className="sbc-block">
          <h2 className="sbc-block__title">Upcoming</h2>
          <div className="sb-mc-grid">
            {upcomingMatches.map((match) => (
              <MatchCenterCard key={match.id} match={match} />
            ))}
          </div>
        </section>
      )}
    </div>
  );

  const renderFixtures = () => {
    if (groupedFixtures.length === 0) {
      return (
        <div className="dtp-empty-state">
          <p className="dtp-empty-state__title">No matches scheduled</p>
          <p>Fixtures will appear here once matchdays are published.</p>
        </div>
      );
    }
    return (
      <div className="sbc-fixtures">
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

  const renderSquad = () => {
    if (team.squad.length === 0) {
      return (
        <div className="dtp-empty-state">
          <p className="dtp-empty-state__title">No squad published</p>
          <p>Player roster rows appear here once the squad is added.</p>
        </div>
      );
    }
    return (
      <section className="sbc-block">
        <div className="sbt-squad-head">
          <h2 className="sbc-block__title">Squad</h2>
          <span className="sbt-squad-head__count">
            {team.squad.length} {team.squad.length === 1 ? "player" : "players"}
          </span>
        </div>
        <ol className="sbt-squad">
          {team.squad.map((row) => (
            <SquadPlayerRow key={row.id} row={row} team={team} />
          ))}
        </ol>
      </section>
    );
  };

  const renderStats = () => (
    <div className="sbc-overview">
      <section className="sbc-block">
        <h2 className="sbc-block__title">Season Record</h2>
        {record && record.played === 0 ? (
          <div className="dtp-empty-state">
            <p className="dtp-empty-state__title">No stats yet</p>
            <p>Aggregates appear once matches are completed.</p>
          </div>
        ) : (
          record && (
            <div className="sbc-totals">
              <div className="sbc-total">
                <span className="sbc-total__value">{record.won}</span>
                <span className="sbc-total__label">Wins</span>
              </div>
              <div className="sbc-total">
                <span className="sbc-total__value">{record.drawn}</span>
                <span className="sbc-total__label">Draws</span>
              </div>
              <div className="sbc-total">
                <span className="sbc-total__value">{record.lost}</span>
                <span className="sbc-total__label">Losses</span>
              </div>
              <div className="sbc-total">
                <span className="sbc-total__value">{record.points}</span>
                <span className="sbc-total__label">Points</span>
              </div>
              <div className="sbc-total">
                <span className="sbc-total__value">
                  {record.goalDifference > 0 ? `+${record.goalDifference}` : record.goalDifference}
                </span>
                <span className="sbc-total__label">Goal Diff</span>
              </div>
              <div className="sbc-total">
                <span className="sbc-total__value">{record.goalsFor}</span>
                <span className="sbc-total__label">Goals For</span>
              </div>
              <div className="sbc-total">
                <span className="sbc-total__value">{record.goalsAgainst}</span>
                <span className="sbc-total__label">Goals Against</span>
              </div>
              <div className="sbc-total">
                <span className="sbc-total__value">{record.cleanSheets}</span>
                <span className="sbc-total__label">Clean Sheets</span>
              </div>
            </div>
          )
        )}
      </section>

      <section className="sbc-block">
        <h2 className="sbc-block__title">Top Scorers</h2>
        {topScorers.length === 0 ? (
          <div className="dtp-empty-state">
            <p className="dtp-empty-state__title">No goals recorded yet</p>
            <p>Club scorers appear here once goal events are published.</p>
          </div>
        ) : (
          <ol className="sbc-scorer-list">
            {topScorers.map((scorer, i) => (
              <TeamScorerRow
                key={scorer.key}
                scorer={scorer}
                rank={i + 1}
                team={team}
                competitionLabel={competitionLabel}
              />
            ))}
          </ol>
        )}
      </section>
    </div>
  );

  return (
    <div className="sb-page dbx-page sbc-page sbt-page">
      <MatchTicker />

      <nav className="sbt-nav" aria-label="Team navigation">
        <Link to={`/scoreboard/competition/${team.competition.slug}`} className="sbt-back text-link">
          ← Back to {team.competition.name}
        </Link>
        <Link to="/scoreboard/browse" className="sbt-back text-link">
          Browse all
        </Link>
      </nav>

      <div className="dbx-comp-card__tags" aria-label="Team badges">
        <span className="dbx-tag dbx-tag--team">TEAM</span>
        {isActive && <span className="dbx-tag dbx-tag--active">ACTIVE</span>}
        <span className="dbx-tag dbx-tag--featured">FEATURED</span>
        {hasLiveMatch && <span className="sbc-pill sbc-pill--live">Live</span>}
      </div>

      <header className="sbt-hero">
        <div className="sbt-hero__crest">
          <TeamCrest
            team={{ name: team.name, shortName: team.shortName, logoUrl: team.logoUrl }}
          />
        </div>
        <div className="sbt-hero__main">
          <h1 className="sbc-hero__title">{team.name}</h1>
          <p className="dbx-comp-card__geo">Club Profile · {shortCode}</p>
          <p className="sbc-hero__desc">{TEAM_DESCRIPTION}</p>
          <div className="sbt-hero__geo">
            <span className="sbc-pill">
              <PinIcon />
              {team.city?.trim() || "Location pending"}
            </span>
            <Link
              to={`/scoreboard/competition/${team.competition.slug}`}
              className="sbc-pill sbc-pill--official sbt-hero__comp-link"
            >
              <TrophyIcon />
              {competitionLabel}
            </Link>
          </div>
        </div>
      </header>

      {error && (
        <p className="dtp-error-banner" role="alert">
          {error}
        </p>
      )}

      {record && record.played > 0 && (
        <div className="sbc-totals sbt-quick-stats" aria-label="Quick stats">
          <div className="sbc-total">
            <span className="sbc-total__value">
              {record.won}-{record.drawn}-{record.lost}
            </span>
            <span className="sbc-total__label">W-D-L</span>
          </div>
          <div className="sbc-total">
            <span className="sbc-total__value">{record.points}</span>
            <span className="sbc-total__label">Pts</span>
          </div>
          <div className="sbc-total">
            <span className="sbc-total__value">
              {record.goalDifference > 0 ? `+${record.goalDifference}` : record.goalDifference}
            </span>
            <span className="sbc-total__label">GD</span>
          </div>
          <div className="sbc-total">
            <span className="sbc-total__value">{record.goalsFor}</span>
            <span className="sbc-total__label">GF</span>
          </div>
          <div className="sbc-total">
            <span className="sbc-total__value">{record.played}</span>
            <span className="sbc-total__label">Played</span>
          </div>
        </div>
      )}

      <div className="dbx-segmented sbc-tabs" role="tablist" aria-label="Team sections">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? "dbx-segmented__btn active" : "dbx-segmented__btn"}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "overview" && renderOverview()}
      {activeTab === "fixtures" && <div className="sbc-overview">{renderFixtures()}</div>}
      {activeTab === "squad" && <div className="sbc-overview">{renderSquad()}</div>}
      {activeTab === "stats" && renderStats()}
    </div>
  );
}
