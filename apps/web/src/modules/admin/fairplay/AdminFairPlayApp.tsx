import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { fairplayApi, type FairPlayDevice, type FairPlayMe, type FairPlaySessionRow, type FairPlayUsage } from "../../../api/fairplay";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { useAdminAuth } from "../AdminAuthContext";
import { Field, Panel, Pill, formatWhen, short, useAction } from "../vision/vision-ui";
import { AdminFairPlayMatchPage } from "./AdminFairPlayMatchPage";
import { AdminFairPlayReportPage } from "./AdminFairPlayReportPage";
import { formatBytes, matchTitle } from "./fairplay-access";

/**
 * FairPlay's admin area, `/admin/fairplay` (ADR-0010): shadow-review sessions, Edge devices,
 * and the reports. Linked from the ScoreBoard match center as "FairPlay"; nothing of it
 * appears in the recorder's console. A FairPlay permission is checked before this mounts.
 */
export function AdminFairPlayApp() {
  return (
    <Routes>
      <Route index element={<AdminFairPlayOverviewPage />} />
      <Route path="matches/:matchId" element={<AdminFairPlayMatchPage />} />
      <Route path="sessions/:id/report" element={<AdminFairPlayReportPage />} />
      <Route path="*" element={<Navigate to="/admin/fairplay" replace />} />
    </Routes>
  );
}

export function FairPlayNotice() {
  return (
    <p className="vision-panel muted">
      Shadow review only. FairPlay findings are not decisions of the match officials, never change the match record, and are not a
      FIFA-authorised VAR or FVS review.
    </p>
  );
}

function AdminFairPlayOverviewPage() {
  usePageTitle("FairPlay");
  const { hasPermission } = useAdminAuth();
  const [me, setMe] = useState<FairPlayMe | null>(null);
  const [sessions, setSessions] = useState<FairPlaySessionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const manageDevices = hasPermission("fairplay.edge.admin");
  const seeDevices = hasPermission(["fairplay.edge.admin", "fairplay.session.manage"]);

  const load = useCallback(async () => {
    try {
      const [who, rows] = await Promise.all([fairplayApi.me(), fairplayApi.sessions()]);
      setMe(who);
      setSessions(rows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => void load(), [load]);

  return (
    <div className="fairplay-area vision-page">
      <h1>FairPlay</h1>
      <FairPlayNotice />
      {error && <p className="vision-panel vision-panel--error">{error}</p>}
      {me?.kind === "organiser" && <p className="muted">You can read the reports and released evidence of your competitions.</p>}
      <Panel title="Sessions">
        {sessions.length === 0 ? (
          <p className="muted">
            No sessions yet. A session is provisioned from a match: open the match in ScoreBoard → Match center and choose FairPlay.
          </p>
        ) : (
          <table className="vision-table">
            <thead>
              <tr><th>Match</th><th>Competition</th><th>Mode</th><th>Device</th><th>Incidents</th><th>Last sync</th><th /></tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td>{s.matchId ? <Link to={`/admin/fairplay/matches/${s.matchId}`}>{matchTitle(s.match)}</Link> : `${matchTitle(s.match)} (match deleted)`}</td>
                  <td>{s.match.competition}</td>
                  <td><Pill>{s.mode}</Pill></td>
                  <td>{s.device ?? "—"}</td>
                  <td>{s.incidents}</td>
                  <td>{formatWhen(s.lastSyncAt)}</td>
                  <td><Link to={`/admin/fairplay/sessions/${s.id}/report`}>Report</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      {seeDevices && <DevicesPanel canManage={manageDevices} />}
      {seeDevices && <UsagePanel />}
    </div>
  );
}

function DevicesPanel({ canManage }: { canManage: boolean }) {
  const [devices, setDevices] = useState<FairPlayDevice[]>([]);
  const [label, setLabel] = useState("");
  const [shown, setShown] = useState<{ label: string; bootstrapToken: string; bootstrapExpiresAt: string } | null>(null);
  const rePair = (d: FairPlayDevice) => {
    const reason = window.prompt(`Re-pair ${d.label}? Its current token stops working at once. Why (token expiring, may have leaked, machine back in use)?`);
    if (reason?.trim()) void run(`${d.label} is waiting to be paired again.`, async () => setShown(await fairplayApi.rePairDevice(d.id, reason.trim())));
  };
  const load = useCallback(async () => setDevices(await fairplayApi.devices()), []);
  const { busy, run, messages } = useAction(load);
  useEffect(() => void load().catch(() => undefined), [load]);

  return (
    <Panel title="Edge devices">
      {messages}
      {shown && (
        <div className="vision-panel vision-panel--ok">
          <p>
            Bootstrap token for <strong>{shown.label}</strong>. It is shown once and pairs one machine, until{" "}
            {formatWhen(shown.bootstrapExpiresAt)}. Save it to a file on the Edge, run <code>fairplay-edge pair</code>, then restart the
            Edge service so it uses the new device token.
          </p>
          <code className="fairplay-token">{shown.bootstrapToken}</code>
          <p><button type="button" className="fairplay-btn" onClick={() => setShown(null)}>I have saved it</button></p>
        </div>
      )}
      <table className="vision-table">
        <thead>
          <tr><th>Device</th><th>State</th><th>Edge id</th><th>Last seen</th><th>Token expires</th><th>Sessions</th><th /></tr>
        </thead>
        <tbody>
          {devices.map((d) => (
            <tr key={d.id}>
              <td>{d.label}</td>
              <td><Pill tone={d.state === "paired" ? "ok" : d.state === "retired" ? "bad" : "warn"}>{d.state.replace("_", " ")}</Pill></td>
              <td title={d.edgeDeviceId ?? ""}>{short(d.edgeDeviceId)}</td>
              <td>{formatWhen(d.lastSeenAt)}</td>
              <td>{d.state === "paired" ? <TokenExpiry at={d.tokenExpiresAt} /> : "—"}</td>
              <td>{d.sessions}</td>
              <td>
                {canManage && d.edgeDeviceId && (
                  <button type="button" className="fairplay-btn" disabled={busy} onClick={() => rePair(d)}>Re-pair</button>
                )}{" "}
                {canManage && d.state !== "retired" && (
                  <button type="button" className="fairplay-btn fairplay-btn--danger" disabled={busy}
                    onClick={() => window.confirm(`Retire ${d.label}? Its token stops working at once.`)
                      && run(`${d.label} retired.`, () => fairplayApi.retireDevice(d.id))}>
                    Retire
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {canManage && (
        <form className="fairplay-row" onSubmit={(e) => {
          e.preventDefault();
          void run("Device added.", async () => {
            setShown(await fairplayApi.createDevice(label));
            setLabel("");
          });
        }}>
          <Field label="New device"><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Edge laptop 1" maxLength={80} /></Field>
          <button type="submit" className="fairplay-btn" disabled={busy || !label.trim()}>Add device</button>
        </form>
      )}
    </Panel>
  );
}

/** A device token within 30 days of expiry is flagged: re-pair the device before it stops syncing. */
function TokenExpiry({ at }: { at: string }) {
  const days = Math.floor((new Date(at).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return <Pill tone="bad">expired</Pill>;
  return days <= 30 ? <Pill tone="warn">{`in ${days} days`}</Pill> : <>{formatWhen(at)}</>;
}

function UsagePanel() {
  const [usage, setUsage] = useState<FairPlayUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fairplayApi.usage().then(setUsage, (e: Error) => setError(e.message));
  }, []);
  return (
    <Panel title="Evidence storage">
      {error && <p className="vision-panel vision-panel--error">{error}</p>}
      {usage && (
        <>
          {usage.backend === "off" && <p className="muted">Storage is off: nothing is uploaded until the evidence bucket exists.</p>}
          <p>
            {usage.objects} objects, {formatBytes(usage.bytes)} held; {usage.deletedObjects} deleted under the {usage.retentionDays}-day rule.
            This month: {usage.thisMonth.uploads} uploads, {usage.thisMonth.reads} reads. Estimated cost ${usage.estimatedMonthlyUsd.toFixed(2)} a month.
          </p>
          <p className="muted">{usage.note}</p>
        </>
      )}
    </Panel>
  );
}
