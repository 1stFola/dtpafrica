import type { VisionEventScore } from "../../../api/vision";
const percent = (value: number | null) => value === null ? "Not measurable" : `${(100 * value).toFixed(1)}%`;
export function EventScoreReport({ report }: { report: VisionEventScore }) {
  const rows = [{ type: "All events", ...report.all }, ...report.byType];
  return <div>
    <p className="muted">{report.interpretation ?? "Agreement between independent reviewers; neither submission is assumed to be ground truth."} Both event boundaries must agree within {report.toleranceMs}ms. Events match one-to-one by type and time, before actor accuracy is measured.</p>
    {report.methods && <p>Snapshot methods: {report.methods.join(", ") || "no candidates"}</p>}
    {report.scope && <p>Evaluation scope: {report.scope === "complete_event_run" ? "One completed event inference run" : report.scope === "model_original_candidates" ? "Original proposals from one model" : "All current candidates"}</p>}
    {report.model && <p>Model: {report.model.model.key} · {report.model.version} · {report.model.id}</p>}
    {report.inference && <p>Inference job: {report.inference.jobId} · attempt {report.inference.attemptNumber}. Reported complete source coverage: {report.inference.coverage.startMs / 1000}–{report.inference.coverage.endMs / 1000}s. Run output: {report.inference.eventCount} event(s).</p>}
    {report.inference?.producer && <p>Producer: {report.inference.producer.algorithm}. Weight-free carry rules over original calibrated possession; roster actors remain unknown. This run covers carry proposals only; other reference event types still count as missed.</p>}
    <div className="admin-sb-table-wrap"><table className="vision-table"><thead><tr>
      <th>Event type</th><th>Reference</th><th>Predicted</th><th>Matched</th><th>Extra</th><th>Missed</th><th>Precision</th><th>Recall</th><th>F1</th><th>Actor accuracy</th><th>Actor recall</th>
    </tr></thead><tbody>{rows.map((row) => <tr key={row.type}><th scope="row">{row.type.replace(/_/g, " ")}</th>
      <td>{row.reference}</td><td>{row.predictions}</td><td>{row.tp}</td><td>{row.fp}</td><td>{row.fn}</td><td>{percent(row.precision)}</td><td>{percent(row.recall)}</td><td>{percent(row.f1)}</td><td>{percent(row.actorAccuracy)}</td><td>{percent(row.actorRecall)}</td>
    </tr>)}</tbody></table></div>
    <p className="muted">Actor accuracy covers matched events with a known reference actor; actor recall also counts missed events. Unknown reference actors never count as correct guesses. Mean boundary errors: start {report.all.meanStartErrorMs?.toFixed(1) ?? "—"}ms, end {report.all.meanEndErrorMs?.toFixed(1) ?? "—"}ms.</p>
    <p>Extra duplicate candidates: {report.duplicatePredictionIds.length}. Suppressed non-play candidates: {report.suppressedPredictionIds.length}.</p>
    {report.nonPlayErrors.length > 0 && <ul>{report.nonPlayErrors.map((range, index) => <li key={index}>{range.kind}: {range.startMs / 1000}–{range.endMs / 1000}s — {range.predictionIds.length} unsuppressed candidate(s)</li>)}</ul>}
    <details><summary>Scoring provenance and failures</summary><p>Scorer: {report.scorerVersion}</p>
      {report.model && <><p className="vision-gold-checksum">Registered weights checksum: {report.inference?.producer ? "Not applicable: weight-free rule" : report.model.weightsChecksum ?? "Not recorded"}</p><p>Registered commit: {report.model.gitCommit ?? "Not recorded"}</p><p>Training dataset version: {report.model.datasetVersionId ?? "Not recorded"}</p><p>Worker image: {report.model.workerImage ?? "Not recorded"}</p></>}
      {report.inference?.producer && <><p className="vision-gold-checksum">Rule manifest checksum: {report.inference.producer.manifestChecksum}</p><p>Original possession job: {report.inference.producer.possessionJobId}</p><p className="vision-gold-checksum">Original possession index checksum: {report.inference.producer.possessionIndexChecksum}</p><p className="vision-gold-checksum">Original tracks checksum: {report.inference.producer.tracksChecksum}</p></>}
      {report.referenceChecksum && <p className="vision-gold-checksum">Reference checksum: {report.referenceChecksum}</p>}
      {report.snapshotChecksum && <p className="vision-gold-checksum">Snapshot checksum: {report.snapshotChecksum}</p>}
      {report.inference && <><p className="vision-gold-checksum">Original inference artifact checksum: {report.inference.artifactChecksum}</p><p>Artifact schema: {report.inference.artifactSchemaVersion}. Completed: {new Date(report.inference.finishedAt).toLocaleString()}.</p></>}
      <p className="vision-gold-checksum">Missed reference IDs: {report.missedReferenceIds.join(", ") || "none"}</p><p className="vision-gold-checksum">Extra candidate IDs: {report.falsePositiveIds.join(", ") || "none"}</p>
    </details>
  </div>;
}
