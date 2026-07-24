import type { SbMatchStats, SbTeamRef } from "../../../api/scoreboard";

type HomeAwayStatKey =
  | "goals"
  | "possession"
  | "saves"
  | "shots"
  | "shotsOnTarget"
  | "shotsOffTarget"
  | "blockedShots"
  | "corners"
  | "fouls"
  | "offsides"
  | "yellowCards"
  | "redCards"
  | "penaltiesAwarded"
  | "xg";

const STAT_ROWS: Array<{
  key: HomeAwayStatKey;
  label: string;
  suffix?: string;
}> = [
  { key: "goals", label: "Goals" },
  { key: "possession", label: "Possession", suffix: "%" },
  { key: "saves", label: "Goalkeeper saves" },
  { key: "shots", label: "Shots" },
  { key: "shotsOnTarget", label: "On target" },
  { key: "shotsOffTarget", label: "Off target" },
  { key: "blockedShots", label: "Blocked shots" },
  { key: "corners", label: "Corners" },
  { key: "fouls", label: "Fouls" },
  { key: "offsides", label: "Offsides" },
  { key: "yellowCards", label: "Yellow cards" },
  { key: "redCards", label: "Red cards" },
  { key: "penaltiesAwarded", label: "Penalties awarded" },
  { key: "xg", label: "xG" },
];

function formatValue(value: number, suffix = "") {
  return Number.isInteger(value) ? `${value}${suffix}` : `${value.toFixed(1)}${suffix}`;
}

export function MatchStatsBars({
  stats,
  homeTeam,
  awayTeam,
}: {
  stats: SbMatchStats | null;
  homeTeam: SbTeamRef;
  awayTeam: SbTeamRef;
}) {
  const rows = STAT_ROWS.map((row) => ({ ...row, value: stats?.[row.key] })).filter(
    (row) => row.value && typeof row.value.home === "number" && typeof row.value.away === "number"
  );

  if (rows.length === 0) {
    return (
      <div className="dtp-empty-state">
        <p className="dtp-empty-state__title">Stats not published</p>
        <p>Team statistics will appear here once they are recorded for this match.</p>
      </div>
    );
  }

  return (
    <div className="sbm-stats">
      <div className="sbm-stats__teams">
        <div className="sbm-stats__team">
          <strong>{homeTeam.shortName ?? homeTeam.name}</strong>
        </div>
        <div className="sbm-stats__team sbm-stats__team--away">
          <strong>{awayTeam.shortName ?? awayTeam.name}</strong>
        </div>
      </div>
      {rows.map((row) => {
        const home = row.value?.home ?? 0;
        const away = row.value?.away ?? 0;
        const total = Math.max(home + away, 1);
        const homePct = (home / total) * 100;

        return (
          <div key={row.key} className="sbm-stat">
            <div className="sbm-stat__values">
              <strong className={home > away ? "sbm-stat__lead" : undefined}>
                {formatValue(home, row.suffix)}
              </strong>
              <span className="sbm-stat__label">{row.label}</span>
              <strong className={away > home ? "sbm-stat__lead" : undefined}>
                {formatValue(away, row.suffix)}
              </strong>
            </div>
            <div className="sbm-stat__bar" aria-hidden="true">
              <span className="sbm-stat__bar-home" style={{ width: `${homePct}%` }} />
              <span className="sbm-stat__bar-away" style={{ width: `${100 - homePct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
