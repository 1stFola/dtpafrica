import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { matchStatsApi, type MatchStatsFixture } from "../../../api/adminMatchStats";
import { usePageTitle } from "../../../hooks/usePageTitle";

function kickoffLabel(value: string | null): string {
  if (!value) return "Kickoff TBC";
  return new Date(value).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Practice fixtures, on their own page in the sidebar.
 *
 * Kept away from the real match statistics list so a training run is never
 * confused with a live game, and so the working list is not padded with
 * fixtures that exist only for teaching.
 */
export function AdminTrainingPage() {
  usePageTitle("Training");
  const [fixtures, setFixtures] = useState<MatchStatsFixture[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    // Training fixtures ignore the date window, so no range is needed.
    matchStatsApi
      .fixtures({})
      .then((rows) => active && setFixtures(rows.filter((m) => m.competition.isTraining)))
      .catch((e) => active && setError(String(e instanceof Error ? e.message : e)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, MatchStatsFixture[]>();
    for (const m of fixtures) {
      const list = map.get(m.competition.name);
      if (list) list.push(m);
      else map.set(m.competition.name, [m]);
    }
    return [...map.entries()];
  }, [fixtures]);

  return (
    <div className="mcx-page">
      <header className="mcx-index-head">
        <h1>Training</h1>
        <p>
          Practice fixtures for learning the match recorder console. Nothing recorded here reaches
          the public site, and these stay available whatever the date. Halves are short so a full
          run — kick-off, added time, half-time, second half, submit — takes minutes.
        </p>
      </header>

      {error && <p className="mcx-error" role="alert">{error}</p>}

      {loading ? (
        <p className="mcx-callout">Loading training fixtures…</p>
      ) : fixtures.length === 0 ? (
        <p className="mcx-callout">
          No training fixtures are set up yet. They arrive with the database seed.
        </p>
      ) : (
        grouped.map(([competition, rows]) => (
          <section className="mcx-fixtures" key={competition}>
            <div className="mcx-fixtures__head">
              <h2>{competition}</h2>
            </div>
            <ul className="mcx-fixtures__list">
              {rows.map((m) => (
                <li key={m.id}>
                  <Link to={`/admin/match-stats/${m.id}`} className="mcx-fixtures__item">
                    <span className="mcx-fixtures__time">{kickoffLabel(m.kickoffAt)}</span>
                    <span className="mcx-fixtures__teams">
                      {m.homeTeam.name} <span className="mcx-queue__vs">vs</span> {m.awayTeam.name}
                    </span>
                    {/* No sheet status or recorder name here: a practice sheet
                        belongs to whoever is training on it right now. */}
                    <span className="mcx-fixtures__comp">{m.roundLabel ?? "Practice match"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
