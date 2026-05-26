import type { SbMatchStats, SbTeamRef } from "../../../api/scoreboard";

const STAT_ROWS: Array<{
  key: keyof SbMatchStats;
  label: string;
  suffix?: string;
}> = [
  { key: "possession", label: "Possession", suffix: "%" },
  { key: "shots", label: "Shots" },
  { key: "shotsOnTarget", label: "On target" },
  { key: "corners", label: "Corners" },
  { key: "fouls", label: "Fouls" },
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
    return <p className="muted">Team stats have not been published for this match yet.</p>;
  }

  return (
    <div className="sb-stats-panel">
      <div className="sb-stats-panel__teams">
        <strong>{homeTeam.shortName ?? homeTeam.name}</strong>
        <strong>{awayTeam.shortName ?? awayTeam.name}</strong>
      </div>
      {rows.map((row) => {
        const home = row.value?.home ?? 0;
        const away = row.value?.away ?? 0;
        const total = Math.max(home + away, 1);
        const homePct = (home / total) * 100;

        return (
          <div key={row.key} className="sb-stat-row">
            <div className="sb-stat-row__values">
              <strong>{formatValue(home, row.suffix)}</strong>
              <span>{row.label}</span>
              <strong>{formatValue(away, row.suffix)}</strong>
            </div>
            <div className="sb-stat-row__bar" aria-hidden="true">
              <span style={{ width: `${homePct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
