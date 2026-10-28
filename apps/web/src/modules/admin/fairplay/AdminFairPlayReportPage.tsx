import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fairplayApi, type FairPlayReport, type ReportEvidence } from "../../../api/fairplay";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { useAdminAuth } from "../AdminAuthContext";
import { Pill, formatDuration, formatWhen, short } from "../vision/vision-ui";
import { FAIRPLAY_EVIDENCE_READERS, RESULT_LABELS, matchTitle } from "./fairplay-access";

/**
 * The session report, printable (the browser's print to PDF) and downloadable as the JSON the
 * API returned. It shows what the venue recorded and the reviewer's own finding in fixed
 * words; it has no place for a ruling or a score.
 */
export function AdminFairPlayReportPage() {
  const { id = "" } = useParams();
  const [report, setReport] = useState<FairPlayReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  usePageTitle(report ? `FairPlay report · ${matchTitle(report.session.match)}` : "FairPlay report");

  useEffect(() => {
    fairplayApi.report(id).then(setReport, (e: Error) => setError(e.message));
  }, [id]);

  const download = useCallback(() => {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `fairplay-report-${report.session.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [report]);

  if (error) return <div className="fairplay-area vision-page"><p className="vision-panel vision-panel--error">{error}</p></div>;
  if (!report) return <div className="fairplay-area vision-page"><p className="muted">Loading…</p></div>;
  const m = report.session.match;

  return (
    <article className="fairplay-area vision-page fairplay-report">
      <p className="fairplay-no-print">
        <Link to="/admin/fairplay">FairPlay</Link>
        {report.session.matchStillExists && <> · <Link to={`/admin/fairplay/matches/${m.matchId}`}>Match</Link></>}
        {" · "}
        <button type="button" className="fairplay-btn" onClick={() => window.print()}>Print</button>{" "}
        <button type="button" className="fairplay-btn" onClick={download}>Download JSON</button>
      </p>
      <h1>FairPlay report: {matchTitle(m)}</h1>
      <p className="fairplay-report__notice">{report.notice}</p>
      <dl className="fairplay-report__facts">
        <dt>Competition</dt><dd>{m.competition}{m.roundLabel ? ` · ${m.roundLabel}` : ""}</dd>
        <dt>Kick-off</dt><dd>{formatWhen(m.kickoffAt)}{m.venue ? ` · ${m.venue}` : ""}</dd>
        <dt>Mode</dt><dd>{report.session.mode === "shadow" ? "Shadow review" : "Post-match evidence"} · {report.session.angleMode} angle</dd>
        <dt>Recorded at the venue</dt><dd>{formatWhen(report.session.edgeCreatedAt)} to {formatWhen(report.session.endedAt)}</dd>
        <dt>Report generated</dt><dd>{formatWhen(report.generatedAt)} · last sync {formatWhen(report.session.lastSyncAt)}</dd>
        {!report.session.matchStillExists && <><dt>Note</dt><dd>The fixture has since been deleted from ScoreBoard; the details above are as they were.</dd></>}
      </dl>
      <h2>Incidents ({report.incidents.length})</h2>
      {report.incidents.length === 0 && <p className="muted">No incidents were flagged.</p>}
      {report.incidents.map((inc, i) => (
        <section key={inc.id} className="fairplay-report__incident">
          <h3>
            {i + 1}. {inc.category}
            {inc.matchMinute !== null && ` · ${inc.matchMinute}'${inc.matchSecond !== null ? String(inc.matchSecond).padStart(2, "0") : ""}`}{" "}
            <span className="muted">({formatWhen(inc.eventUtc)}{inc.period ? `, ${inc.period.replace("_", " ")}` : ""})</span>
          </h3>
          {inc.scoreboardEvent && (
            <p className="muted">
              ScoreBoard event: {inc.scoreboardEvent.unresolved ? `sheet event ${short(inc.scoreboardEvent.sheetEventId)} (not yet on the approved sheet)` : `${inc.scoreboardEvent.type} at ${inc.scoreboardEvent.minute}'`}
            </p>
          )}
          {inc.finding ? (
            <>
              <p><strong>Finding:</strong> {inc.finding.statement ?? (inc.finding.result ? RESULT_LABELS[inc.finding.result] : "—")}</p>
              {inc.finding.onFieldDecision && <p><strong>On-field decision, as recorded:</strong> {inc.finding.onFieldDecision}</p>}
              {inc.finding.factualNotes && <p><strong>What the footage shows:</strong> {inc.finding.factualNotes}</p>}
              <p className="muted">Reviewed by {inc.finding.reviewer}, {formatWhen(inc.finding.completedAt)} · {inc.finding.authorityMode} review</p>
            </>
          ) : (
            <p><Pill tone="warn">{inc.state === "flagged" ? "Not reviewed" : inc.state === "reviewing" ? "Under review" : inc.state}</Pill></p>
          )}
          {inc.note && <p className="muted">Operator's note: {inc.note}</p>}
          {inc.evidence.length > 0 && <EvidenceTable rows={inc.evidence} />}
        </section>
      ))}
      <p className="muted fairplay-report__foot">Session {report.session.id} · {report.schema}</p>
    </article>
  );
}

function EvidenceTable({ rows }: { rows: ReportEvidence[] }) {
  const { hasPermission } = useAdminAuth();
  const canRead = hasPermission(FAIRPLAY_EVIDENCE_READERS);
  const [error, setError] = useState<string | null>(null);

  const open = async (ev: ReportEvidence, kind: "clip" | "manifest") => {
    setError(null);
    try {
      const reason = kind === "clip" ? window.prompt("Why are you viewing this clip? (recorded in the audit log; optional)") ?? undefined : undefined;
      const { url } = await fairplayApi.readUrl(ev.id, kind, reason);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      {error && <p className="vision-panel vision-panel--error">{error}</p>}
      <table className="vision-table">
        <thead><tr><th>Evidence</th><th>Window</th><th>Coverage</th><th>SHA-256</th><th>Held</th><th className="fairplay-no-print" /></tr></thead>
        <tbody>
          {rows.map((ev) => (
            <tr key={ev.id}>
              <td>{ev.source}{ev.footageKind === "synthetic" && <> <Pill>synthetic</Pill></>}</td>
              <td>{formatWhen(ev.windowStartUtc)} · {formatDuration(ev.windowDurationMs)}</td>
              <td><Pill tone={ev.coverage === "full" ? "ok" : "warn"}>{ev.coverage}</Pill></td>
              <td><code title={ev.sha256}>{short(ev.sha256, 16)}</code></td>
              <td>
                {!ev.released ? <Pill tone="warn">withheld: {ev.withheldBecause}</Pill>
                  : ev.stored === "stored" ? <>until {formatWhen(ev.deleteAfter)}</>
                  : ev.stored === "deleted" ? <>deleted {formatWhen(ev.deletedAt)}</> : <Pill tone="muted">not uploaded yet</Pill>}
              </td>
              <td className="fairplay-no-print">
                {canRead && ev.released && ev.stored === "stored" && (
                  <>
                    <button type="button" className="fairplay-btn" onClick={() => void open(ev, "clip")}>Open clip</button>{" "}
                    <button type="button" className="fairplay-btn" onClick={() => void open(ev, "manifest")}>Manifest</button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
