/*
 * Phase 3: an incident's review, its evidence, its audit trail, the session's footage
 * rights, and the organiser's read-only view.
 *
 * Every change sends the version the console last saw. If someone else changed the incident
 * first, the Edge answers 409 and the panel reloads rather than overwriting their work.
 */

import { useCallback, useEffect, useState } from "react";
import {
  ApiError, download, get, patch, post, RESULTS, transition,
  type AuditEntry, type IncidentDetail, type IncidentWindows, type Me, type Report, type ReportSession, type Result,
  type Rights,
} from "./api";
import { clockLabel, signedMs, toMs } from "./time";

const CATEGORIES = ["goal", "penalty", "offside", "foul", "handball", "card", "goalkeeper", "other"];
const STATE_LABEL = { flagged: "Flagged", reviewing: "Under review", reviewed: "Reviewed", archived: "Archived" } as const;
const RESULT_LABEL: Record<Result, string> = {
  supports_original: "Footage supports the on-field decision",
  supports_alternative: "Footage supports a different decision",
  inconclusive: "Inconclusive",
  footage_unavailable: "Footage unavailable",
};

export const can = (me: Me, permission: string) => me.kind === "device" || me.permissions.includes(permission);
const short = (hash: string) => `${hash.slice(0, 12)}…`;
const problem = (err: unknown, fallback: string) =>
  err instanceof ApiError && err.status === 409
    ? `${err.message} — reloaded.`
    : err instanceof Error ? err.message : fallback;

export function IncidentPanel({ incidentId, windows, sources, me, say, onChanged }: {
  incidentId: string; windows: IncidentWindows | null; sources: string[]; me: Me; say: (t: string) => void;
  onChanged: () => Promise<void>;
}) {
  const [detail, setDetail] = useState<IncidentDetail | null>(null);
  const [trail, setTrail] = useState<AuditEntry[] | null>(null);

  const reload = useCallback(async () => {
    setDetail(await get<IncidentDetail>(`/edge/v1/incidents/${incidentId}`));
  }, [incidentId]);

  useEffect(() => {
    setDetail(null);
    setTrail(null);
    void reload();
  }, [reload]);

  // While a clip is being cut, look again every two seconds.
  const busy = detail?.jobs.some((j) => j.state === "queued" || j.state === "running") ?? false;
  useEffect(() => {
    if (!busy) return;
    const id = window.setInterval(() => void reload(), 2000);
    return () => window.clearInterval(id);
  }, [busy, reload]);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      say(done);
    } catch (err) {
      say(problem(err, "not done"));
    }
    await reload();
    await onChanged();
    if (trail) setTrail(await get<AuditEntry[]>(`/edge/v1/incidents/${incidentId}/audit`));
  };

  if (!detail) return <p className="fp-muted">Loading the incident…</p>;
  return (
    <div className="fp-editor">
      <h3>
        Incident ≈ {clockLabel(toMs(detail.event_utc))} UTC · v{detail.version}{" "}
        <span className={`fp-chip fp-state fp-state--${detail.state}`}>{STATE_LABEL[detail.state]}</span>
        {detail.reopened_count > 0 && <span className="fp-chip fp-chip--muted">reopened {detail.reopened_count}×</span>}
      </h3>
      <IncidentFields incident={detail} canEdit={can(me, "fairplay.incident.operate")} act={act} />
      {windows && <FootageTable windows={windows} />}
      <ReviewSection detail={detail} me={me} act={act} />
      <EvidenceSection detail={detail} sources={sources} me={me} act={act} say={say} />
      <details onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) void get<AuditEntry[]>(`/edge/v1/incidents/${incidentId}/audit`).then(setTrail); }}>
        <summary>Audit trail</summary>
        {trail === null ? <p className="fp-muted">Loading…</p> : <AuditList entries={trail} />}
      </details>
    </div>
  );
}

type Act = (fn: () => Promise<unknown>, done: string) => Promise<void>;

function IncidentFields({ incident, canEdit, act }: { incident: IncidentDetail; canEdit: boolean; act: Act }) {
  const editable = canEdit && (incident.state === "flagged" || incident.state === "reviewing");
  const [pre, setPre] = useState(incident.pre_roll_ms / 1000);
  const [postRoll, setPostRoll] = useState(incident.post_roll_ms / 1000);
  const [category, setCategory] = useState(incident.category);
  const [note, setNote] = useState(incident.note ?? "");
  const [player, setPlayer] = useState(incident.player_ref ?? "");

  useEffect(() => {
    setPre(incident.pre_roll_ms / 1000);
    setPostRoll(incident.post_roll_ms / 1000);
    setCategory(incident.category);
    setNote(incident.note ?? "");
    setPlayer(incident.player_ref ?? "");
  }, [incident.id, incident.version, incident.pre_roll_ms, incident.post_roll_ms, incident.category, incident.note, incident.player_ref]);

  const save = () => act(() => patch(`/edge/v1/incidents/${incident.id}`, {
    preRollMs: Math.round(pre * 1000), postRollMs: Math.round(postRoll * 1000), category, note,
    playerRef: player.trim() || undefined,
  }, incident.version), "Incident saved.");

  return (
    <fieldset className="fp-fieldset" disabled={!editable}>
      <legend>Details{!editable && incident.state !== "flagged" && incident.state !== "reviewing" ? " — locked: reopen to change" : ""}</legend>
      <p className="fp-muted fp-small">
        {incident.period ? `Period ${incident.period}` : "Period not set"}
        {incident.match_minute !== null ? ` · ${incident.match_minute}:${String(incident.match_second ?? 0).padStart(2, "0")}` : ""}
        {incident.sheet_event_id ? ` · ScoreBoard event ${incident.sheet_event_id}` : ""} · basis {incident.basis.replaceAll("_", " ")}
      </p>
      <div className="fp-row">
        <label>Pre-roll <input type="number" min={0} max={600} value={pre} onChange={(e) => setPre(Number(e.target.value))} /> s</label>
        <label>Post-roll <input type="number" min={0} max={600} value={postRoll} onChange={(e) => setPostRoll(Number(e.target.value))} /> s</label>
      </div>
      <label>Category <select value={category} onChange={(e) => setCategory(e.target.value)}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
      <label>Player (shirt or register id) <input value={player} maxLength={120} onChange={(e) => setPlayer(e.target.value)} /></label>
      <label>Note <textarea value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} /></label>
      <button className="fp-btn fp-btn--primary" onClick={() => void save()}>Save</button>
    </fieldset>
  );
}

function FootageTable({ windows }: { windows: IncidentWindows }) {
  return (
    <table className="fp-table">
      <caption>What each source shows for this incident</caption>
      <thead><tr><th>Source</th><th>Offset</th><th>State</th><th>Recorded</th></tr></thead>
      <tbody>{windows.perSource.map((w) => (
        <tr key={w.source}><td>{w.source}</td><td>{signedMs(w.offsetMs)} ± {w.uncertaintyMs}</td><td>{w.state.replaceAll("_", " ")}</td><td>{Math.round(w.coveredMs / 1000)} / {Math.round(w.durationMs / 1000)} s</td></tr>
      ))}</tbody>
    </table>
  );
}

function ReviewSection({ detail, me, act }: { detail: IncidentDetail; me: Me; act: Act }) {
  const mayReview = can(me, "fairplay.incident.review");
  const [result, setResult] = useState<Result>("inconclusive");
  const [notes, setNotes] = useState("");
  const [onField, setOnField] = useState("");
  const [cited, setCited] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const base = `/edge/v1/incidents/${detail.id}`;
  const current = detail.reviews.find((r) => r.id === detail.current_review_id) ?? null;
  const earlier = detail.reviews.filter((r) => r.state === "superseded");

  useEffect(() => {
    setNotes("");
    setOnField("");
    setCited([]);
    setReason("");
  }, [detail.id, detail.current_review_id]);

  return (
    <section className="fp-review" aria-label="Shadow review">
      <h4>Shadow review</h4>
      <p className="fp-muted fp-small">A record of what the footage shows, for afterwards. It does not reach the referee and changes no decision.</p>
      {detail.state === "flagged" && (
        mayReview
          ? <button className="fp-btn fp-btn--primary" onClick={() => void act(() => transition(`${base}/review/start`, detail.version), "Review started.")}>Start review</button>
          : <p className="fp-muted">Waiting for an assessor.</p>
      )}
      {detail.state === "reviewing" && current && (
        mayReview ? (
          <form className="fp-form" onSubmit={(e) => {
            e.preventDefault();
            void act(() => transition(`${base}/review/complete`, detail.version, {
              result, factualNotes: notes, onFieldDecision: onField.trim() || undefined, evidenceIds: cited,
            }), "Finding recorded.");
          }}>
            <label>On-field decision <input value={onField} maxLength={500} onChange={(e) => setOnField(e.target.value)} placeholder="e.g. free kick to the visitors" /></label>
            <fieldset className="fp-fieldset">
              <legend>Finding</legend>
              {RESULTS.map((r) => (
                <label key={r} className="fp-radio"><input type="radio" name="result" value={r} checked={result === r} onChange={() => setResult(r)} /> {RESULT_LABEL[r]}</label>
              ))}
            </fieldset>
            <label>Factual notes (what the footage shows) <textarea required minLength={3} maxLength={5000} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
            {detail.evidence.length > 0 && (
              <fieldset className="fp-fieldset">
                <legend>Evidence relied on</legend>
                {detail.evidence.map((ev) => (
                  <label key={ev.id} className="fp-radio">
                    <input type="checkbox" checked={cited.includes(ev.id)}
                           onChange={(e) => setCited(e.target.checked ? [...cited, ev.id] : cited.filter((x) => x !== ev.id))} />
                    {" "}{ev.source} · {short(ev.sha256)}
                  </label>
                ))}
              </fieldset>
            )}
            <button className="fp-btn fp-btn--primary" type="submit">Record finding</button>
          </form>
        ) : <p className="fp-muted">Under review by {current.reviewer_name}.</p>
      )}
      {(detail.state === "reviewed" || detail.state === "archived") && current && (
        <div className="fp-finding">
          <p><strong>{current.result ? RESULT_LABEL[current.result] : "—"}</strong> · {current.reviewer_name}, {current.completed_at ? clockLabel(toMs(current.completed_at)) : ""} UTC</p>
          {current.on_field_decision && <p className="fp-muted">On-field: {current.on_field_decision}</p>}
          <p className="fp-notes">{current.factual_notes}</p>
          {mayReview && (
            <div className="fp-row">
              {detail.state === "reviewed" && <button className="fp-btn" onClick={() => void act(() => transition(`${base}/archive`, detail.version), "Archived.")}>Archive</button>}
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason to reopen" aria-label="Reason to reopen" maxLength={1000} />
              <button className="fp-btn" disabled={reason.trim().length < 5}
                      onClick={() => void act(() => transition(`${base}/reopen`, detail.version, { reason }), "Reopened; the earlier finding is kept.")}>Reopen</button>
            </div>
          )}
        </div>
      )}
      {earlier.length > 0 && (
        <details>
          <summary>Earlier findings ({earlier.length}), kept unchanged</summary>
          <ul className="fp-list">{earlier.map((r) => (
            <li key={r.id}>{r.result ? RESULT_LABEL[r.result] : "—"} · {r.reviewer_name} · superseded: {r.superseded_reason}</li>
          ))}</ul>
        </details>
      )}
    </section>
  );
}

function EvidenceSection({ detail, sources, me, act, say }: {
  detail: IncidentDetail; sources: string[]; me: Me; act: Act; say: (t: string) => void;
}) {
  const [playing, setPlaying] = useState<string | null>(null);
  const gathering = detail.state === "flagged" || detail.state === "reviewing";
  const exporter = can(me, "fairplay.evidence.export");

  return (
    <section className="fp-evidence" aria-label="Evidence">
      <h4>Evidence</h4>
      <p className="fp-muted fp-small">
        Clips are cut on this Edge from the original recordings, without re-encoding, and only on request. Rights: {rightsLabel(detail.rights)}.
      </p>
      {gathering && can(me, "fairplay.incident.operate") && (
        <div className="fp-row">
          {sources.map((s) => (
            <button key={s} className="fp-btn" onClick={() => void act(() => post(`/edge/v1/incidents/${detail.id}/clips`, { source: s }), `Clip of ${s} requested.`)}>Make {s} clip</button>
          ))}
        </div>
      )}
      {detail.jobs.filter((j) => j.state !== "succeeded").map((j) => (
        <p key={j.id} className={j.state === "failed" ? "fp-warn" : "fp-muted"}>
          {j.source}: {j.state === "failed" ? `no clip — ${j.error_code?.replaceAll("_", " ")}: ${j.error}` : `${j.state}${j.error ? ` (${j.error})` : ""}`}
        </p>
      ))}
      {detail.evidence.length > 0 && (
        <table className="fp-table">
          <thead><tr><th>Source</th><th>Length</th><th>Coverage</th><th>SHA-256</th><th>State</th><th /></tr></thead>
          <tbody>{detail.evidence.map((ev) => (
            <tr key={ev.id}>
              <td>{ev.source}{ev.footage_kind === "synthetic" ? " (synthetic)" : ""}</td>
              <td>{ev.duration_ms ? `${(ev.duration_ms / 1000).toFixed(1)} s` : "—"}</td>
              <td className={ev.coverage === "partial" ? "fp-warn" : ""}>{ev.coverage === "full" ? "full" : `partial: ${Math.round(ev.covered_ms / 1000)} of ${Math.round(ev.window_duration_ms / 1000)} s`}</td>
              <td title={ev.sha256}><code>{short(ev.sha256)}</code></td>
              <td>{ev.state === "approved" ? `approved by ${ev.approved_name}` : "internal"}</td>
              <td className="fp-row">
                <button className="fp-btn" onClick={() => setPlaying(playing === ev.id ? null : ev.id)}>{playing === ev.id ? "Close" : "View"}</button>
                {exporter && ev.state !== "approved" && <button className="fp-btn" onClick={() => void act(() => post(`/edge/v1/evidence/${ev.id}/approve`), "Approved for release.")}>Approve</button>}
                {exporter && ev.state === "approved" && <button className="fp-btn" onClick={() => void download(`/edge/v1/evidence/${ev.id}/export`).then((sha) => say(`Exported. Package SHA-256 ${sha}.`), (err) => say(problem(err, "export refused")))}>Export</button>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {playing && <video className="fp-evidence__video" src={`/edge/v1/evidence/${playing}/file`} controls playsInline aria-label="Evidence clip" />}
      {!gathering && detail.evidence.length === 0 && <p className="fp-muted">No evidence was gathered for this incident.</p>}
    </section>
  );
}

function rightsLabel(r: Rights): string {
  if (r.footage_kind === "synthetic") return "synthetic test footage";
  if (r.status === "external_release_permitted") return `release permitted (${r.basis ?? "basis recorded"})`;
  if (r.status === "internal_review_only") return "internal review only";
  return "not recorded — nothing leaves this Edge";
}

function AuditList({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) return <p className="fp-muted">No entries.</p>;
  return (
    <ol className="fp-audit">{entries.map((e) => (
      <li key={e.seq}>
        <span className="fp-muted">#{e.seq} {clockLabel(toMs(e.at_utc))}</span> {e.actor_name} — {e.action.replace(".", " ").replaceAll("_", " ")}
        <code className="fp-small" title={e.entry_hash}> {e.entry_hash.slice(0, 8)}</code>
      </li>
    ))}</ol>
  );
}

// ── the session's footage rights ─────────────────────────────────────────

export function RightsPanel({ sessionId, me, say }: { sessionId: string; me: Me; say: (t: string) => void }) {
  const [view, setView] = useState<{ current: Rights; externalRelease: { allowed: boolean; reason: string } } | null>(null);
  const [form, setForm] = useState({ footageKind: "real", status: "not_recorded", minorsPresent: "unknown", basis: "", consentReference: "" });
  const reload = useCallback(async () => setView(await get(`/edge/v1/sessions/${sessionId}/rights`)), [sessionId]);
  useEffect(() => { void reload(); }, [reload]);

  const save = async () => {
    try {
      await post(`/edge/v1/sessions/${sessionId}/rights`, { ...form, basis: form.basis || undefined, consentReference: form.consentReference || undefined });
      say("Rights recorded.");
    } catch (err) {
      say(problem(err, "not recorded"));
    }
    await reload();
  };

  if (!view) return null;
  return (
    <section className="fp-panel fp-rights" aria-labelledby="rights-title">
      <h2 id="rights-title">Footage rights</h2>
      <p className={view.externalRelease.allowed ? "fp-ok" : "fp-warn"}>{view.externalRelease.allowed ? "Release possible: " : "Nothing leaves this Edge: "}{view.externalRelease.reason}</p>
      <p className="fp-muted fp-small">{rightsLabel(view.current)}{view.current.recorded_name ? ` · recorded by ${view.current.recorded_name}` : ""}</p>
      {can(me, "fairplay.edge.admin") && (
        <details>
          <summary>Record rights (admin)</summary>
          <div className="fp-form">
            <label>Footage <select value={form.footageKind} onChange={(e) => setForm({ ...form, footageKind: e.target.value })}><option value="real">real match</option><option value="synthetic">synthetic test feed</option></select></label>
            <label>Status <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="not_recorded">not recorded</option><option value="internal_review_only">internal review only</option><option value="external_release_permitted">external release permitted</option>
            </select></label>
            <label>Players may be minors <select value={form.minorsPresent} onChange={(e) => setForm({ ...form, minorsPresent: e.target.value })}><option>unknown</option><option>yes</option><option>no</option></select></label>
            <label>Basis (agreement, licence) <input value={form.basis} maxLength={500} onChange={(e) => setForm({ ...form, basis: e.target.value })} /></label>
            <label>Consent reference <input value={form.consentReference} maxLength={300} onChange={(e) => setForm({ ...form, consentReference: e.target.value })} /></label>
            <button className="fp-btn fp-btn--primary" onClick={() => void save()}>Record</button>
          </div>
        </details>
      )}
    </section>
  );
}

// ── organisers: approved evidence and findings, nothing else ─────────────

export function OrganiserView({ me, onSignedOut }: { me: Me; onSignedOut: () => void }) {
  const [sessions, setSessions] = useState<ReportSession[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  useEffect(() => { void get<ReportSession[]>("/edge/v1/report/sessions").then(setSessions); }, []);
  const open = async (id: string) => setReport(await get<Report>(`/edge/v1/report/sessions/${id}`));

  return (
    <div className="fp-app">
      <header className="fp-header">
        <div className="fp-brand"><span>FairPlay · organiser report</span></div>
        <div className="fp-status"><span className="fp-me">{me.name}</span><button className="fp-btn" onClick={onSignedOut}>Sign out</button></div>
      </header>
      <main className="fp-report">
        <label>Match <select onChange={(e) => e.target.value && void open(e.target.value)} defaultValue="">
          <option value="">— choose —</option>
          {sessions.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select></label>
        {report && (
          <>
            <p className="fp-banner-note">{report.note}</p>
            {report.incidents.length === 0 && <p className="fp-muted">No completed findings.</p>}
            {report.incidents.map((i) => (
              <article key={i.incidentId} className="fp-panel">
                <h3>{i.category} {i.matchMinute !== null ? `· ${i.matchMinute}'` : ""} {i.period ? `(period ${i.period})` : ""}</h3>
                {i.finding && <p><strong>{RESULT_LABEL[i.finding.result]}</strong> — {i.finding.factual_notes}</p>}
                {i.evidence.length === 0 && <p className="fp-muted">No evidence released for this incident.</p>}
                {i.evidence.map((ev) => (
                  <div key={ev.id}>
                    <button className="fp-btn" onClick={() => setPlaying(playing === ev.id ? null : ev.id)}>{playing === ev.id ? "Close" : `View ${ev.source}`}</button>
                    <code className="fp-small"> SHA-256 {short(ev.sha256)}</code>
                    {playing === ev.id && <video className="fp-evidence__video" src={`/edge/v1/evidence/${ev.id}/file`} controls playsInline />}
                  </div>
                ))}
              </article>
            ))}
          </>
        )}
      </main>
    </div>
  );
}
