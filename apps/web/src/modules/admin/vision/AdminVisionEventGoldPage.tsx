import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { EventGoldLabels } from "@dtp/vision-contracts";
import { createVisionEventGold, fetchVisionAssets, fetchVisionEventGold, fetchVisionEventGoldReport, fetchVisionEventGoldSets, fetchVisionReviewMedia, freezeVisionEventGold, reconcileVisionEventGold, scoreVisionEventGold, submitVisionEventGold,
  type EventBenchmarkInput, type VisionAssetRow, type VisionEventGoldDetail, type VisionEventGoldSet, type VisionEventScore, type VisionReviewMedia } from "../../../api/vision";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { Panel } from "./vision-ui";
import { formatClock } from "./annotation-time";
import { goldPlayheadSourceMs } from "./event-gold-time";
import { EventGoldEditor } from "./EventGoldEditor";
import { EventScoreReport } from "./EventScoreReport";
import { EventBenchmarkControl } from "./EventBenchmarkControl";

function LabelSummary({ labels, roster }: { labels: EventGoldLabels; roster: VisionEventGoldDetail["roster"] }) {
  return <div>
    <ul>{labels.events.map((event) => <li key={event.id}>{event.type.replace(/_/g, " ")} · {formatClock(event.startMs)}–{formatClock(event.endMs)} · {roster.find((slot) => slot.id === event.actorMatchSquadPlayerId)?.playerName ?? "Unknown actor"}</li>)}</ul>
    {labels.events.length === 0 && <p>No live events labelled.</p>}
    {labels.nonPlayWindows.map((range, index) => <p key={index}>{range.kind}: {formatClock(range.startMs)}–{formatClock(range.endMs)}</p>)}
  </div>;
}

export function AdminVisionEventGoldPage() {
  usePageTitle("Event gold benchmark");
  const [params, setParams] = useSearchParams();
  const id = params.get("reference") ?? "";
  const filterAsset = params.get("asset") ?? undefined;
  const [sets, setSets] = useState<VisionEventGoldSet[]>([]);
  const [assets, setAssets] = useState<VisionAssetRow[]>([]);
  const [assetId, setAssetId] = useState(params.get("asset") ?? "");
  const [reference, setReference] = useState<VisionEventGoldDetail | null>(null);
  const [media, setMedia] = useState<VisionReviewMedia | null>(null);
  const [report, setReport] = useState<VisionEventScore | null>(null);
  const [selection, setSelection] = useState<EventBenchmarkInput>({ scope: "all_current_candidates" });
  const [sourceMs, setSourceMs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const request = useRef(0);
  const listRequest = useRef(0);
  const load = useCallback(async () => { const serial = ++listRequest.current; const value = await fetchVisionEventGoldSets(filterAsset); if (serial === listRequest.current) setSets(value.sets); }, [filterAsset]);
  useEffect(() => { if (filterAsset) setAssetId(filterAsset); setSets([]); return () => { listRequest.current++; }; }, [filterAsset]);
  useEffect(() => { void load().catch((e) => setError(String(e))); fetchVisionAssets().then((value) => setAssets(value.assets.filter((asset) => asset.hasProxy))).catch((e) => setError(String(e))); }, [load]);
  useEffect(() => {
    const serial = ++request.current;
    setReference(null); setMedia(null); setReport(null); setError(null); setNotice(null);
    setSelection({ scope: "all_current_candidates" });
    if (id) fetchVisionEventGold(id).then(async (value) => {
      if (serial !== request.current) return;
      setReference(value); setSourceMs(value.windowStartMs);
      const proxy = await fetchVisionReviewMedia(value.videoAssetId);
      if (serial === request.current) setMedia(proxy);
    }).catch((e) => { if (serial === request.current) setError(String(e)); });
    return () => { request.current++; };
  }, [id]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(null); setNotice(null);
    try { await action(); await load(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const own = reference?.submissions.find((row) => row.reviewerId === reference.me);
  const assigned = reference && [reference.reviewerAId, reference.reviewerBId].includes(reference.me);
  const both = reference?.submissions.length === 2;
  return <div className="vision-page">
    {error && <p className="vision-panel vision-panel--error" role="alert">{error}</p>}
    {notice && <p className="vision-panel vision-panel--ok" role="status">{notice}</p>}
    <Panel title="Event gold references">
      <p className="muted">Two people label the same window independently. After both submit, reconcile disagreements and have the other reviewer approve the reference. Frozen references are immutable; scores never publish events.</p>
      <div className="vision-gold-reference-list">{sets.map((set) => <Link key={set.id} to={`/admin/vision/event-gold?reference=${set.id}`} className={id === set.id ? "vision-open-review" : ""}>{set.label} · {set.frozenAt ? "frozen" : "collecting"}</Link>)}{sets.length === 0 && <p>No references assigned to you yet.</p>}</div>
    </Panel>
    {!id && <Panel title="Create a reference window">
      <form className="vision-gold-create" onSubmit={(event) => {
        event.preventDefault(); const data = new FormData(event.currentTarget);
        void run(async () => { const set = await createVisionEventGold({ label: String(data.get("label")), videoAssetId: assetId, windowStartMs: Math.round(Number(data.get("start")) * 1000), windowEndMs: Math.round(Number(data.get("end")) * 1000), toleranceMs: Number(data.get("tolerance")), reviewerAEmail: String(data.get("reviewerA")), reviewerBEmail: String(data.get("reviewerB")) }); setParams({ reference: set.id }); });
      }}>
        <p>Creating a reference reserves this footage and its match from future training and validation. Choose held-out footage. This reservation also applies while reviewers are still labelling.</p>
        <label>Reference label<input name="label" required maxLength={120} placeholder="Competition · window · version" /></label>
        <label>Footage<select required value={assetId} onChange={(event) => setAssetId(event.target.value)}><option value="">Choose ready footage</option>{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.sourceVideoRecord?.title ?? asset.id}</option>)}</select></label>
        <label>Window start (source seconds)<input name="start" type="number" required min="0" step="0.001" defaultValue="0" /></label>
        <label>Window end (source seconds)<input name="end" key={`${assetId}:${assets.find((asset) => asset.id === assetId)?.durationMs ?? "loading"}`} type="number" required min="0.001" step="0.001" defaultValue={assetId ? Math.min(300, (assets.find((asset) => asset.id === assetId)?.durationMs ?? 0) / 1000) : undefined} /></label>
        <label>Temporal comparison tolerance (milliseconds)<input name="tolerance" type="number" required min="0" max="10000" defaultValue="500" /></label>
        <p className="muted">Tolerance is fixed when created and applies to both event boundaries. The suggested 500ms is a comparison setting, not a promotion or accuracy threshold. Maximum window: five minutes.</p>
        <label>First reviewer email<input name="reviewerA" type="email" required /></label><label>Second reviewer email<input name="reviewerB" type="email" required /></label>
        <button type="submit" disabled={busy}>Create held-out reference</button>
      </form>
    </Panel>}
    {id && !reference && !error && <p role="status">Loading reference…</p>}
    {reference && <>
      <Panel title={reference.label} actions={<button type="button" disabled={busy} onClick={() => void run(async () => { setReference(await fetchVisionEventGold(id)); })}>Refresh reference</button>}>
        <p>Window: {formatClock(reference.windowStartMs)}–{formatClock(reference.windowEndMs)} · tolerance {reference.toleranceMs}ms · {reference.submissions.length}/2 independent submissions · {reference.frozenAt ? "Frozen" : both ? "Ready to reconcile" : "Collecting"}</p>
        <p className="muted">This screen shows the review proxy without model or event overlays. Do not consult candidate proposals or the other person's labels while submitting your independent reference.</p>
        {media ? <video ref={video} className="vision-gold-video" controls src={media.url} onLoadedMetadata={(event) => { event.currentTarget.currentTime = Math.max(0, reference.windowStartMs - media.sourceOffsetMs) / 1000; }} onTimeUpdate={(event) => {
          setSourceMs(goldPlayheadSourceMs(event.currentTarget.currentTime * 1000, media, reference.windowEndMs));
        }} /> : <p>Loading review video…</p>}
        <p>Playhead in source footage: {formatClock(sourceMs)}</p>
        <Link to="/admin/vision/event-gold">All references / create another version</Link>
      </Panel>
      {!reference.frozenAt && assigned && !own && <Panel title="Independent submission">
        <EventGoldEditor key={`independent-${id}`} reference={reference} sourceMs={sourceMs} busy={busy} onSubmit={async (labels) => { await run(async () => { setReference(await submitVisionEventGold(id, labels)); setNotice("Your immutable submission was recorded."); }); }} />
      </Panel>}
      {own?.labels && <Panel title="Your submitted labels"><LabelSummary labels={own.labels} roster={reference.roster} /><p>Your submission is immutable. {both ? "Both reviewers have now submitted." : "The other reviewer's labels remain hidden until both have submitted."}</p></Panel>}
      {both && <Panel title="Independent labels and disagreement">
        {reference.submissions.filter((row) => row.reviewerId !== reference.me).map((row) => row.labels && <div key={row.id}><h3>Reviewer {row.reviewerId.slice(0, 8)}</h3><LabelSummary labels={row.labels} roster={reference.roster} /></div>)}
        {reference.disagreement && <EventScoreReport report={reference.disagreement} />}
        {reference.proposal ? <p>Non-play windows: {reference.proposal.nonPlayAgreement ? "reviewers agree" : "reviewers differ; resolve explicitly"}.</p> : <p>Propose a reconciliation and resolve non-play windows explicitly. Keep a written reason even if both submissions agree.</p>}
      </Panel>}
      {both && !reference.frozenAt && assigned && <Panel title="Reconcile and propose">
        <EventGoldEditor key={`reconcile-${id}-${reference.proposal?.id ?? "new"}`} reference={reference} initial={reference.proposal?.labels ?? own?.labels ?? undefined} sourceMs={sourceMs} busy={busy} reconciliation onSubmit={async (labels, reason) => { await run(async () => { setReference(await reconcileVisionEventGold(id, labels, reason)); setNotice("Reconciliation proposed. The other reviewer must approve it."); }); }} />
      </Panel>}
      {reference.proposal && <Panel title="Current reconciled reference"><LabelSummary labels={reference.proposal.labels} roster={reference.roster} /><p>Reason: {reference.proposal.reason}</p>
        {!reference.frozenAt && assigned && reference.proposal.proposedBy !== reference.me && <button type="button" disabled={busy} onClick={() => void run(async () => { setReference(await freezeVisionEventGold(id, reference.proposal!.id)); setNotice("Reference approved and frozen."); })}>Approve reconciliation and freeze</button>}
        {!reference.frozenAt && reference.proposal.proposedBy === reference.me && <p>The other assigned reviewer must approve this proposal.</p>}
      </Panel>}
      {reference.frozenAt && <Panel title="Score event candidates">
        <EventBenchmarkControl selection={selection} models={reference.benchmarkModels} jobs={reference.benchmarkJobs} busy={busy} onChange={(value) => { setSelection(value); setReport(null); }} onScore={() => void run(async () => { const result = await scoreVisionEventGold(id, selection); setReport(result.report); setReference(await fetchVisionEventGold(id)); })} />
        {reference.runs.map((row) => <button type="button" key={row.id} disabled={busy} onClick={() => void run(async () => { setReport((await fetchVisionEventGoldReport(id, row.id)).report); })}>Open score {row.id.slice(0, 8)} · {new Date(row.createdAt).toLocaleString()}</button>)}
        {report && <EventScoreReport report={report} />}
      </Panel>}
    </>}
  </div>;
}
