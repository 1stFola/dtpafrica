export type RosterReadinessView = {
  lineupsLocked: boolean;
  home: { xiCount: number; subsCount: number; complete: boolean };
  away: { xiCount: number; subsCount: number; complete: boolean };
  readyForLive: boolean;
};

type Props = {
  readiness: RosterReadinessView | null | undefined;
  homeLabel?: string;
  awayLabel?: string;
  compact?: boolean;
};

function teamPill(
  label: string,
  xi: number,
  subs: number,
  complete: boolean
) {
  return (
    <span
      className={
        complete
          ? "admin-sb-roster-pill admin-sb-roster-pill--ok"
          : "admin-sb-roster-pill admin-sb-roster-pill--warn"
      }
      title={complete ? "Roster complete" : "Need 11 starters and at least 1 sub"}
    >
      <span className="admin-sb-roster-pill__team">{label}</span>
      <span className="admin-sb-roster-pill__counts">
        XI {xi}/11 · Subs {subs}
      </span>
    </span>
  );
}

export function RosterReadinessBar({
  readiness,
  homeLabel = "Home",
  awayLabel = "Away",
  compact = false,
}: Props) {
  if (!readiness) {
    return (
      <div className="admin-sb-readiness admin-sb-readiness--loading" aria-busy="true">
        <span className="admin-sb-skeleton admin-sb-skeleton--bar" />
      </div>
    );
  }

  return (
    <div
      className={`admin-sb-readiness ${compact ? "admin-sb-readiness--compact" : ""}`}
      role="status"
      aria-label="Matchday roster readiness"
    >
      <span
        className={
          readiness.lineupsLocked
            ? "admin-sb-lock-pill admin-sb-lock-pill--locked"
            : "admin-sb-lock-pill"
        }
      >
        {readiness.lineupsLocked ? "Lineups locked" : "Lineups open"}
      </span>
      {teamPill(homeLabel, readiness.home.xiCount, readiness.home.subsCount, readiness.home.complete)}
      {teamPill(awayLabel, readiness.away.xiCount, readiness.away.subsCount, readiness.away.complete)}
      <span
        className={
          readiness.readyForLive
            ? "admin-sb-ready-pill admin-sb-ready-pill--yes"
            : "admin-sb-ready-pill"
        }
      >
        {readiness.readyForLive ? "Ready for live events" : "Not ready for live events"}
      </span>
    </div>
  );
}
