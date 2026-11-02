import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { matchStatsApi, type TotalStoppageRow } from "../../../api/adminMatchStats";

/**
 * Matches a recorder stopped outright, each waiting on a new date.
 *
 * The admin's notification of the incident, and where it gets settled. Like the stopped
 * recordings panel it sits on the dashboard and renders nothing when there is nothing to do,
 * so that on the day it appears it gets read.
 */
export function TotalStoppagesPanel() {
  const [rows, setRows] = useState<TotalStoppageRow[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { date: string; time: string }>>({});
  const [busyFor, setBusyFor] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const load = () =>
    matchStatsApi
      .totalStoppages()
      .then(setRows)
      /* As with the stopped recordings: a dashboard that cannot reach this should still
         render the rest of itself. */
      .catch(() => setRows([]));

  useEffect(() => {
    void load();
  }, []);

  const reschedule = async (matchId: string) => {
    const draft = drafts[matchId];
    if (!draft?.date || !draft?.time) {
      setErrors((e) => ({ ...e, [matchId]: "Choose the new date and kick-off time." }));
      return;
    }
    setBusyFor(matchId);
    setErrors((e) => ({ ...e, [matchId]: "" }));
    try {
      await matchStatsApi.rescheduleStoppage(matchId, draft.date, draft.time);
      await load();
    } catch (e) {
      setErrors((all) => ({
        ...all,
        [matchId]: e instanceof Error ? e.message : "Could not reschedule this match.",
      }));
    } finally {
      setBusyFor(null);
    }
  };

  if (!rows?.length) return null;

  return (
    <article className="admin-sb-panel admin-sb-panel--alert">
      <header className="admin-sb-panel__head">
        <h2>
          Matches stopped: reschedule needed <span className="admin-sb-badge">{rows.length}</span>
        </h2>
        <p className="muted">
          A recorder declared a total stoppage, so these were reset and show as postponed. What
          they had recorded is kept in each sheet's history. Give each one a new kick-off and it
          can be recorded again.
        </p>
      </header>

      <ul className="admin-sb-stopped-list">
        {rows.map((row) => {
          const draft = drafts[row.matchId] ?? { date: "", time: "" };
          const setDraft = (patch: Partial<typeof draft>) =>
            setDrafts((all) => ({ ...all, [row.matchId]: { ...draft, ...patch } }));
          return (
            <li key={row.matchId} className="admin-sb-stopped">
              <div className="admin-sb-stopped__what">
                <strong>
                  {row.homeTeam} v {row.awayTeam}
                </strong>
                <span className="muted">{row.competitionName}</span>
              </div>

              <div className="admin-sb-stopped__why">
                <span>
                  stopped{row.minute != null ? ` at ${row.minute}'` : ""}
                  {" · "}
                  <strong>
                    {row.score.home}–{row.score.away}
                  </strong>
                  {` · ${row.events} event${row.events === 1 ? "" : "s"} recorded`}
                </span>
                <span className="muted">
                  {new Date(row.at).toLocaleString()}
                  {row.byName ? ` · ${row.byName}` : ""}
                </span>
                <span>“{row.note}”</span>
              </div>

              <div className="admin-sb-stopped__do">
                <Link to={`/admin/match-stats/${row.matchId}`} className="admin-link">
                  Open console
                </Link>
                <div className="admin-sb-stopped__release">
                  <label>
                    <span className="sr-only">New match date</span>
                    <input
                      type="date"
                      value={draft.date}
                      onChange={(e) => setDraft({ date: e.target.value })}
                    />
                  </label>
                  <label>
                    <span className="sr-only">New kick-off time, West Africa Time</span>
                    <input
                      type="time"
                      value={draft.time}
                      onChange={(e) => setDraft({ time: e.target.value })}
                    />
                  </label>
                  <span className="muted">WAT</span>
                  <button
                    type="button"
                    onClick={() => void reschedule(row.matchId)}
                    disabled={busyFor === row.matchId}
                  >
                    {busyFor === row.matchId ? "Rescheduling…" : "Reschedule"}
                  </button>
                </div>
              </div>

              {errors[row.matchId] ? (
                <p className="admin-error" role="alert">
                  {errors[row.matchId]}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </article>
  );
}
