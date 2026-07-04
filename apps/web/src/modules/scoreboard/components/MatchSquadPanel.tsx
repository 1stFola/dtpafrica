import { useState } from "react";
import { Link } from "react-router-dom";
import type { PlayerProfileLinkState } from "../../directopro/pages/PlayerProfilePage";
import type {
  SbMatchdayRoster,
  SbMatchSquadsResponse,
  SbSquadPlayer,
  SbTeamWithSquad,
} from "../../../api/scoreboard";
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
  return "";
}

function profileRole(pos: string | null | undefined): string | undefined {
  return positionBadge(pos) === "GK" ? "GK" : undefined;
}

function shortPlayerName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? "";
  return parts[parts.length - 1].length <= 7
    ? parts[parts.length - 1]
    : `${parts[0][0]}. ${parts[parts.length - 1]}`;
}

type PitchLine = "gk" | "df" | "mf" | "fw";

type FormationSlot = {
  key: string;
  line: PitchLine;
  x: number;
  y: number;
};

const FORMATION_LAYOUTS: Record<string, FormationSlot[]> = {
  "4-3-3": [
    { key: "gk", line: "gk", x: 50, y: 90 },
    { key: "lb", line: "df", x: 15, y: 70 },
    { key: "lcb", line: "df", x: 38, y: 73 },
    { key: "rcb", line: "df", x: 62, y: 73 },
    { key: "rb", line: "df", x: 85, y: 70 },
    { key: "dm", line: "mf", x: 50, y: 50 },
    { key: "lcm", line: "mf", x: 30, y: 40 },
    { key: "rcm", line: "mf", x: 70, y: 40 },
    { key: "lw", line: "fw", x: 20, y: 15 },
    { key: "cf", line: "fw", x: 50, y: 12 },
    { key: "rw", line: "fw", x: 80, y: 15 },
  ],
  "4-1-2-3": [
    { key: "gk", line: "gk", x: 50, y: 90 },
    { key: "lb", line: "df", x: 15, y: 70 },
    { key: "lcb", line: "df", x: 38, y: 73 },
    { key: "rcb", line: "df", x: 62, y: 73 },
    { key: "rb", line: "df", x: 85, y: 70 },
    { key: "dm", line: "mf", x: 50, y: 52 },
    { key: "lcm", line: "mf", x: 32, y: 39 },
    { key: "rcm", line: "mf", x: 68, y: 39 },
    { key: "lw", line: "fw", x: 20, y: 15 },
    { key: "cf", line: "fw", x: 50, y: 12 },
    { key: "rw", line: "fw", x: 80, y: 15 },
  ],
  "4-2-3-1": [
    { key: "gk", line: "gk", x: 50, y: 90 },
    { key: "lb", line: "df", x: 15, y: 70 },
    { key: "lcb", line: "df", x: 38, y: 73 },
    { key: "rcb", line: "df", x: 62, y: 73 },
    { key: "rb", line: "df", x: 85, y: 70 },
    { key: "ldm", line: "mf", x: 38, y: 53 },
    { key: "rdm", line: "mf", x: 62, y: 53 },
    { key: "lam", line: "mf", x: 25, y: 33 },
    { key: "am", line: "mf", x: 50, y: 30 },
    { key: "ram", line: "mf", x: 75, y: 33 },
    { key: "cf", line: "fw", x: 50, y: 12 },
  ],
  "4-4-2": [
    { key: "gk", line: "gk", x: 50, y: 90 },
    { key: "lb", line: "df", x: 15, y: 70 },
    { key: "lcb", line: "df", x: 38, y: 73 },
    { key: "rcb", line: "df", x: 62, y: 73 },
    { key: "rb", line: "df", x: 85, y: 70 },
    { key: "lm", line: "mf", x: 15, y: 42 },
    { key: "lcm", line: "mf", x: 38, y: 44 },
    { key: "rcm", line: "mf", x: 62, y: 44 },
    { key: "rm", line: "mf", x: 85, y: 42 },
    { key: "lcf", line: "fw", x: 38, y: 13 },
    { key: "rcf", line: "fw", x: 62, y: 13 },
  ],
  "3-5-2": [
    { key: "gk", line: "gk", x: 50, y: 90 },
    { key: "lcb", line: "df", x: 25, y: 73 },
    { key: "cb", line: "df", x: 50, y: 75 },
    { key: "rcb", line: "df", x: 75, y: 73 },
    { key: "lwb", line: "mf", x: 12, y: 47 },
    { key: "lcm", line: "mf", x: 34, y: 43 },
    { key: "cm", line: "mf", x: 50, y: 50 },
    { key: "rcm", line: "mf", x: 66, y: 43 },
    { key: "rwb", line: "mf", x: 88, y: 47 },
    { key: "lcf", line: "fw", x: 38, y: 13 },
    { key: "rcf", line: "fw", x: 62, y: 13 },
  ],
  "3-4-3": [
    { key: "gk", line: "gk", x: 50, y: 90 },
    { key: "lcb", line: "df", x: 25, y: 73 },
    { key: "cb", line: "df", x: 50, y: 75 },
    { key: "rcb", line: "df", x: 75, y: 73 },
    { key: "lm", line: "mf", x: 20, y: 43 },
    { key: "lcm", line: "mf", x: 40, y: 47 },
    { key: "rcm", line: "mf", x: 60, y: 47 },
    { key: "rm", line: "mf", x: 80, y: 43 },
    { key: "lw", line: "fw", x: 20, y: 15 },
    { key: "cf", line: "fw", x: 50, y: 12 },
    { key: "rw", line: "fw", x: 80, y: 15 },
  ],
  "5-3-2": [
    { key: "gk", line: "gk", x: 50, y: 90 },
    { key: "lwb", line: "df", x: 10, y: 69 },
    { key: "lcb", line: "df", x: 30, y: 73 },
    { key: "cb", line: "df", x: 50, y: 75 },
    { key: "rcb", line: "df", x: 70, y: 73 },
    { key: "rwb", line: "df", x: 90, y: 69 },
    { key: "lcm", line: "mf", x: 30, y: 43 },
    { key: "cm", line: "mf", x: 50, y: 49 },
    { key: "rcm", line: "mf", x: 70, y: 43 },
    { key: "lcf", line: "fw", x: 38, y: 13 },
    { key: "rcf", line: "fw", x: 62, y: 13 },
  ],
};

function normalizedPosition(row: SbSquadPlayer) {
  return `${row.position ?? ""} ${row.player?.positionPrimary ?? ""}`.toUpperCase();
}

function playerLine(row: SbSquadPlayer): PitchLine {
  const pos = normalizedPosition(row);
  if (pos.includes("GK") || pos.includes("GOAL")) return "gk";
  if (pos.includes("LW") || pos.includes("RW") || pos.includes("CF") || pos.includes("ST") || pos.includes("FW") || pos.includes("FOR")) return "fw";
  if (pos.includes("DM") || pos.includes("CM") || pos.includes("AM") || pos.includes("LM") || pos.includes("RM") || pos.includes("MF") || pos.includes("MID")) return "mf";
  if (pos.includes("LB") || pos.includes("RB") || pos.includes("LWB") || pos.includes("RWB") || pos.includes("CB") || pos.includes("DF") || pos.includes("DEF")) return "df";
  return "mf";
}

function slotPreferences(row: SbSquadPlayer): string[] {
  const pos = normalizedPosition(row);
  if (pos.includes("GK") || pos.includes("GOAL")) return ["gk"];
  if (pos.includes("LWB")) return ["lwb", "lb", "lm"];
  if (pos.includes("RWB")) return ["rwb", "rb", "rm"];
  if (pos.includes("LB")) return ["lb", "lwb", "lcb"];
  if (pos.includes("RB")) return ["rb", "rwb", "rcb"];
  if (pos.includes("CB")) return ["cb", "lcb", "rcb"];
  if (pos.includes("DF") || pos.includes("DEF")) return ["lcb", "rcb", "cb", "lb", "rb", "lwb", "rwb"];
  if (pos.includes("DM")) return ["dm", "ldm", "rdm", "cm", "lcm", "rcm"];
  if (pos.includes("AM")) return ["am", "lam", "ram", "lcm", "rcm", "cm"];
  if (pos.includes("CM")) return ["cm", "lcm", "rcm", "dm", "ldm", "rdm"];
  if (pos.includes("LM")) return ["lm", "lam", "lw", "lwb"];
  if (pos.includes("RM")) return ["rm", "ram", "rw", "rwb"];
  if (pos.includes("MF") || pos.includes("MID")) return ["cm", "lcm", "rcm", "dm", "ldm", "rdm", "lm", "rm", "am"];
  if (pos.includes("LW")) return ["lw", "lam", "lm"];
  if (pos.includes("RW")) return ["rw", "ram", "rm"];
  if (pos.includes("CF") || pos.includes("ST")) return ["cf", "lcf", "rcf"];
  if (pos.includes("FW") || pos.includes("FOR")) return ["cf", "lcf", "rcf", "lw", "rw"];
  return [];
}

function formationSlots(formation?: string | null) {
  return FORMATION_LAYOUTS[formation ?? ""] ?? FORMATION_LAYOUTS["4-3-3"];
}

function toFullPitchY(halfY: number, topHalf: boolean) {
  const orientedHalfY = topHalf ? 100 - halfY : halfY;
  return topHalf ? orientedHalfY / 2 : 50 + orientedHalfY / 2;
}

function placeTeamOnPitch(players: SbSquadPlayer[], topHalf: boolean, formation?: string | null) {
  const slots = formationSlots(formation);
  const usedPlayers = new Set<string>();
  const usedSlots = new Set<number>();
  const placed: Array<{ player: SbSquadPlayer; x: number; y: number }> = [];

  for (const player of players.slice(0, 11)) {
    const preferences = slotPreferences(player);
    const slotIndex = slots.findIndex(
      (slot, index) => !usedSlots.has(index) && preferences.includes(slot.key)
    );
    if (slotIndex < 0) continue;
    const slot = slots[slotIndex];
    placed.push({ player, x: slot.x, y: toFullPitchY(slot.y, topHalf) });
    usedPlayers.add(player.id);
    usedSlots.add(slotIndex);
  }

  for (const line of ["gk", "df", "mf", "fw"] as PitchLine[]) {
    const linePlayers = players
      .slice(0, 11)
      .filter((player) => !usedPlayers.has(player.id) && playerLine(player) === line);
    const lineSlots = slots
      .map((slot, index) => ({ slot, index }))
      .filter(({ slot, index }) => slot.line === line && !usedSlots.has(index))
      .sort((a, b) => a.slot.x - b.slot.x);
    for (const player of linePlayers) {
      const next = lineSlots.shift();
      if (!next) break;
      placed.push({
        player,
        x: next.slot.x,
        y: toFullPitchY(next.slot.y, topHalf),
      });
      usedPlayers.add(player.id);
      usedSlots.add(next.index);
    }
  }

  const stillUnplaced = players.slice(0, 11).filter((player) => !usedPlayers.has(player.id));
  const openSlots = slots
    .map((slot, index) => ({ slot, index }))
    .filter(({ index }) => !usedSlots.has(index))
    .sort((a, b) => b.slot.y - a.slot.y || a.slot.x - b.slot.x);
  for (const player of stillUnplaced) {
    const next = openSlots.shift();
    if (!next) break;
    placed.push({
      player,
      x: next.slot.x,
      y: toFullPitchY(next.slot.y, topHalf),
    });
  }

  return placed;
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
                badge ? ` sbm-squad-player__badge--${badge.toLowerCase()}` : ""
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

function PitchPlayerNode({
  row,
  club,
  competition,
  x,
  y,
  side,
}: {
  row: SbSquadPlayer;
  club: string;
  competition: string;
  x: number;
  y: number;
  side: "top" | "bottom";
}) {
  const link = matchPlayerLink(row, club, competition);
  const displayName = row.player?.displayName ?? row.displayName;
  const position = row.position ?? row.player?.positionPrimary ?? null;
  const badge = positionBadge(position);
  return (
    <Link
      to={link.path}
      state={link.state}
      className={`sbm-pitch-player sbm-pitch-player--${side}`}
      style={{ left: `${x}%`, top: `${y}%` }}
      aria-label={`${displayName}${row.shirtNumber ? `, number ${row.shirtNumber}` : ""}`}
    >
      <span className="sbm-pitch-player__media">
        {row.player?.playerPhotoUrl ? (
          <img src={row.player.playerPhotoUrl} alt="" loading="lazy" />
        ) : (
          <span className="sbm-pitch-player__jersey">{row.shirtNumber ?? playerInitials(displayName)}</span>
        )}
      </span>
      {badge ? <span className="sbm-pitch-player__role">{badge}</span> : null}
      <span className="sbm-pitch-player__name">{shortPlayerName(displayName)}</span>
    </Link>
  );
}

function UnifiedMatchPitch({
  homeTeam,
  awayTeam,
  homePlayers,
  awayPlayers,
  homeFormation,
  awayFormation,
  competition,
}: {
  homeTeam: SbTeamWithSquad;
  awayTeam: SbTeamWithSquad;
  homePlayers: SbSquadPlayer[];
  awayPlayers: SbSquadPlayer[];
  homeFormation?: string | null;
  awayFormation?: string | null;
  competition: string;
}) {
  if (!homePlayers.length && !awayPlayers.length) return null;
  const homePlaced = placeTeamOnPitch(homePlayers, true, homeFormation);
  const awayPlaced = placeTeamOnPitch(awayPlayers, false, awayFormation);
  return (
    <section className="sbm-unified-lineup">
      <div className="sbm-unified-lineup__head">
        <div>
          <TeamCrest team={homeTeam} size="sm" />
          <span>{homeTeam.shortName ?? homeTeam.name}</span>
          <strong>{homeFormation ?? "4-3-3"}</strong>
        </div>
        <p>Starting XI</p>
        <div>
          <strong>{awayFormation ?? "4-3-3"}</strong>
          <span>{awayTeam.shortName ?? awayTeam.name}</span>
          <TeamCrest team={awayTeam} size="sm" />
        </div>
      </div>
      <div className="sbm-pitch-wrap sbm-pitch-wrap--unified">
        <div className="sbm-pitch sbm-pitch--unified" aria-label="Match starting lineups">
        <span className="sbm-pitch__line sbm-pitch__halfway" aria-hidden="true" />
        <span className="sbm-pitch__circle sbm-pitch__center-circle" aria-hidden="true" />
        <span className="sbm-pitch__box sbm-pitch__box--top" aria-hidden="true" />
        <span className="sbm-pitch__box sbm-pitch__box--bottom" aria-hidden="true" />
        <span className="sbm-pitch__six sbm-pitch__six--top" aria-hidden="true" />
        <span className="sbm-pitch__six sbm-pitch__six--bottom" aria-hidden="true" />
        {homePlaced.map(({ player, x, y }) => (
          <PitchPlayerNode
            key={`home-${player.id}`}
            row={player}
            club={homeTeam.name}
            competition={competition}
            x={x}
            y={y}
            side="top"
          />
        ))}
        {awayPlaced.map(({ player, x, y }) => (
          <PitchPlayerNode
            key={`away-${player.id}`}
            row={player}
            club={awayTeam.name}
            competition={competition}
            x={x}
            y={y}
            side="bottom"
          />
        ))}
        </div>
      </div>
    </section>
  );
}

export function MatchSquadPanel({
  team,
  competition,
  formation,
  matchdayRoster,
  publishedSquad,
  side,
}: {
  team: SbTeamWithSquad;
  competition: string;
  formation?: string | null;
  matchdayRoster?: SbMatchdayRoster;
  publishedSquad?: { starting: SbSquadPlayer[]; bench: SbSquadPlayer[] } | null;
  side: "home" | "away";
}) {
  const fromPublished = publishedSquad !== undefined;
  const groups = fromPublished
    ? {
        starters: publishedSquad?.starting ?? [],
        subs: publishedSquad?.bench ?? [],
        grouped: true,
      }
    : partitionSquad(team, matchdayRoster);
  const { starters, subs, grouped } = groups;
  const hasPublishedPlayers = starters.length > 0 || subs.length > 0;

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

      {(fromPublished && !hasPublishedPlayers) || (!fromPublished && team.squad.length === 0) ? (
        <div className="sbm-squad-empty">
          <p className="sbm-squad-empty__title">No squad published</p>
          <p>Match-day roster for this team will appear here once confirmed.</p>
        </div>
      ) : grouped ? (
        <>
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
  matchSquads,
}: {
  homeTeam: SbTeamWithSquad;
  awayTeam: SbTeamWithSquad;
  competition: string;
  stats: { matchdayRosters?: Record<string, SbMatchdayRoster>; spotter?: { formation?: { home: string; away: string } } } | null;
  matchSquads?: SbMatchSquadsResponse | null;
}) {
  const [activeTeamId, setActiveTeamId] = useState(homeTeam.id);
  const formation = stats?.spotter?.formation;
  const rosters = stats?.matchdayRosters;
  const homeSquad = matchSquads?.teams?.[homeTeam.id] ?? null;
  const awaySquad = matchSquads?.teams?.[awayTeam.id] ?? null;
  const homeGroups = matchSquads
    ? { starters: homeSquad?.starting ?? [], subs: homeSquad?.bench ?? [], grouped: true }
    : partitionSquad(homeTeam, rosters?.[homeTeam.id]);
  const awayGroups = matchSquads
    ? { starters: awaySquad?.starting ?? [], subs: awaySquad?.bench ?? [], grouped: true }
    : partitionSquad(awayTeam, rosters?.[awayTeam.id]);

  return (
    <div className="sbm-squad-shell">
      <div className="sbm-squad-toggle" role="tablist" aria-label="Squad team selector">
        {[
          { id: homeTeam.id, label: homeTeam.shortName ?? homeTeam.name },
          { id: awayTeam.id, label: awayTeam.shortName ?? awayTeam.name },
        ].map((team) => (
          <button
            key={team.id}
            type="button"
            className={team.id === activeTeamId ? "active" : ""}
            onClick={() => setActiveTeamId(team.id)}
          >
            {team.label}
          </button>
        ))}
      </div>
      <UnifiedMatchPitch
        homeTeam={homeTeam}
        awayTeam={awayTeam}
        homePlayers={homeGroups.starters}
        awayPlayers={awayGroups.starters}
        homeFormation={formation?.home}
        awayFormation={formation?.away}
        competition={competition}
      />
      <div className="sbm-squad-grid">
      <MatchSquadPanel
        side="home"
        team={homeTeam}
        competition={competition}
        formation={formation?.home}
        matchdayRoster={rosters?.[homeTeam.id]}
        publishedSquad={matchSquads ? homeSquad : undefined}
      />
      <MatchSquadPanel
        side="away"
        team={awayTeam}
        competition={competition}
        formation={formation?.away}
        matchdayRoster={rosters?.[awayTeam.id]}
        publishedSquad={matchSquads ? awaySquad : undefined}
      />
      </div>
      <div className="sbm-squad-mobile">
        {activeTeamId === homeTeam.id ? (
          <MatchSquadPanel
            side="home"
            team={homeTeam}
            competition={competition}
            formation={formation?.home}
            matchdayRoster={rosters?.[homeTeam.id]}
            publishedSquad={matchSquads ? homeSquad : undefined}
          />
        ) : (
          <MatchSquadPanel
            side="away"
            team={awayTeam}
            competition={competition}
            formation={formation?.away}
            matchdayRoster={rosters?.[awayTeam.id]}
            publishedSquad={matchSquads ? awaySquad : undefined}
          />
        )}
      </div>
    </div>
  );
}
