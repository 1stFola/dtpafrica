import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
 * A practice match belongs to one recorder. They start their own, run it as
 * often as they like, and throw it away for a clean one — nobody else's
 * kick-off, clock or event log is ever in the way.
 */
export function AdminTrainingPage() {
  usePageTitle("Training");
  const navigate = useNavigate();
  const [fixtures, setFixtures] = useState<MatchStatsFixture[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Held while the confirm dialog is open, so a delete is never one tap. */
  const [confirming, setConfirming] = useState<MatchStatsFixture | null>(null);

  const load = useCallback(
    () =>
      // Training fixtures ignore the date window, so no range is needed.
      matchStatsApi
        .fixtures({})
        .then((rows) => setFixtures(rows.filter((m) => m.competition.isTraining)))
        .catch((e) => setError(String(e instanceof Error ? e.message : e))),
    []
  );

  useEffect(() => {
    void load().finally(() => setLoading(false));
  }, [load]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const { matchId } = await matchStatsApi.startTraining();
      // Straight into the console: starting one is always to use it now.
      navigate(`/admin/match-stats/${matchId}`);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setBusy(false);
    }
  };

  const remove = async (matchId: string) => {
    setBusy(true);
    setError(null);
    setConfirming(null);
    try {
      await matchStatsApi.deleteTraining(matchId);
      await load();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mcx-page">
      <header className="mcx-index-head">
        <h1>Training</h1>
        <p>
          Practice matches for learning the match recorder console. Nothing recorded here reaches
          the public site, and these stay available whatever the date. Halves are short so a full
          run — kick-off, added time, half-time, second half, submit — takes minutes.
        </p>
      </header>

      {error && <p className="mcx-error" role="alert">{error}</p>}

      <div className="mcx-train__actions">
        <button type="button" className="mcx-btn mcx-btn--primary" disabled={busy} onClick={start}>
          {busy ? "Working…" : "Start a practice match"}
        </button>
        <span className="muted">
          Yours alone — start as many as you like, and delete one to begin again from scratch.
        </span>
      </div>

      {loading ? (
        <p className="mcx-callout">Loading your practice matches…</p>
      ) : fixtures.length === 0 ? (
        <p className="mcx-callout">
          You have no practice matches yet. Start one above and it opens straight into the console.
        </p>
      ) : (
        <section className="mcx-fixtures">
          <div className="mcx-fixtures__head">
            <h2>Your practice matches</h2>
          </div>
          <ul className="mcx-fixtures__list">
            {fixtures.map((m) => (
              <li key={m.id} className="mcx-train__row">
                <Link to={`/admin/match-stats/${m.id}`} className="mcx-fixtures__item">
                  <span className="mcx-fixtures__time">{kickoffLabel(m.kickoffAt)}</span>
                  <span className="mcx-fixtures__teams">
                    {m.homeTeam.name} <span className="mcx-queue__vs">vs</span> {m.awayTeam.name}
                  </span>
                  <span className="mcx-fixtures__comp">{m.roundLabel ?? "Practice match"}</span>
                </Link>
                <button
                  type="button"
                  className="mcx-train__del"
                  disabled={busy}
                  onClick={() => setConfirming(m)}
                  aria-label={`Delete practice match ${m.homeTeam.name} versus ${m.awayTeam.name}`}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Deleting throws away a whole sheet, so it is always confirmed. */}
      {confirming && (
        <div className="mcx-prompt" role="dialog" aria-modal="true">
          <div className="mcx-prompt__card">
            <h3>Delete this practice match?</h3>
            <p className="muted">
              {confirming.homeTeam.name} vs {confirming.awayTeam.name} — everything recorded on it,
              statistics and events alike, is deleted with it. This cannot be undone.
            </p>
            <div className="mcx-prompt__actions">
              <button type="button" className="mcx-btn" onClick={() => setConfirming(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="mcx-btn mcx-btn--danger"
                onClick={() => void remove(confirming.id)}
              >
                Delete it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
