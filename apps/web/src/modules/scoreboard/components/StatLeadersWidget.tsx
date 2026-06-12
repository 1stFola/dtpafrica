import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchStatLeaders,
  type StatLeaderMetric,
  type StatLeaderRow,
} from "../../../api/scoreboard";
import { isAbortError } from "../../../api/client";
import { TeamCrest } from "./TeamCrest";

const TABS: { id: StatLeaderMetric; label: string }[] = [
  { id: "goals", label: "Goals" },
  { id: "assists", label: "Assists" },
  { id: "yellow", label: "Yellow cards" },
  { id: "red", label: "Red cards" },
];

type StatLeadersWidgetProps = {
  competitionSlug: string;
  competitionLabel?: string;
};

function playerInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M9.29 6.71a1 1 0 0 0 0 1.41L13.17 12l-3.88 3.88a1 1 0 1 0 1.41 1.41l4.59-4.59a1 1 0 0 0 0-1.41L10.7 6.7a1 1 0 0 0-1.41.04Z"
      />
    </svg>
  );
}

function LeaderRow({
  leader,
  competitionLabel,
}: {
  leader: StatLeaderRow;
  competitionLabel?: string;
}) {
  return (
    <li className="sbc-scorer sbc-stat-leaders__row">
      <span className="sbc-scorer__rank">{leader.rank}</span>
      <span className="sbc-scorer__avatar" aria-hidden="true">
        {leader.photoUrl ? (
          <img src={leader.photoUrl} alt="" className="sbc-stat-leaders__photo" />
        ) : (
          playerInitials(leader.playerName)
        )}
      </span>
      <div className="sbc-scorer__id">
        <Link
          to={`/player/${leader.playerSlug}`}
          state={{
            displayName: leader.playerName,
            club: leader.team?.name,
            competition: competitionLabel,
          }}
          className="sbc-scorer__name"
        >
          {leader.playerName}
        </Link>
        {leader.team && (
          <span className="sbc-scorer__team">
            <TeamCrest
              team={{
                name: leader.team.name,
                shortName: leader.team.shortName,
                logoUrl: leader.team.logoUrl ?? null,
              }}
              size="sm"
            />
            {leader.team.name}
          </span>
        )}
      </div>
      <span className="sbc-stat-leaders__value">{leader.count}</span>
    </li>
  );
}

export function StatLeadersWidget({
  competitionSlug,
  competitionLabel,
}: StatLeadersWidgetProps) {
  const [metric, setMetric] = useState<StatLeaderMetric>("goals");
  const [leaders, setLeaders] = useState<StatLeaderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchStatLeaders(competitionSlug, metric, controller.signal)
      .then((res) => {
        if (!cancelled) setLeaders(res.leaders);
      })
      .catch((e) => {
        if (!cancelled && !isAbortError(e)) {
          setError(String(e));
          setLeaders([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [competitionSlug, metric]);

  return (
    <section className="sbc-stat-leaders" aria-labelledby="sbc-stat-leaders-title">
      <header className="sbc-stat-leaders__head">
        <h2 id="sbc-stat-leaders-title" className="sbc-stat-leaders__title">
          Stat Leaders
        </h2>
        <button
          type="button"
          className="sbc-stat-leaders__expand"
          aria-label="Expand stat leaders (coming soon)"
          disabled
        >
          <ChevronIcon />
        </button>
      </header>

      <div
        className="sbc-stat-leaders__tabs dbx-segmented"
        role="tablist"
        aria-label="Stat leader categories"
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={metric === tab.id}
            className={
              metric === tab.id ? "dbx-segmented__btn active" : "dbx-segmented__btn"
            }
            onClick={() => setMetric(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="sbc-stat-leaders__error" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <ol className="sbc-scorer-list sbc-stat-leaders__list" aria-busy="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <li key={i} className="sbc-scorer sbc-stat-leaders__row sbc-stat-leaders__row--skeleton">
              <span className="dtp-skeleton dtp-skeleton--line" style={{ width: "100%", height: "2.75rem" }} />
            </li>
          ))}
        </ol>
      ) : leaders.length === 0 ? (
        <div className="sbc-stat-leaders__empty dtp-empty-state">
          <p className="dtp-empty-state__title">No statistics recorded yet</p>
        </div>
      ) : (
        <ol className="sbc-scorer-list sbc-stat-leaders__list">
          {leaders.map((leader) => (
            <LeaderRow
              key={`${leader.playerSlug}-${leader.team?.id ?? "na"}`}
              leader={leader}
              competitionLabel={competitionLabel}
            />
          ))}
        </ol>
      )}
    </section>
  );
}
