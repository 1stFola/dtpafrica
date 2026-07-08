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

function hasPositionToken(pos: string, token: string): boolean {
  return new RegExp(`(^|[^A-Z])${token}([^A-Z]|$)`).test(pos);
}

function positionBadge(pos: string | null | undefined): string {
  const p = (pos ?? "").toUpperCase();
  if (hasPositionToken(p, "GK") || p.includes("GOAL")) return "GK";
  if (hasPositionToken(p, "LWB")) return "LWB";
  if (hasPositionToken(p, "RWB")) return "RWB";
  if (p.includes("LEFT BACK") || hasPositionToken(p, "LB")) return "LB";
  if (p.includes("RIGHT BACK") || hasPositionToken(p, "RB")) return "RB";
  if (p.includes("FULL BACK") || hasPositionToken(p, "FB")) return "FB";
  if (p.includes("LEFT WING") || p.includes("LWF") || hasPositionToken(p, "LW")) return "LW";
  if (p.includes("RIGHT WING") || p.includes("RWF") || hasPositionToken(p, "RW")) return "RW";
  if (p.includes("WINGER") || p.includes("WING")) return "WG";
  if (p.includes("DF") || p.includes("DEF")) return "DF";
  if (hasPositionToken(p, "FW") || p.includes("FOR") || hasPositionToken(p, "ST")) return "FW";
  if (hasPositionToken(p, "MF") || p.includes("MID")) return "MF";
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
  return `${row.position ?? ""} ${row.player?.positionPrimary ?? ""} ${row.player?.positionSecondary ?? ""}`.toUpperCase();
}

function isGoalkeeper(row: SbSquadPlayer) {
  const pos = normalizedPosition(row);
  return hasPositionToken(pos, "GK") || pos.includes("GOAL");
}

function playerLine(row: SbSquadPlayer): PitchLine {
  const pos = normalizedPosition(row);
  if (hasPositionToken(pos, "GK") || pos.includes("GOAL")) return "gk";
  if (pos.includes("LEFT BACK") || pos.includes("RIGHT BACK") || pos.includes("FULL BACK") || hasPositionToken(pos, "LB") || hasPositionToken(pos, "RB") || hasPositionToken(pos, "FB") || hasPositionToken(pos, "LWB") || hasPositionToken(pos, "RWB") || hasPositionToken(pos, "CB") || hasPositionToken(pos, "DF") || pos.includes("DEF")) return "df";
  if (hasPositionToken(pos, "DM") || hasPositionToken(pos, "CM") || hasPositionToken(pos, "AM") || hasPositionToken(pos, "LM") || hasPositionToken(pos, "RM") || hasPositionToken(pos, "MF") || pos.includes("MID")) return "mf";
  if (hasPositionToken(pos, "LW") || hasPositionToken(pos, "RW") || pos.includes("LWF") || pos.includes("RWF") || pos.includes("WINGER") || pos.includes("WING") || hasPositionToken(pos, "CF") || hasPositionToken(pos, "ST") || hasPositionToken(pos, "FW") || pos.includes("FOR")) return "fw";
  return "mf";
}

function slotPreferences(row: SbSquadPlayer): string[] {
  const pos = normalizedPosition(row);
  if (hasPositionToken(pos, "GK") || pos.includes("GOAL")) return ["gk"];
  if (hasPositionToken(pos, "LWB")) return ["lwb", "lb", "lm"];
  if (hasPositionToken(pos, "RWB")) return ["rwb", "rb", "rm"];
  if (pos.includes("LEFT BACK") || hasPositionToken(pos, "LB")) return ["lb", "lwb", "lcb"];
  if (pos.includes("RIGHT BACK") || hasPositionToken(pos, "RB")) return ["rb", "rwb", "rcb"];
  if (pos.includes("FULL BACK") || hasPositionToken(pos, "FB")) return ["rb", "lb", "rwb", "lwb"];
  if (hasPositionToken(pos, "CB")) return ["cb", "lcb", "rcb"];
  if (hasPositionToken(pos, "DF") || pos.includes("DEF")) return ["lcb", "rcb", "cb", "lb", "rb", "lwb", "rwb"];
  if (hasPositionToken(pos, "DM")) return ["dm", "ldm", "rdm", "cm", "lcm", "rcm"];
  if (hasPositionToken(pos, "AM")) return ["am", "lam", "ram", "lcm", "rcm", "cm"];
  if (hasPositionToken(pos, "CM")) return ["cm", "lcm", "rcm", "dm", "ldm", "rdm"];
  if (hasPositionToken(pos, "LM")) return ["lm", "lam", "lw", "lwb"];
  if (hasPositionToken(pos, "RM")) return ["rm", "ram", "rw", "rwb"];
  if (hasPositionToken(pos, "MF") || pos.includes("MID")) return ["cm", "lcm", "rcm", "dm", "ldm", "rdm", "lm", "rm", "am"];
  if (pos.includes("LEFT WING") || pos.includes("LWF") || hasPositionToken(pos, "LW")) return ["lw", "lam", "lm"];
  if (pos.includes("RIGHT WING") || pos.includes("RWF") || hasPositionToken(pos, "RW")) return ["rw", "ram", "rm"];
  if (pos.includes("WINGER") || pos.includes("WING")) return ["rw", "lw", "ram", "lam", "rm", "lm"];
  if (hasPositionToken(pos, "CF") || hasPositionToken(pos, "ST")) return ["cf", "lcf", "rcf"];
  if (hasPositionToken(pos, "FW") || pos.includes("FOR")) return ["cf", "lcf", "rcf", "lw", "rw"];
  return [];
}

function formationSlots(formation?: string | null) {
  return FORMATION_LAYOUTS[formation ?? ""] ?? FORMATION_LAYOUTS["4-3-3"];
}

function toFullPitchY(halfY: number, topHalf: boolean) {
  const orientedHalfY = topHalf ? 100 - halfY : halfY;
  return topHalf ? orientedHalfY / 2 : 50 + orientedHalfY / 2;
}

function slotFitScore(
  row: SbSquadPlayer,
  slot: FormationSlot,
  source: "starter" | "sub",
  emergency = false
) {
  const goalkeeper = isGoalkeeper(row);
  if (slot.line === "gk") {
    if (goalkeeper) return 1000 + (source === "starter" ? 25 : 0);
    return emergency ? 1 : Number.NEGATIVE_INFINITY;
  }
  if (goalkeeper) return emergency ? 1 : Number.NEGATIVE_INFINITY;

  const preferences = slotPreferences(row);
  const exact = preferences.indexOf(slot.key);
  let score = Number.NEGATIVE_INFINITY;
  if (exact >= 0) {
    score = 900 - exact * 25;
  } else if (playerLine(row) === slot.line) {
    score = 520;
  } else if (slot.line === "mf" && playerLine(row) === "fw") {
    score = 300;
  } else if (slot.line === "df" && playerLine(row) === "mf") {
    score = 260;
  } else if (slot.line === "fw" && playerLine(row) === "mf") {
    score = 240;
  } else if (emergency) {
    score = 1;
  }
  return score + (source === "starter" ? 25 : 0);
}

function uniquePitchPool(starters: SbSquadPlayer[], subs: SbSquadPlayer[]) {
  const seen = new Set<string>();
  const pool: Array<{ player: SbSquadPlayer; source: "starter" | "sub" }> = [];
  for (const [rows, source] of [
    [starters, "starter"],
    [subs, "sub"],
  ] as const) {
    for (const player of rows) {
      const key = player.playerId ?? player.id;
      if (seen.has(key)) continue;
      seen.add(key);
      pool.push({ player, source });
    }
  }
  return pool;
}

function placeTeamOnPitch(
  starters: SbSquadPlayer[],
  subs: SbSquadPlayer[],
  topHalf: boolean,
  formation?: string | null
) {
  const slots = formationSlots(formation);
  const pool = uniquePitchPool(starters, subs);
  const usedPlayers = new Set<string>();
  const placed: Array<{ player: SbSquadPlayer; x: number; y: number }> = [];

  for (const slot of slots) {
    const candidate = pool
      .filter(({ player }) => !usedPlayers.has(player.playerId ?? player.id))
      .map((entry) => ({ ...entry, score: slotFitScore(entry.player, slot, entry.source) }))
      .filter((entry) => Number.isFinite(entry.score))
      .sort((a, b) => b.score - a.score || a.player.displayName.localeCompare(b.player.displayName))[0];
    const emergencyCandidate =
      candidate ??
      pool
        .filter(({ player }) => !usedPlayers.has(player.playerId ?? player.id))
        .map((entry) => ({
          ...entry,
          score: slotFitScore(entry.player, slot, entry.source, true),
        }))
        .filter((entry) => Number.isFinite(entry.score))
        .sort((a, b) => b.score - a.score || a.player.displayName.localeCompare(b.player.displayName))[0];

    if (!emergencyCandidate) continue;
    placed.push({
      player: emergencyCandidate.player,
      x: slot.x,
      y: toFullPitchY(slot.y, topHalf),
    });
    usedPlayers.add(emergencyCandidate.player.playerId ?? emergencyCandidate.player.id);
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
  homeSubs,
  awaySubs,
  homeFormation,
  awayFormation,
  competition,
}: {
  homeTeam: SbTeamWithSquad;
  awayTeam: SbTeamWithSquad;
  homePlayers: SbSquadPlayer[];
  awayPlayers: SbSquadPlayer[];
  homeSubs: SbSquadPlayer[];
  awaySubs: SbSquadPlayer[];
  homeFormation?: string | null;
  awayFormation?: string | null;
  competition: string;
}) {
  if (!homePlayers.length && !awayPlayers.length && !homeSubs.length && !awaySubs.length) return null;
  const homePlaced = placeTeamOnPitch(homePlayers, homeSubs, true, homeFormation);
  const awayPlaced = placeTeamOnPitch(awayPlayers, awaySubs, false, awayFormation);
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
        homeSubs={homeGroups.subs}
        awaySubs={awayGroups.subs}
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
