import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { correctVisionPossession, decidePossessionCorrection, decideVisionPossession, fetchVisionAssets, fetchVisionPossession, fetchVisionPossessionRun, fetchVisionReviewMedia, importVisionPossession,
  type VisionAssetRow, type VisionPossessionRun, type VisionReviewMedia } from "../../../api/vision";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { useAdminAuth } from "../AdminAuthContext";
import { Panel, short } from "./vision-ui";
import { PossessionSegmentTable, possessionSeekTime, possessionTime } from "./PossessionSegmentTable";
import { PossessionConstraintSummary } from "./PossessionConstraintSummary";

export function AdminVisionPossessionPage() {
  usePageTitle("Possession review");
  const { session, hasPermission } = useAdminAuth();
  const [params, setParams] = useSearchParams();
  const assetId = params.get("asset") ?? "", runId = params.get("run") ?? "";
  const [assets, setAssets] = useState<VisionAssetRow[]>([]);
  const [list, setList] = useState<Awaited<ReturnType<typeof fetchVisionPossession>> | null>(null);
  const [run, setRun] = useState<VisionPossessionRun | null>(null);
  const [media, setMedia] = useState<VisionReviewMedia | null>(null);
  const [jobId, setJobId] = useState("");
  const [cursor, setCursor] = useState(0), [refresh, setRefresh] = useState(0);
  const [history, setHistory] = useState<number[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [mediaError, setMediaError] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  const canReview = hasPermission("vision.review"), canReadVideo = hasPermission("vision.media.raw.read");

  useEffect(() => { let active = true; fetchVisionAssets().then((value) => { if (active) setAssets(value.assets); }).catch((e) => { if (active) setError(String(e.message ?? e)); }); return () => { active = false; }; }, []);
  useEffect(() => { setCursor(0); setHistory([]); setReasons({}); setJobId(""); }, [assetId, runId]);
  useEffect(() => {
    let active = true; setList(null); setRun(null); setError(""); setLoading(!!assetId);
    if (assetId) void (async () => {
      try {
        const listing = await fetchVisionPossession(assetId);
        const detail = runId ? await fetchVisionPossessionRun(runId, cursor) : null;
        if (detail && detail.videoAssetId !== assetId) throw new Error("The selected run belongs to different footage.");
        if (active) { setList(listing); setRun(detail); }
      } catch (e) { if (active) setError(e instanceof Error ? e.message : String(e)); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [assetId, runId, cursor, refresh]);
  useEffect(() => {
    let active = true; setMedia(null); setMediaError("");
    if (assetId && canReadVideo) fetchVisionReviewMedia(assetId).then((value) => { if (active) setMedia(value); }).catch((e) => { if (active) setMediaError(e instanceof Error ? e.message : String(e)); });
    return () => { active = false; };
  }, [assetId, canReadVideo]);

  async function action(fn: () => Promise<void>) { setBusy(true); setError(""); setNotice(""); try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }
  function seek(ms: number) { const time = media ? possessionSeekTime(ms, media.sourceOffsetMs, media.durationMs) : null; if (time !== null && video.current) { video.current.pause(); video.current.currentTime = time; } }

  return <div className="vision-page vision-possession-page">
    {error && <p role="alert" className="admin-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    <Panel title="Possession review"><p>Review original candidate tracks and explicit Unknown intervals. Importing preserves evidence; a different person decides each interval. Decisions do not publish events or update player statistics.</p>
      <div className="vision-filters"><label>Footage<select aria-label="Possession footage" disabled={busy} value={assetId} onChange={(e) => { setNotice(""); setParams(e.target.value ? { asset: e.target.value } : {}); }}>
        <option value="">Choose footage…</option>{assets.map((a) => <option key={a.id} value={a.id}>{a.sourceVideoRecord?.title ?? "untitled"} · {short(a.id)}</option>)}</select></label>
        {list && <label>Imported run<select aria-label="Imported possession run" disabled={busy} value={runId} onChange={(e) => { setNotice(""); setParams({ asset: assetId, ...(e.target.value ? { run: e.target.value } : {}) }); }}>
          <option value="">Choose imported run…</option>{list.runs.map((r) => <option key={r.id} value={r.id}>{short(r.inferenceJobId)} · attempt {r.attemptNumber} · {possessionTime(r.windowStartMs)} – {possessionTime(r.windowEndMs)}</option>)}</select></label>}
      </div>
      {assetId && <p><Link to={`/admin/vision/workstation/identity/${assetId}`}>Identity review</Link> · <Link to={`/admin/vision/events?asset=${assetId}`}>Events</Link> · <Link to="/admin/vision/pipeline">Pipeline</Link></p>}
    </Panel>
    {assetId && list && <Panel title="Import completed evidence">
      {list.jobs.length === 0 ? <p>No completed possession run is available. Complete compatible detection, ball trajectory and tracking before running possession. No candidate output has been inferred from this empty list.</p> : <>
        <label>Completed possession job<select aria-label="Completed possession job" disabled={busy || !canReview} value={jobId} onChange={(e) => setJobId(e.target.value)}><option value="">Choose completed job…</option>{list.jobs.map((j) => <option key={j.id} value={j.id}>{short(j.id)} · attempt {j.attemptNumber}</option>)}</select></label>{" "}
        <button type="button" disabled={busy || !canReview || !jobId} onClick={() => void action(async () => { const imported = await importVisionPossession(assetId, jobId); setParams({ asset: assetId, run: imported.id }); setRefresh((n) => n + 1); setNotice(imported.imported ? "Original evidence imported. The other reviewer decides." : "This immutable run was already imported."); })}>Import for review</button>
      </>}
    </Panel>}
    {loading && <p role="status">Loading possession evidence…</p>}
    {run && <>
      <Panel title="Original run evidence"><p>{possessionTime(run.windowStartMs)} – {possessionTime(run.windowEndMs)} · {run.totalSegments} intervals · {run.candidateFrames} candidate frames · {run.unknownFrames} Unknown frames</p>
        <p>Candidate coverage is not possession accuracy. Track assignments remain local to this original run.</p>
        <PossessionConstraintSummary snapshot={run.snapshot} />
        {run.stale && <p role="alert">Source, camera, calibration or proxy evidence changed. Review decisions are disabled; import a current run.</p>}
        {run.createdBy === session?.userId && <p>You imported this run. The other reviewer must decide its original intervals.</p>}
        <details><summary>Evidence provenance</summary><p>Job {run.inferenceJobId} · attempt {run.attemptNumber}</p><p>Tracking job {run.trackJobId}</p><p>Calculation {run.calculationVersion}</p><p>Original index checksum: {run.indexChecksum}</p></details>
      </Panel>
      <Panel title="Watch the evidence">{media ? <video ref={video} className="vision-gold-video" controls src={media.url} onLoadedMetadata={() => seek(run.windowStartMs)} onError={() => setMediaError("The review video could not load. Refresh to renew playback access.")} /> : <p>{mediaError || (canReadVideo ? "Loading review proxy…" : "Video playback requires raw footage read permission.")}</p>}
        {media && mediaError && <p role="alert">{mediaError}</p>}<p>Use an interval's source time to seek. Unknown never carries a possessor.</p></Panel>
      <Panel title="Intervals"><PossessionSegmentTable segments={run.segments} assetId={assetId} importedBy={run.createdBy} me={session?.userId} canReview={canReview} stale={run.stale} busy={busy}
        reasons={reasons} onReason={(id, value) => setReasons((r) => ({ ...r, [id]: value }))} onSeek={seek} canSeek={(ms) => !!media && possessionSeekTime(ms, media.sourceOffsetMs, media.durationMs) !== null}
        onDecide={(id, decision) => void action(async () => { await decideVisionPossession(id, decision, reasons[id]?.trim() || undefined); setRefresh((n) => n + 1); setNotice("Decision recorded. Original evidence is unchanged."); })}
        onCorrect={(id, input) => void action(async () => { await correctVisionPossession(id, input); setRefresh((n) => n + 1); setNotice("Correction submitted. The other reviewer must decide this version."); })}
        onDecideCorrection={(id, decision, reason) => void action(async () => { await decidePossessionCorrection(id, decision, reason); setRefresh((n) => n + 1); setNotice("Correction decision recorded. Original evidence is unchanged."); })} />
        <p>Intervals {cursor + 1}–{cursor + run.segments.length} of {run.totalSegments}</p>
        <button type="button" disabled={busy || history.length === 0} onClick={() => { setCursor(history.at(-1)!); setHistory((h) => h.slice(0, -1)); }}>Previous intervals</button>{" "}
        <button type="button" disabled={busy || run.nextCursor === null} onClick={() => { setHistory((h) => [...h, cursor]); setCursor(run.nextCursor!); }}>Next intervals</button>
      </Panel>
    </>}
  </div>;
}
