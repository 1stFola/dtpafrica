import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  fairplayApi,
  type FairPlayCandidate,
  type FairPlayDevice,
  type FairPlaySession,
  type FairPlaySessionRow,
  type FairPlaySyncState,
} from "../../../api/fairplay";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { useAdminAuth } from "../AdminAuthContext";
import { Field, Panel, Pill, formatWhen, useAction } from "../vision/vision-ui";
import { FairPlayNotice } from "./AdminFairPlayApp";
import { FAIRPLAY_STAFF, PERMISSION_LABELS, matchTitle } from "./fairplay-access";

type Picked = Record<string, string[]>;

/**
 * ScoreBoard → Match → FairPlay: the sessions provisioned for one match, who may act in each
 * at the venue, the member's own matchday PIN, and what the Edge has synced.
 */
export function AdminFairPlayMatchPage() {
  const { matchId = "" } = useParams();
  const { hasPermission } = useAdminAuth();
  const manage = hasPermission("fairplay.session.manage");
  const [sessions, setSessions] = useState<FairPlaySessionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  usePageTitle(sessions[0] ? `FairPlay · ${matchTitle(sessions[0].match)}` : "FairPlay · Match");

  const load = useCallback(async () => {
    try {
      setSessions(await fairplayApi.sessions(matchId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [matchId]);
  useEffect(() => void load(), [load]);

  return (
    <div className="fairplay-area vision-page">
      <p><Link to="/admin/fairplay">FairPlay</Link> · <Link to="/admin/scoreboard/match-center">Match center</Link></p>
      <h1>{sessions[0] ? matchTitle(sessions[0].match) : "FairPlay for this match"}</h1>
      <FairPlayNotice />
      {error && <p className="vision-panel vision-panel--error">{error}</p>}
      {sessions.map((s) => <SessionPanel key={s.id} id={s.id} />)}
      {sessions.length === 0 && !manage && <p className="muted">No FairPlay session for this match.</p>}
      {manage && <NewSessionPanel matchId={matchId} onCreated={load} first={sessions.length === 0} />}
    </div>
  );
}

function NewSessionPanel({ matchId, onCreated, first }: { matchId: string; onCreated: () => Promise<void>; first: boolean }) {
  const [devices, setDevices] = useState<FairPlayDevice[]>([]);
  const [candidates, setCandidates] = useState<FairPlayCandidate[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [mode, setMode] = useState("shadow");
  const [picked, setPicked] = useState<Picked>({});
  const { busy, run, messages } = useAction(onCreated);

  useEffect(() => {
    void Promise.all([fairplayApi.devices(), fairplayApi.candidates(matchId)]).then(([d, c]) => {
      const paired = d.filter((x) => x.state === "paired");
      setDevices(paired);
      setDeviceId((cur) => cur || paired[0]?.id || "");
      setCandidates(c);
    }, () => undefined);
  }, [matchId]);

  return (
    <Panel title={first ? "Provision a session" : "Provision another session"}>
      {messages}
      {devices.length === 0 ? (
        <p className="muted">No paired Edge device. Add one on the FairPlay page and pair it at the venue first.</p>
      ) : (
        <form onSubmit={(e) => {
          e.preventDefault();
          const members = Object.entries(picked).filter(([, p]) => p.length).map(([adminUserId, permissions]) => ({ adminUserId, permissions }));
          void run("Session provisioned. Each member now sets their own matchday PIN here.",
            () => fairplayApi.createSession({ matchId, deviceId, mode, members }).then(() => setPicked({})));
        }}>
          <div className="fairplay-row">
            <Field label="Edge device">
              <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
                {devices.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
            </Field>
            <Field label="Mode" hint="V1 is shadow review or post-match evidence only.">
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="shadow">Shadow review</option>
                <option value="post_match">Post-match evidence</option>
              </select>
            </Field>
          </div>
          <MemberPicker candidates={candidates} picked={picked} onChange={setPicked} />
          <button type="submit" className="fairplay-btn" disabled={busy || !deviceId}>Provision session</button>
        </form>
      )}
    </Panel>
  );
}

function MemberPicker({ candidates, picked, onChange }: { candidates: FairPlayCandidate[]; picked: Picked; onChange: (p: Picked) => void }) {
  if (!candidates.length) return <p className="muted">No account with a FairPlay role is given this match's competition yet. Give the venue staff a FairPlay role and the competition in Settings → Users.</p>;
  const toggle = (user: string, perm: string) => {
    const now = picked[user] ?? [];
    onChange({ ...picked, [user]: now.includes(perm) ? now.filter((p) => p !== perm) : [...now, perm] });
  };
  return (
    <table className="vision-table">
      <thead><tr><th>Who may act at the venue</th><th>Permissions (never more than their account holds)</th></tr></thead>
      <tbody>
        {candidates.map((c) => (
          <tr key={c.id}>
            <td>{c.name ?? c.email}<br /><span className="muted">{c.email}</span></td>
            <td>
              {c.permissions.filter((p) => p in PERMISSION_LABELS).map((p) => (
                <label key={p} className="fairplay-check">
                  <input type="checkbox" checked={(picked[c.id] ?? []).includes(p)} onChange={() => toggle(c.id, p)} /> {PERMISSION_LABELS[p]}
                </label>
              ))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SessionPanel({ id }: { id: string }) {
  const { hasPermission } = useAdminAuth();
  const staff = hasPermission(FAIRPLAY_STAFF);
  const [session, setSession] = useState<FairPlaySession | null>(null);
  const [sync, setSync] = useState<FairPlaySyncState | null>(null);
  const [pin, setPin] = useState("");
  const load = useCallback(async () => {
    setSession(await fairplayApi.session(id));
    if (staff) setSync(await fairplayApi.syncState(id).catch(() => null));
  }, [id, staff]);
  const { busy, run, messages } = useAction(load);
  useEffect(() => void load().catch(() => undefined), [load]);
  if (!session) return null;
  const me = session.members?.find((m) => m.isMe);
  const breaks = sync?.auditChain.find((c) => c.status === "break")?.entries ?? 0;

  return (
    <Panel title={`${session.label} · ${session.mode === "shadow" ? "shadow review" : "post-match evidence"}`}
      actions={<Link to={`/admin/fairplay/sessions/${id}/report`} className="fairplay-btn">Report</Link>}>
      {messages}
      <p className="muted">
        Device {session.device?.label ?? "—"} · created {formatWhen(session.createdAt)} · opened at the venue {formatWhen(session.edgeCreatedAt)}
        {session.endedAt ? ` · ended ${formatWhen(session.endedAt)}` : ""} · last sync {formatWhen(session.lastSyncAt)}
      </p>
      {session.members && (
        <table className="vision-table">
          <thead><tr><th>Member</th><th>At the venue</th><th>Matchday PIN</th></tr></thead>
          <tbody>
            {session.members.map((m) => (
              <tr key={m.adminUserId}>
                <td>{m.name ?? m.email}{!m.active && <> <Pill tone="bad">disabled</Pill></>}</td>
                <td>{m.permissions.map((p) => PERMISSION_LABELS[p] ?? p).join(", ")}</td>
                <td>{m.pinSet ? <Pill tone="ok">set {formatWhen(m.pinSetAt)}</Pill> : <Pill tone="warn">not set: cannot sign in</Pill>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {me && (
        <form className="fairplay-row" onSubmit={(e) => {
          e.preventDefault();
          void run("Your matchday PIN is set. The Edge picks it up the next time it is online.", () => fairplayApi.setMyPin(id, pin).then(() => setPin("")));
        }}>
          <Field label="Your matchday PIN" hint="6 to 12 digits. Only you can set it; it is stored hashed and reaches the Edge in the signed bundle.">
            <input type="password" inputMode="numeric" autoComplete="new-password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} maxLength={12} />
          </Field>
          <button type="submit" className="fairplay-btn" disabled={busy || pin.length < 6}>Set PIN</button>
        </form>
      )}
      {sync && (
        <div className="fairplay-sync">
          <h3>From the venue</h3>
          <p>
            {Object.entries(sync.records).map(([k, n]) => `${n} ${k}`).join(" · ") || "Nothing synced yet."}
            {" · audit chain: "}
            {sync.auditChain.length === 0 ? "no entries yet" : breaks ? <Pill tone="bad">{breaks} break{breaks === 1 ? "" : "s"}</Pill>
              : <Pill tone="ok">intact to {Math.max(...sync.auditChain.map((c) => c.lastSeq ?? 0))}</Pill>}
          </p>
          {sync.refused.length > 0 && (
            <details>
              <summary>{sync.refused.length} item(s) refused from this device</summary>
              <ul>{sync.refused.map((r) => <li key={r.idempotencyKey}><code>{r.idempotencyKey}</code> {r.status}: {r.message}</li>)}</ul>
            </details>
          )}
        </div>
      )}
    </Panel>
  );
}
