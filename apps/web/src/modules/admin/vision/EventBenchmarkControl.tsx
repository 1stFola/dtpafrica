import type { EventBenchmarkInput, VisionEventGoldDetail } from "../../../api/vision";

export function EventBenchmarkControl({ selection, models, jobs = [], busy, onChange, onScore }: {
  selection: EventBenchmarkInput;
  models: VisionEventGoldDetail["benchmarkModels"];
  jobs?: VisionEventGoldDetail["benchmarkJobs"];
  busy: boolean;
  onChange: (selection: EventBenchmarkInput) => void;
  onScore: () => void;
}) {
  const modelMode = selection.scope === "model_original_candidates";
  const runMode = selection.scope === "complete_event_run";
  return <div className="vision-gold-create">
    <label>Evaluation scope<select value={selection.scope} disabled={busy} onChange={(event) => onChange({ scope: event.target.value as EventBenchmarkInput["scope"] })}>
      <option value="all_current_candidates">All current candidates</option>
      <option value="model_original_candidates">Original proposals from one model</option>
      <option value="complete_event_run">One completed event inference run</option>
    </select></label>
    {modelMode ? <>
      <label>Event model version<select value={selection.modelVersionId ?? ""} disabled={busy} onChange={(event) => onChange({ ...selection, modelVersionId: event.target.value })}>
        <option value="">Choose an event model version</option>
        {models.map((model) => <option key={model.id} value={model.id}>{model.model.key} · {model.version} · {model.id.slice(0, 8)}</option>)}
      </select></label>
      <p>Evaluates original model proposals, including originals later corrected or rejected. Manual corrections and other model versions are excluded. Repeated proposals count as duplicates. No proposals means inference evidence is missing; it does not prove the model found zero events.</p>
      {models.length === 0 && <p>No registered event model versions are available. Complete the licensed event inference path before model evaluation.</p>}
    </> : runMode ? <>
      <label>Completed event inference job<select value={selection.jobId ?? ""} disabled={busy} onChange={(event) => onChange({ scope: "complete_event_run", jobId: event.target.value })}>
        <option value="">Choose a completed event run</option>
        {jobs.map((job) => <option key={job.id} value={job.id}>{job.id.slice(0, 8)} · attempt {job.attemptNumber} · {job.finishedAt ? new Date(job.finishedAt).toLocaleString() : "completion time missing"}</option>)}
      </select></label>
      <p>Scores exactly one run's original artifact. The source, weights, configuration, attempt, logged checksum and full reference-window coverage must agree. A completed artifact with an explicit empty prediction list counts as zero predictions; missing or incomplete runs are refused.</p>
      {jobs.length === 0 && <p>No completed model-bound event jobs are available for this footage. The event inference producer still needs its licensed implementation; this evaluator does not run inference.</p>}
    </> : <p>Evaluates all current candidates in this window, including manual proposals and rejected claims. This measures the candidate ledger, not one model's accuracy.</p>}
    <p className="muted">A checksummed snapshot records exactly what was evaluated. Scores do not approve a model or change the match record. Original model scoring does not establish that inference covered the complete window.</p>
    <button type="button" disabled={busy || (modelMode && !selection.modelVersionId) || (runMode && !selection.jobId)} onClick={onScore}>{runMode ? "Score completed event run" : modelMode ? "Score original model proposals" : "Score current event candidates"}</button>
  </div>;
}
