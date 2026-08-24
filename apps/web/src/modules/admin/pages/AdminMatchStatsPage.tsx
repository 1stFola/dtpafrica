import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  matchStatsApi,
  type MatchStatsFixture,
  type MatchStatsQueueItem,
} from "../../../api/adminMatchStats";
import { usePageTitle } from "../../../hooks/usePageTitle";

/** Fixtures worth offering a sheet for: recent enough to have been played,
 *  near enough ahead to be today's assignment. */
const WINDOW_BACK_DAYS = 7;
const WINDOW_FORWARD_DAYS = 2;

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

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

export function AdminMatchStatsPage() {
  usePageTitle("Match statistics");
  const [queue, setQueue] = useState<MatchStatsQueueItem[] | null>(null);
  const [fixtures, setFixtures] = useState<MatchStatsFixture[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);

    Promise.allSettled([
      matchStatsApi.queue(),
      /* Scoped endpoint, not the general fixtures calendar: contracted
         recorders have no `scoreboard.read`, and must only see their own
         competition. */
      matchStatsApi.fixtures({
        from: isoDaysFromNow(-WINDOW_BACK_DAYS),
        to: isoDaysFromNow(WINDOW_FORWARD_DAYS),
      }),
    ]).then(([queueR, fixturesR]) => {
      if (!active) return;
      // A recorder has no approve permission, so a 403 here is expected, not an
      // error worth showing them.
      setQueue(queueR.status === "fulfilled" ? queueR.value : null);
      if (fixturesR.status === "fulfilled") setFixtures(fixturesR.value);
      else setError(String(fixturesR.reason));
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, []);

  const visibleFixtures = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return fixtures;
    return fixtures.filter((m) =>
      [m.homeTeam.name, m.awayTeam.name, m.competition.name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [fixtures, search]);

  /* Training fixtures sit in their own section: their dates are arbitrary, so
     grouping them under "Recent & upcoming" only makes them hard to find. */
  const trainingFixtures = useMemo(
    () => visibleFixtures.filter((m) => m.competition.isTraining),
    [visibleFixtures]
  );
  const realFixtures = useMemo(
    () => visibleFixtures.filter((m) => !m.competition.isTraining),
    [visibleFixtures]
  );

  const fixtureRow = (m: MatchStatsFixture) => (
    <li key={m.id}>
      <Link to={`/admin/match-stats/${m.id}`} className="mcx-fixtures__item">
        <span className="mcx-fixtures__time">{kickoffLabel(m.kickoffAt)}</span>
        <span className="mcx-fixtures__teams">
          {m.homeTeam.name} <span className="mcx-queue__vs">vs</span> {m.awayTeam.name}
        </span>
        <span className="mcx-fixtures__comp">
          {m.competition.isTraining && <span className="mcx-training">Training</span>}
          {m.competition.name}
          {m.sheetStatus ? ` · sheet ${m.sheetStatus}` : ""}
          {m.recorderName ? ` · ${m.recorderName}` : ""}
        </span>
      </Link>
    </li>
  );

  return (
    <div className="mcx-page">
      <header className="mcx-index-head">
        <h1>Match statistics</h1>
        <p>
          Open a fixture to record statistics pitch-side, then submit the sheet for a supervisor to
          approve. Only approved sheets appear on the public site. Fixtures marked{" "}
          <span className="mcx-training">Training</span> are practice only and never reach the
          public site.
        </p>
      </header>

      {error && <p className="mcx-error" role="alert">{error}</p>}

      {queue && queue.length > 0 && (
        <section className="mcx-queue">
          <h2 className="mcx-queue__title">
            Awaiting your approval <span className="mcx-queue__count">{queue.length}</span>
          </h2>
          <ul className="mcx-queue__list">
            {queue.map((item) => (
              <li key={item.matchId}>
                <Link to={`/admin/match-stats/${item.matchId}`} className="mcx-queue__item">
                  <span className="mcx-queue__fixture">
                    {item.match.homeTeam.name} <span className="mcx-queue__vs">vs</span>{" "}
                    {item.match.awayTeam.name}
                  </span>
                  <span className="mcx-queue__meta">
                    {item.match.competition.name}
                    {item.recorderName ? ` · recorded by ${item.recorderName}` : ""}
                    {item.submittedAt
                      ? ` · submitted ${new Date(item.submittedAt).toLocaleString()}`
                      : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {queue && queue.length === 0 && (
        <p className="mcx-callout">No sheets are waiting on your approval.</p>
      )}

      {trainingFixtures.length > 0 && (
        <section className="mcx-fixtures">
          <div className="mcx-fixtures__head">
            <h2>
              <span className="mcx-training">Training</span> Practice fixtures
            </h2>
          </div>
          <p className="mcx-callout">
            Practice sheets for learning the console. Nothing recorded here reaches the public
            site, and they stay available whatever the date.
          </p>
          <ul className="mcx-fixtures__list">{trainingFixtures.map(fixtureRow)}</ul>
        </section>
      )}

      <section className="mcx-fixtures">
        <div className="mcx-fixtures__head">
          <h2>Recent &amp; upcoming fixtures</h2>
          <input
            type="search"
            className="mcx-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by team or competition"
            aria-label="Filter fixtures"
          />
        </div>

        {loading ? (
          <p className="mcx-callout">Loading fixtures…</p>
        ) : realFixtures.length === 0 ? (
          <p className="mcx-callout">
            No published fixtures in the last {WINDOW_BACK_DAYS} days or next {WINDOW_FORWARD_DAYS}.
          </p>
        ) : (
          <ul className="mcx-fixtures__list">{realFixtures.map(fixtureRow)}</ul>
        )}
      </section>
    </div>
  );
}
