import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  fairplayApi, RELATIONSHIPS, type FairPlayRequest, type FairPlayRequestRow, type FairPlaySessionRow, type RequestEvidence,
} from "../../../api/fairplay";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { useAdminAuth } from "../AdminAuthContext";
import { Field, Panel, Pill, formatWhen, short, useAction } from "../vision/vision-ui";
import { FairPlayNotice } from "./AdminFairPlayApp";
import { FAIRPLAY_EVIDENCE_READERS, formatBytes, matchTitle, RESULT_LABELS } from "./fairplay-access";

/**
 * A player's or a parent's requests (decisions.md D11), `/admin/fairplay/requests`: what
 * FairPlay holds that names the player, exported as one document, and clips withdrawn. An
 * Edge admin's job; the API checks the permission and the competition on every request.
 * Players are found by the reference incidents record (a shirt number or a register id),
 * never by name.
 */

export function AdminFairPlayRequestsPage() {
  usePageTitle("FairPlay requests");
  const navigate = useNavigate();
  const [rows, setRows] = useState<FairPlayRequestRow[]>([]);
  const [sessions, setSessions] = useState<FairPlaySessionRow[]>([]);
  const [form, setForm] = useState({ competitionId: "", playerRef: "", requesterName: "", relationship: "parent_or_guardian", reference: "" });
  const load = useCallback(async () => {
    const [r, s] = await Promise.all([fairplayApi.requests(), fairplayApi.sessions()]);
    setRows(r);
    setSessions(s);
  }, []);
  const { busy, run, messages } = useAction(load);
  useEffect(() => void load().catch(() => undefined), [load]);
  // The competitions FairPlay has sessions in: a request about any other has nothing to find.
  const competitions = useMemo(() => [...new Map(sessions.map((s) => [s.competitionId, s.match.competition])).entries()], [sessions]);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  return (
    <div className="fairplay-area vision-page">
      <p><Link to="/admin/fairplay">← FairPlay</Link></p>
      <h1>Requests from players and parents</h1>
      <FairPlayNotice />
      <p className="muted">
        Someone asks what FairPlay holds about a player, or asks for a clip to be removed. Record who asked and how you checked who they
        are, find the player by the reference the incidents use (a shirt number with the side, or a register id), send them what is held,
        and withdraw any clip they ask to be removed. Withdrawing removes the cloud's copy at once and the Edge's the next time it connects.
      </p>
      {messages}
      <Panel title="Requests">
        {rows.length === 0 ? <p className="muted">No requests yet.</p> : (
          <table className="vision-table">
            <thead><tr><th>Received</th><th>Competition</th><th>Player</th><th>From</th><th>State</th><th>Withdrawn</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{formatWhen(r.createdAt)}</td>
                  <td>{competitions.find(([id]) => id === r.competitionId)?.[1] ?? short(r.competitionId)}</td>
                  <td>{r.playerRef}</td>
                  <td>{RELATIONSHIPS[r.relationship] ?? r.relationship}</td>
                  <td><Pill tone={r.state === "open" ? "warn" : r.state === "completed" ? "ok" : "muted"}>{r.state}</Pill></td>
                  <td>{r.withdrawals ?? 0}</td>
                  <td><Link to={`/admin/fairplay/requests/${r.id}`}>Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      <Panel title="New request">
        <form className="fairplay-form" onSubmit={(e) => {
          e.preventDefault();
          void run("Request recorded.", async () => {
            const created = await fairplayApi.createRequest({ ...form, reference: form.reference.trim() || undefined });
            navigate(`/admin/fairplay/requests/${created.id}`);
          });
        }}>
          <Field label="Competition">
            <select value={form.competitionId} onChange={set("competitionId")} required>
              <option value="">Choose…</option>
              {competitions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </Field>
          <Field label="Player reference" hint="As the incidents record it: “#7 home”, or a register id. Never a name.">
            <input value={form.playerRef} onChange={set("playerRef")} maxLength={60} required />
          </Field>
          <Field label="Who is asking" hint="Kept on this request only; never in the audit log.">
            <input value={form.requesterName} onChange={set("requesterName")} maxLength={120} required />
          </Field>
          <Field label="They are">
            <select value={form.relationship} onChange={set("relationship")}>
              {Object.entries(RELATIONSHIPS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="How it came, and how you checked who they are" hint="e.g. email of 30 Oct; ID seen by the club secretary">
            <input value={form.reference} onChange={set("reference")} maxLength={300} />
          </Field>
          <button type="submit" className="fairplay-btn" disabled={busy || !form.competitionId || !form.playerRef.trim() || form.requesterName.trim().length < 2}>
            Record the request
          </button>
        </form>
      </Panel>
    </div>
  );
}

export function AdminFairPlayRequestPage() {
  const { id = "" } = useParams();
  usePageTitle("FairPlay request");
  const { hasPermission } = useAdminAuth();
  const canRead = hasPermission(FAIRPLAY_EVIDENCE_READERS);
  const [request, setRequest] = useState<FairPlayRequest | null>(null);
  const load = useCallback(async () => setRequest(await fairplayApi.request(id)), [id]);
  const { busy, run, messages } = useAction(load);
  useEffect(() => void load().catch(() => undefined), [load]);
  const open = request?.state === "open";

  const downloadHeld = () => run("What is held was exported (recorded in the audit log).", async () => {
    const held = await fairplayApi.held(id);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(held, null, 2)], { type: "application/json" }));
    a.download = `fairplay-held-${id}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  const downloadClip = (ev: RequestEvidence) => run("Clip opened (recorded in the audit log).", async () => {
    const { url } = await fairplayApi.readUrl(ev.id, "clip", `request ${id}`);
    window.open(url, "_blank", "noopener");
  });
  const withdraw = (ev: RequestEvidence) => {
    const reason = window.prompt("Why is this clip withdrawn? (kept with the withdrawal; at least 5 characters, no names)", "the requester asks for it to be removed");
    if (!reason || reason.trim().length < 5) return;
    if (!window.confirm(`Withdraw the ${ev.source} clip ${short(ev.sha256, 12)}…? Its copy in the cloud is deleted now, and the Edge's when it next connects. This cannot be undone.`)) return;
    void run("Clip withdrawn.", () => fairplayApi.withdraw(id, ev.id, reason.trim()));
  };
  const close = (outcome: "completed" | "refused") => {
    const note = window.prompt(outcome === "completed" ? "What was done? (e.g. records sent on 30 Oct; one clip withdrawn)" : "Why is it refused?");
    if (note && note.trim().length >= 5) void run(`Request ${outcome}.`, () => fairplayApi.closeRequest(id, outcome, note.trim()));
  };

  if (!request) return <div className="fairplay-area vision-page">{messages}<p className="muted">Loading…</p></div>;
  return (
    <div className="fairplay-area vision-page">
      <p><Link to="/admin/fairplay/requests">← Requests</Link></p>
      <h1>Request about {request.playerRef}</h1>
      {messages}
      <Panel title="The request" actions={<Pill tone={open ? "warn" : request.state === "completed" ? "ok" : "muted"}>{request.state}</Pill>}>
        <p>
          From <strong>{request.requesterName}</strong> ({RELATIONSHIPS[request.relationship] ?? request.relationship}), received{" "}
          {formatWhen(request.createdAt)}{request.createdByEmail ? `, recorded by ${request.createdByEmail}` : ""}.
        </p>
        {request.reference && <p className="muted">{request.reference}</p>}
        {!open && <p>Closed {formatWhen(request.closedAt)} by {request.closedByEmail ?? "—"}: {request.outcomeNote}</p>}
        <p className="fairplay-row">
          <button type="button" className="fairplay-btn" disabled={busy} onClick={downloadHeld}>Download what is held (JSON)</button>
          {open && <button type="button" className="fairplay-btn" disabled={busy} onClick={() => close("completed")}>Mark completed</button>}
          {open && <button type="button" className="fairplay-btn fairplay-btn--danger" disabled={busy} onClick={() => close("refused")}>Refuse</button>}
        </p>
      </Panel>
      <Panel title={`Incidents naming ${request.playerRef}`}>
        {request.incidents.length === 0 ? <p className="muted">No incident in this competition records this player reference.</p> : (
          <table className="vision-table">
            <thead><tr><th>Match</th><th>When</th><th>Incident</th><th>Finding</th><th>Clips</th></tr></thead>
            <tbody>
              {request.incidents.map((i) => (
                <tr key={i.id}>
                  <td>{matchTitle(i.match)}</td>
                  <td>{i.matchMinute != null ? `${i.matchMinute}′` : formatWhen(i.eventUtc)}</td>
                  <td>{i.category} · {i.playerRef}</td>
                  <td>{i.finding?.result ? RESULT_LABELS[i.finding.result] ?? i.finding.result : "—"}</td>
                  <td>
                    {i.evidence.length === 0 ? "—" : i.evidence.map((ev) => (
                      <div key={ev.id} className="fairplay-row">
                        <span title={ev.sha256}>{ev.source} · {short(ev.sha256, 12)} · {formatBytes(ev.bytes)}</span>
                        {ev.withdrawn
                          ? <Pill tone="muted">{ev.withdrawn.edgeConfirmedAt ? "withdrawn" : "withdrawn; waiting for the Edge"}</Pill>
                          : <>
                              <Pill tone={ev.inCloud.some((o) => o.state === "stored") ? "ok" : "muted"}>
                                {ev.inCloud.some((o) => o.state === "stored") ? "in the cloud" : "on the Edge only"}
                              </Pill>
                              {canRead && ev.inCloud.some((o) => o.kind === "clip" && o.state === "stored") && (
                                <button type="button" className="fairplay-btn" disabled={busy} onClick={() => downloadClip(ev)}>Download</button>
                              )}
                              {open && <button type="button" className="fairplay-btn fairplay-btn--danger" disabled={busy} onClick={() => withdraw(ev)}>Withdraw</button>}
                            </>}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted">
          A clip only on the Edge is fetched there by an Edge admin. Full-match recordings are kept 14 days and are not exported here.
        </p>
      </Panel>
      <Panel title="Withdrawn under this request">
        {request.withdrawals.length === 0 ? <p className="muted">Nothing yet.</p> : (
          <table className="vision-table">
            <thead><tr><th>Clip</th><th>Withdrawn</th><th>Reason</th><th>On the Edge</th></tr></thead>
            <tbody>
              {request.withdrawals.map((w) => (
                <tr key={w.id}>
                  <td title={w.clipSha256}>{short(w.clipSha256, 12)} · {formatBytes(w.clipBytes)}</td>
                  <td>{formatWhen(w.withdrawnAt)} by {w.withdrawnBy ?? "—"}</td>
                  <td>{w.reason}</td>
                  <td>{w.edgeConfirmedAt ? `removed ${formatWhen(w.edgeConfirmedAt)}` : <Pill tone="warn">waiting for the Edge to connect</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
