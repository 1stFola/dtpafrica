import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { matchStatsApi, type IdleLockedRecording } from "../../../api/adminMatchStats";

/**
 * Live recordings the idle sweep stopped, and the one action that undoes it.
 *
 * A recording stops when its clock runs twenty minutes with no event filed. The broadcast
 * ends and the sheet refuses edits, so this panel is the only way back — which is why it
 * sits on the dashboard rather than behind a tab somebody has to know about.
 *
 * **It renders nothing when there is nothing stopped.** A dashboard that always carries an
 * empty panel teaches people to look past it, and this is the one that needs reading on the
 * day it appears.
 *
 * The note on release is required rather than optional. Releasing a lock leaves no other
 * trace of the judgement somebody made, and "the recorder was there all along, only tapping
 * tallies" is exactly the sentence the next person needs.
 */
export function StoppedRecordingsPanel() {
  const [rows, setRows] = useState<IdleLockedRecording[] | null>(null);
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    matchStatsApi
      .idleLocked()
      .then(setRows)
      /* A dashboard that cannot reach this endpoint should still render the rest of
         itself. An empty list and a silent failure look the same here, which is the
         right trade for a panel that is usually empty anyway. */
      .catch(() => setRows([]));

  useEffect(() => {
    void load();
  }, []);

  const release = async (matchId: string) => {
    const trimmed = note.trim();
    if (!trimmed) {
      setError("Say why you are releasing this recording.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await matchStatsApi.releaseIdleLock(matchId, trimmed);
      setOpenFor(null);
      setNote("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not release this recording.");
    } finally {
      setBusy(false);
    }
  };

  if (!rows?.length) return null;

  return (
    <article className="admin-sb-panel admin-sb-panel--alert">
      <header className="admin-sb-panel__head">
        <h2>
          Stopped recordings <span className="admin-sb-badge">{rows.length}</span>
        </h2>
        <p className="muted">
          These went twenty minutes with no event filed, so the live broadcast was ended and
          the sheet was locked. Releasing one lets the recorder carry on.
        </p>
      </header>

      <ul className="admin-sb-stopped-list">
        {rows.map((row) => (
          <li key={row.matchId} className="admin-sb-stopped">
            <div className="admin-sb-stopped__what">
              <strong>
                {row.homeTeam} v {row.awayTeam}
              </strong>
              <span className="muted">{row.competitionName}</span>
            </div>

            <div className="admin-sb-stopped__why">
              <span>
                quiet for <strong>{formatQuiet(row.quietMinutes)}</strong>
              </span>
              <span className="muted">
                {/* The distinction that decides what happened: a recording that stopped
                    mid-match is a recorder who left, while one that never filed anything
                    is a match nobody recorded at all. */}
                {row.lastEventAt ? "stopped mid-match" : "nothing was ever filed"}
                {row.recorderName ? ` · ${row.recorderName}` : " · no recorder named"}
              </span>
            </div>

            <div className="admin-sb-stopped__do">
              <Link to={`/admin/match-stats/${row.matchId}`} className="admin-link">
                Open console
              </Link>
              {openFor === row.matchId ? (
                <div className="admin-sb-stopped__release">
                  <label>
                    <span className="sr-only">Why are you releasing this recording?</span>
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Why release it?"
                      autoFocus
                    />
                  </label>
                  <button type="button" onClick={() => void release(row.matchId)} disabled={busy}>
                    {busy ? "Releasing…" : "Release"}
                  </button>
                  <button
                    type="button"
                    className="admin-link"
                    onClick={() => {
                      setOpenFor(null);
                      setNote("");
                      setError(null);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setOpenFor(row.matchId);
                    setNote("");
                    setError(null);
                  }}
                >
                  Release
                </button>
              )}
            </div>

            {openFor === row.matchId && error ? (
              <p className="admin-error" role="alert">
                {error}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </article>
  );
}

/** `20 minutes`, or `35 days` once a recording has been sitting for a month. */
function formatQuiet(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  if (minutes < 1440) {
    const hours = Math.floor(minutes / 60);
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  const days = Math.floor(minutes / 1440);
  return `${days} day${days === 1 ? "" : "s"}`;
}
