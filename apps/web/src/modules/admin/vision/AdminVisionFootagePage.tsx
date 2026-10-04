import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchVisionAssets, fetchVisionPartners, queueVisionJob, type VisionAssetRow, type VisionPartner } from "../../../api/vision";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { useAdminAuth } from "../AdminAuthContext";
import { useAdminVisionContext } from "./AdminVisionLayout";
import { STAGES, canQueue, latestByType, nextStage, succeededTypes, type JobRow } from "./pipeline";
import { Panel, Pill, formatDuration, short, toneOfState, useAction } from "./vision-ui";

/**
 * Every copy under DTP control, across sources: where each is in the pipeline,
 * the one control that moves it on, and the screens that open on it.
 */
export function AdminVisionFootagePage() {
  usePageTitle("Footage");
  const { hasPermission } = useAdminAuth();
  const { refreshOverview } = useAdminVisionContext();
  const [assets, setAssets] = useState<VisionAssetRow[] | null>(null);
  const [partners, setPartners] = useState<VisionPartner[]>([]);
  const [partnerId, setPartnerId] = useState("");
  const [state, setState] = useState("");
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    const data = await fetchVisionAssets({ partnerId: partnerId || undefined, ingestState: state || undefined, q: q || undefined });
    setAssets(data.assets);
    await refreshOverview();
  }, [partnerId, q, refreshOverview, state]);
  const { busy, run, messages, setError } = useAction(load);

  useEffect(() => {
    fetchVisionPartners().then((d) => setPartners(d.partners)).catch(() => setPartners([]));
  }, []);
  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [load, setError]);

  const canRun = hasPermission("vision.jobs.run");
  const states = useMemo(() => [...new Set((assets ?? []).map((a) => a.ingestState))].sort(), [assets]);

  return (
    <div className="vision-page">
      {messages}
      <Panel title="Footage">
        <div className="vision-filters">
          <label>
            <span>Partner</span>
            <select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
              <option value="">All partners</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Ingest state</span>
            <select value={state} onChange={(e) => setState(e.target.value)}>
              <option value="">Any</option>
              {states.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Title</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="search source titles" />
          </label>
        </div>
        {assets === null ? (
          <p className="muted">Loading…</p>
        ) : assets.length === 0 ? (
          <p className="muted">
            No footage yet. Upload with <code className="vision-mono">pnpm --filter @dtp/api vision:upload -- --source &lt;id&gt; --file …</code> against a source that has analysis rights, or issue a partner upload link from the source.
          </p>
        ) : (
          <div className="admin-sb-table-wrap">
            <table className="vision-table">
              <thead>
                <tr>
                  <th scope="col">Source</th>
                  <th scope="col">Match</th>
                  <th scope="col">State</th>
                  <th scope="col">Media</th>
                  <th scope="col">Pipeline</th>
                  <th scope="col">Open</th>
                  {canRun && <th scope="col">Queue</th>}
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => {
                  const jobs: JobRow[] = a.stages.map((s) => ({ id: `${a.id}-${s.type}`, type: s.type, state: s.state, queuedAt: s.finishedAt ?? "", finishedAt: s.finishedAt, error: s.error }));
                  const latest = latestByType(jobs);
                  const done = succeededTypes(jobs);
                  const next = nextStage(jobs);
                  const hasProxy = a.hasProxy || done.has("transcode");
                  return (
                    <tr key={a.id}>
                      <td>
                        {a.sourceVideoRecord ? <Link to={`/admin/vision/sources/${a.sourceVideoRecord.id}`}>{a.sourceVideoRecord.title ?? "untitled"}</Link> : <span className="muted">no source</span>}
                        <div className="vision-sub muted">
                          {a.sourceVideoRecord?.partner.name ?? "—"} · <code className="vision-mono">{short(a.id)}</code>
                        </div>
                      </td>
                      <td>{a.sbMatch ? `${a.sbMatch.homeTeam.name} v ${a.sbMatch.awayTeam.name}` : <Pill tone="warn">not linked</Pill>}</td>
                      <td>
                        <Pill tone={toneOfState(a.ingestState)}>{a.ingestState}</Pill>
                        {a.ingestError && <div className="vision-warn vision-sub">{a.ingestError}</div>}
                      </td>
                      <td className="muted">
                        {a.videoCodec ?? "—"} · {a.width && a.height ? `${a.width}×${a.height}` : "—"} · {formatDuration(a.durationMs)}
                        {hasProxy && <div className="vision-sub">proxy ready</div>}
                      </td>
                      <td>
                        <div className="vision-stage-dots">
                          {STAGES.map((s) => {
                            const r = latest.get(s.type);
                            /* The state was the label's colour and a hover title. */
                            const tone = r ? toneOfState(r.state) : "none";
                            const glyph = { ok: "✓", warn: "…", bad: "✕", muted: "–", none: "–" }[tone];
                            return (
                              <span key={s.type} className={`vision-stage-dot vision-stage-dot--${r ? toneOfState(r.state) : "none"}`} title={`${s.label}: ${r?.state ?? "not run"}${r?.error ? ` — ${r.error}` : ""}`}>
                                {s.label} <span aria-hidden="true">{glyph}</span>
                                <span className="vision-visually-hidden">: {r?.state ?? "not run"}</span>
                              </span>
                            );
                          })}
                        </div>
                        <div className="vision-sub muted">
                          {a.counts.tracks} track(s) · {a.counts.cameraSegments} segment(s) · {a.counts.eventCandidates} event(s)
                        </div>
                      </td>
                      <td>
                        <div className="vision-asset__links">
                          <Link to={`/admin/vision/workstation/identity/${a.id}`} className={hasProxy ? "" : "vision-link--dim"}>
                            Identity review →
                          </Link>
                          <Link to={`/admin/vision/workstation/calibration/${a.id}`} className={hasProxy ? "" : "vision-link--dim"}>
                            Calibration →
                          </Link>
                          <Link to={`/admin/vision/events?asset=${a.id}`}>Events →</Link>
                        </div>
                      </td>
                      {canRun && (
                        <td>
                          {next ? (
                            <button type="button" disabled={busy || !canQueue(next, done)} onClick={() => run(`${next.label} queued on ${short(a.id)}.`, () => queueVisionJob({ type: next.type, videoAssetId: a.id }))}>
                              Queue {next.label.toLowerCase()}
                            </button>
                          ) : (
                            <span className="muted vision-sub">nothing to queue</span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="vision-footnote muted">
          The queue button offers the next stage in order; the source page offers any stage. Detect needs a GPU worker; the rest run on the CPU worker beside the API.
        </p>
      </Panel>
    </div>
  );
}
