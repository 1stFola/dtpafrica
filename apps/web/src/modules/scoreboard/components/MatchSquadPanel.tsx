import { Link } from "react-router-dom";
import type { PlayerProfileLinkState } from "../../directopro/pages/PlayerProfilePage";
import type { SbMatchdayRoster, SbSquadPlayer, SbTeamWithSquad } from "../../../api/scoreboard";
import { TeamCrest } from "./TeamCrest";

function slugifyName(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function playerInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

function positionBadge(pos: string | null | undefined): string {
  const p = (pos ?? "").toUpperCase();
  if (p.includes("GK") || p.includes("GOAL")) return "GK";
  if (p.includes("DF") || p.includes("DEF")) return "DF";
  if (p.includes("FW") || p.includes("FOR") || p.includes("ST")) return "FW";
  if (p.includes("MF") || p.includes("MID")) return "MF";
  if (p.length >= 2) return p.slice(0, 2);
  return "—";
}

function profileRole(pos: string | null | undefined): string | undefined {
  return positionBadge(pos) === "GK" ? "GK" : undefined;
}

function matchPlayerLink(
  row: SbSquadPlayer,
  club: string,
  competition: string
): { path: string; state: PlayerProfileLinkState } {
  const linked = row.player?.isPublic ? row.player : null;
  const displayName = linked?.displayName ?? row.displayName;
  const position = row.position ?? linked?.positionPrimary ?? null;
  const slug = linked?.slug ?? slugifyName(displayName);
  return {
    path: `/player/${slug}`,
    state: {
      displayName,
      club,
      competition,
      role: profileRole(position),
    },
  };
}

type SquadGroups = {
  starters: SbSquadPlayer[];
  subs: SbSquadPlayer[];
  grouped: boolean;
};

function partitionSquad(team: SbTeamWithSquad, roster?: SbMatchdayRoster): SquadGroups {
  if (!roster || roster.xi.length === 0) {
    return { starters: team.squad, subs: [], grouped: false };
  }
  const xiIds = new Set(roster.xi.map((s) => s.squadId));
  const subIds = new Set(roster.subs.map((s) => s.squadId));
  const starters = team.squad.filter((s) => xiIds.has(s.id));
  const subs = team.squad.filter((s) => subIds.has(s.id));
  const unassigned = team.squad.filter((s) => !xiIds.has(s.id) && !subIds.has(s.id));
  return {
    starters,
    subs: [...subs, ...unassigned],
    grouped: true,
  };
}

function SquadPlayerCard({
  row,
  club,
  competition,
}: {
  row: SbSquadPlayer;
  club: string;
  competition: string;
}) {
  const link = matchPlayerLink(row, club, competition);
  const displayName = row.player?.displayName ?? row.displayName;
  const position = row.position ?? row.player?.positionPrimary ?? null;
  const badge = positionBadge(position);

  return (
    <li>
      <Link to={link.path} state={link.state} className="sbm-squad-player">
        <span className="sbm-squad-player__avatar" aria-hidden="true">
          {row.player?.playerPhotoUrl ? (
            <img src={row.player.playerPhotoUrl} alt="" loading="lazy" width={40} height={40} />
          ) : (
            playerInitials(displayName)
          )}
        </span>
        <div className="sbm-squad-player__body">
          <span className="sbm-squad-player__name">{displayName}</span>
          <span className="sbm-squad-player__meta">
            <span
              className={`sbm-squad-player__badge${
                badge !== "—" ? ` sbm-squad-player__badge--${badge.toLowerCase()}` : ""
              }`}
            >
              {badge}
            </span>
            {position && position !== badge ? (
              <span className="sbm-squad-player__pos-detail">{position}</span>
            ) : null}
          </span>
        </div>
        <span className="sbm-squad-player__number">{row.shirtNumber ?? "—"}</span>
        <span className="sbm-squad-player__arrow" aria-hidden="true">
          →
        </span>
      </Link>
    </li>
  );
}

function SquadList({
  title,
  players,
  club,
  competition,
}: {
  title: string;
  players: SbSquadPlayer[];
  club: string;
  competition: string;
}) {
  if (players.length === 0) return null;
  return (
    <div className="sbm-squad-section">
      <h4 className="sbm-squad-section__title">{title}</h4>
      <ol className="sbm-squad-list">
        {players.map((row) => (
          <SquadPlayerCard key={row.id} row={row} club={club} competition={competition} />
        ))}
      </ol>
    </div>
  );
}

export function MatchSquadPanel({
  team,
  competition,
  formation,
  matchdayRoster,
  side,
}: {
  team: SbTeamWithSquad;
  competition: string;
  formation?: string | null;
  matchdayRoster?: SbMatchdayRoster;
  side: "home" | "away";
}) {
  const { starters, subs, grouped } = partitionSquad(team, matchdayRoster);

  return (
    <article className={`sbm-squad-panel sbm-squad-panel--${side}`}>
      <header className="sbm-squad-panel__head">
        <TeamCrest team={team} size="sm" />
        <div className="sbm-squad-panel__id">
          <h3>
            <Link to={`/scoreboard/team/${team.id}`} className="sbm-squad-panel__team-link">
              {team.name}
            </Link>
          </h3>
          {formation ? <span className="sbm-squad-panel__formation">{formation}</span> : null}
        </div>
      </header>

      {team.squad.length === 0 ? (
        <div className="sbm-squad-empty">
          <p className="sbm-squad-empty__title">No squad published</p>
          <p>Match-day roster for this team will appear here once confirmed.</p>
        </div>
      ) : grouped ? (
        <>
          <SquadList title="Starting XI" players={starters} club={team.name} competition={competition} />
          <SquadList title="Substitutes" players={subs} club={team.name} competition={competition} />
        </>
      ) : (
        <SquadList title="Squad" players={starters} club={team.name} competition={competition} />
      )}
    </article>
  );
}

export function MatchSquadsSkeleton() {
  return (
    <div className="sbm-squad-grid" aria-busy="true" aria-label="Loading squads">
      {(["home", "away"] as const).map((side) => (
        <div key={side} className="sbm-squad-panel sbm-squad-panel--skeleton">
          <div className="sbm-squad-panel__head">
            <span className="dtp-skeleton" style={{ width: "2.5rem", height: "2.5rem", borderRadius: "var(--radius-sm)" }} />
            <span className="dtp-skeleton dtp-skeleton--line" style={{ width: "55%", height: "1.1rem" }} />
          </div>
          <div className="sbm-squad-list sbm-squad-list--skeleton">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="dtp-skeleton" style={{ height: "3.25rem", width: "100%", borderRadius: "var(--radius-md)" }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function MatchSquadsGrid({
  homeTeam,
  awayTeam,
  competition,
  stats,
}: {
  homeTeam: SbTeamWithSquad;
  awayTeam: SbTeamWithSquad;
  competition: string;
  stats: { matchdayRosters?: Record<string, SbMatchdayRoster>; spotter?: { formation?: { home: string; away: string } } } | null;
}) {
  const formation = stats?.spotter?.formation;
  const rosters = stats?.matchdayRosters;

  return (
    <div className="sbm-squad-grid">
      <MatchSquadPanel
        side="home"
        team={homeTeam}
        competition={competition}
        formation={formation?.home}
        matchdayRoster={rosters?.[homeTeam.id]}
      />
      <MatchSquadPanel
        side="away"
        team={awayTeam}
        competition={competition}
        formation={formation?.away}
        matchdayRoster={rosters?.[awayTeam.id]}
      />
    </div>
  );
}
