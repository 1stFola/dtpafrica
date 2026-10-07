import type { VisionEventImports } from "../../../api/vision";

export function EventImportControl({ data, selected, onSelect, onImport, canReview, busy }: { data: VisionEventImports | null; selected: string; onSelect: (id: string) => void; onImport: () => void; canReview: boolean; busy: boolean }) {
  if (!data) return <p className="muted">Loading completed carry evidence…</p>;
  return <div>
    <p className="vision-footnote">Import original automatic carries as unreviewed proposals. You become their proposer; a different person accepts them. Roster actors stay unknown. Importing creates no match events or player statistics.</p>
    {!data.jobs.length ? <p>No completed carry run is available. Complete calibrated possession and the carry proposal stage first.</p> : <div className="vision-filters">
      <label><span>Completed carry run</span><select aria-label="Completed carry run" value={selected} disabled={busy} onChange={(e) => onSelect(e.target.value)}>
        <option value="">Choose a completed run…</option>{data.jobs.map((j) => <option key={j.id} value={j.id}>{j.id.slice(0,8)} · attempt {j.attemptNumber}{data.runs.some((r) => r.inferenceJobId === j.id && r.attemptNumber === j.attemptNumber) ? " · already imported" : ""}</option>)}
      </select></label>
      {canReview && <button type="button" disabled={busy || !selected || !data.canImport} onClick={onImport}>Import original carry evidence</button>}
    </div>}
    {!data.canImport && <p className="vision-warn">Current analysis rights do not permit importing this footage.</p>}
    {!!data.runs.length && <ul>{data.runs.map((r) => <li key={r.id}>Imported {r.inferenceJobId.slice(0,8)} · attempt {r.attemptNumber} · {r.eventCount} original proposal(s){r.eventCount === 0 ? " — explicit zero output; no candidates were invented" : ""}.</li>)}</ul>}
    <p className="vision-footnote">Retries return the same original mapping, including after manual corrections. Changed source, calibration, camera or proxy evidence requires a compatible new run.</p>
  </div>;
}
