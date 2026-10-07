import { Link } from "react-router-dom";
import type { VisionAssetRow, VisionEventGoldListSet, VisionEventImports } from "../../../api/vision";

export function EventPilotHandoff({ asset, imports, references, referenceError, canReview }: {
  asset: VisionAssetRow; imports: VisionEventImports | null; references: VisionEventGoldListSet[] | null; referenceError: string | null; canReview: boolean;
}) {
  const source = asset.sourceVideoRecord ? `/admin/vision/sources/${asset.sourceVideoRecord.id}` : "/admin/vision/sources";
  const stage = (type: string) => asset.stages.find((entry) => entry.type === type)?.state ?? "not run";
  const bounded = asset.durationMs !== null && asset.durationMs > 0 && asset.durationMs <= 300_000;
  // These are declarations and job states, not artifact compatibility or accuracy checks.
  const ownReferences = references?.filter((reference) => reference.videoAssetId === asset.id);
  return <section aria-label="Pilot prerequisites and evaluation handoff">
    <p>Phase 6 accuracy gate remains open. Completed stages and reviewer acceptance do not establish real-footage accuracy.</p>
    <ol>
      <li><Link to={source}>Source rights and pipeline</Link>: {imports ? imports.canImport ? "analysis currently permitted" : "analysis rights blocked" : "rights status loading"}; {asset.sbMatchId ? "match linked" : "link a match"}; {bounded ? "within the five-minute carry limit" : "carry needs a known positive duration of at most five minutes"}.</li>
      <li>Review proxy: {asset.hasProxy ? "available" : "missing"}. Transcode: {stage("transcode")}. An available proxy still needs current dimensions, checksum and source-clock provenance.</li>
      <li><Link to="/admin/vision/models">Licensed detector and model versions</Link>: verify ball/player classes and code, weights and dataset licences before running inference. Detect: {stage("detect")}; track: {stage("track")}; ball trajectory: {stage("ball_trajectory")}. A succeeded job alone does not verify licensing or input compatibility.</li>
      <li><Link to={`/admin/vision/workstation/calibration/${asset.id}`}>Camera and pitch calibration</Link>, then <Link to={`/admin/vision/possession?asset=${asset.id}`}>calibrated possession</Link>: possession stage {stage("possession")}. Regenerate downstream evidence when source, proxy, camera, calibration or tracks change; the API validates compatibility at queue and import time.</li>
      <li>Carry proposal stage: {stage("events")}; {imports ? `${imports.jobs.length} completed carry run(s) listed; ${imports.runs.length} import record(s) listed` : "carry import history loading"}. Import original evidence above, then a different person reviews it on the video. Original artifacts remain the evaluation input after manual corrections.</li>
    </ol>
    <h3>Independent gold and evaluation</h3>
    <p>Each assigned person labels held-out footage independently, without candidate overlays or the other person's labels. After both submit, reconcile disagreements and have the other person approve and freeze. Score the complete original event run, including genuine zero output, against that frozen window. Candidate-only scores cannot establish complete-run accuracy.</p>
    {!canReview ? <p>A reviewer with vision.review permission opens the gold workflow.</p> : <>
      {referenceError ? <p role="alert">Gold reference status unavailable: {referenceError}</p> : ownReferences === undefined ? <p role="status">Loading your gold reference status…</p> : !ownReferences.length ? <p>No gold references for this footage are accessible to your account. An existing reference may belong to other reviewers; confirm assignments before creating another.</p> : <ul>{ownReferences.map((reference) => <li key={reference.id}><Link to={`/admin/vision/event-gold?reference=${reference.id}`}>{reference.label}</Link> · {reference.submissions.length}/2 independent submissions · {reference.frozenAt ? "frozen; original-run scoring available" : reference.submissions.length === 2 ? "reconciliation and independent freeze approval still required" : "collecting independent labels"}</li>)}</ul>}
      <Link to={`/admin/vision/event-gold?asset=${asset.id}`}>Open gold references for this footage →</Link>
    </>}
    <p className="vision-footnote">A short pilot score is evidence for its recorded window. Representative per-event and actor evaluation is still required before closing Phase 6. This panel does not queue jobs, approve licences or spend compute.</p>
  </section>;
}
