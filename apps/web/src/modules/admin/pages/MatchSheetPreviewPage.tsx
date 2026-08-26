import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { EVENT_LABELS } from "../../../api/scoreboard";
import {
  matchStatsApi,
  type MatchStatsSheet,
  type SidePair,
  type SplitTally,
  type TallyValue,
} from "../../../api/adminMatchStats";
import { displayMinute } from "./useMatchClock";
import { usePageTitle } from "../../../hooks/usePageTitle";

function isSplit(value: TallyValue | undefined): value is SplitTally {
  return Boolean(value && "1st" in (value as SplitTally));
}

function totalOf(value: TallyValue | undefined): SidePair {
  if (!value) return { home: 0, away: 0 };
  if (!isSplit(value)) return value;
  return {
    home: value["1st"].home + value["2nd"].home,
    away: value["1st"].away + value["2nd"].away,
  };
}

function labelFor(type: string): string {
  return EVENT_LABELS[type] ?? type.replace(/_/g, " ");
}

/** Comparison bar, matching how the public Statistics tab presents the same figures. */
function Bar({ label, home, away }: { label: string; home: number; away: number }) {
  const total = home + away || 1;
  return (
    <div className="mpv-bar">
      <div className="mpv-bar__head">
        <span className="mpv-bar__home">{home}</span>
        <span className="mpv-bar__label">{label}</span>
        <span className="mpv-bar__away">{away}</span>
      </div>
      <div className="mpv-bar__track">
        <span className="mpv-bar__fill" style={{ width: `${(home / total) * 100}%` }} />
      </div>
    </div>
  );
}

/**
 * Read-only summary of a submitted sheet.
 *
 * Exists so a recorder can screenshot their own work at full time, before a
 * supervisor approves it. Nothing here is editable and nothing is published —
 * it is simply the sheet as it stands, laid out to photograph cleanly.
 */
export function MatchSheetPreviewPage() {
  const { matchId = "" } = useParams();
  const [sheet, setSheet] = useState<MatchStatsSheet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  usePageTitle(
    sheet ? `${sheet.match.homeTeam.name} vs ${sheet.match.awayTeam.name} — preview` : "Match preview"
  );

  useEffect(() => {
    if (!matchId) return;
    let active = true;
    matchStatsApi
      .open(matchId)
      .then((data) => active && setSheet(data))
      .catch((e) => active && setError(String(e instanceof Error ? e.message : e)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [matchId]);

  const totals = useMemo(() => {
    const out: Record<string, SidePair> = {};
    for (const def of sheet?.stats ?? []) out[def.key] = totalOf(sheet?.tallies[def.key]);
    const on = out.shotsOnTarget ?? { home: 0, away: 0 };
    const off = out.shotsOffTarget ?? { home: 0, away: 0 };
    out.shots = { home: on.home + off.home, away: on.away + off.away };
    return out;
  }, [sheet]);

  if (loading) return <div className="mpv-page mpv-page--center">Loading preview…</div>;
  if (!sheet) {
    return (
      <div className="mpv-page mpv-page--center">
        <p className="mcx-error">{error ?? "Preview unavailable."}</p>
      </div>
    );
  }

  const { match, events, derivedScore, status, audit } = sheet;
  const kickoff = match.kickoffAt ? new Date(match.kickoffAt) : null;
  const ordered = [...events].sort((a, b) => a.minute - b.minute);

  return (
    <div className="mpv-page">
      <div className="mpv-toolbar">
        <Link to={`/admin/match-stats/${matchId}`} className="mcx-backlink">← Back to the console</Link>
        <span className="mpv-hint">Screenshot this page for your own records.</span>
      </div>

      {/* The card is the screenshot: self-contained, no chrome, no controls. */}
      <article className="mpv-card">
        <header className="mpv-head">
          <p className="mpv-comp">
            {match.competition.name}
            {match.roundLabel ? ` · ${match.roundLabel}` : ""}
          </p>

          <div className="mpv-score">
            <span className="mpv-score__team">{match.homeTeam.name}</span>
            <span className="mpv-score__figure">
              {derivedScore.home}<span className="mpv-score__sep">–</span>{derivedScore.away}
            </span>
            <span className="mpv-score__team mpv-score__team--away">{match.awayTeam.name}</span>
          </div>

          <p className="mpv-meta">
            {kickoff
              ? kickoff.toLocaleString(undefined, {
                  weekday: "short",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "Kickoff TBC"}
            {match.venue ? ` · ${match.venue}` : ""}
          </p>
        </header>

        <section className="mpv-section">
          <h2 className="mpv-section__title">Match statistics</h2>
          {sheet.displayStats.map((def) => (
            <Bar
              key={def.key}
              label={def.label}
              home={totals[def.key]?.home ?? 0}
              away={totals[def.key]?.away ?? 0}
            />
          ))}
        </section>

        <section className="mpv-section">
          <h2 className="mpv-section__title">
            Event log <span className="mpv-count">{ordered.length}</span>
          </h2>
          {ordered.length === 0 ? (
            <p className="mpv-empty">No events were logged.</p>
          ) : (
            <ol className="mpv-events">
              {ordered.map((e) => (
                <li key={e.id} className={`mpv-event mpv-event--${e.side}`}>
                  <span className="mpv-event__min">{displayMinute(e.minute, e.addedMinute)}</span>
                  <span className="mpv-event__type">{labelFor(e.type)}</span>
                  <span className="mpv-event__who">
                    {e.side === "home" ? match.homeTeam.name : match.awayTeam.name}
                    {e.playerNumber ? ` · No. ${e.playerNumber}` : ""}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <footer className="mpv-foot">
          <span>
            Recorded by {audit.recorderName ?? "—"}
            {audit.submittedAt ? ` · submitted ${new Date(audit.submittedAt).toLocaleString()}` : ""}
          </span>
          <span className="mpv-states">
            Statistics &amp; events: <strong>{status}</strong>
          </span>
        </footer>
      </article>

      <p className="mpv-note">
        This is the sheet as submitted. Figures only reach the public site once a DTP supervisor
        approves them.
      </p>
    </div>
  );
}
