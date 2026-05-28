export type MatchdayRosterSlotGuard = {
  squadId: string;
  role: "xi" | "sub";
};

export type MatchdayRosterGuard = {
  teamId: string;
  xi: MatchdayRosterSlotGuard[];
  subs: MatchdayRosterSlotGuard[];
};

export type MatchStatsForGuard = {
  matchdayRosters?: Record<string, MatchdayRosterGuard>;
  spotter?: { lineupsLocked?: boolean };
};

const MIN_XI = 11;
const MIN_BENCH = 1;

export function rosterIsComplete(roster: MatchdayRosterGuard | undefined): boolean {
  if (!roster) return false;
  return roster.xi.length === MIN_XI && roster.subs.length >= MIN_BENCH;
}

export function assertMatchReadyForLiveEvents(
  stats: MatchStatsForGuard | null | undefined,
  homeTeamId: string,
  awayTeamId: string
): { ok: true } | { ok: false; reason: string } {
  const spotter = stats?.spotter;
  if (!spotter?.lineupsLocked) {
    return {
      ok: false,
      reason:
        "Lineups are not locked. Save matchday rosters in admin and lock lineups on the spotter tablet.",
    };
  }

  const rosters = stats?.matchdayRosters ?? {};
  const home = rosters[homeTeamId];
  const away = rosters[awayTeamId];

  if (!rosterIsComplete(home)) {
    return {
      ok: false,
      reason: "Home team matchday roster incomplete (need 11 starters and at least 1 substitute).",
    };
  }
  if (!rosterIsComplete(away)) {
    return {
      ok: false,
      reason: "Away team matchday roster incomplete (need 11 starters and at least 1 substitute).",
    };
  }

  return { ok: true };
}

export type RosterTeamStatus = {
  teamId: string;
  xiCount: number;
  subsCount: number;
  complete: boolean;
};

export type RosterReadiness = {
  lineupsLocked: boolean;
  home: RosterTeamStatus;
  away: RosterTeamStatus;
  readyForLive: boolean;
};

export function getRosterReadiness(
  stats: MatchStatsForGuard | null | undefined,
  homeTeamId: string,
  awayTeamId: string
): RosterReadiness {
  const rosters = stats?.matchdayRosters ?? {};
  const homeRoster = rosters[homeTeamId];
  const awayRoster = rosters[awayTeamId];
  const home: RosterTeamStatus = {
    teamId: homeTeamId,
    xiCount: homeRoster?.xi.length ?? 0,
    subsCount: homeRoster?.subs.length ?? 0,
    complete: rosterIsComplete(homeRoster),
  };
  const away: RosterTeamStatus = {
    teamId: awayTeamId,
    xiCount: awayRoster?.xi.length ?? 0,
    subsCount: awayRoster?.subs.length ?? 0,
    complete: rosterIsComplete(awayRoster),
  };
  const lineupsLocked = stats?.spotter?.lineupsLocked ?? false;
  return {
    lineupsLocked,
    home,
    away,
    readyForLive: lineupsLocked && home.complete && away.complete,
  };
}
