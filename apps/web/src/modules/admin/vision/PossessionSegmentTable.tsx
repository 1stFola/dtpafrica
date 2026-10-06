import { Link } from "react-router-dom";
import type { PossessionCorrectionInput, VisionPossessionSegment } from "../../../api/vision";
import { PossessionCorrectionPanel } from "./PossessionCorrectionPanel";

export function possessionReviewAllowed(importedBy: string, me: string | undefined, canReview: boolean, stale: boolean, decided: boolean) {
  return canReview && !!me && me !== importedBy && !stale && !decided;
}
export function possessionSeekTime(sourceMs: number, offsetMs: number, durationMs: number | null) {
  if (sourceMs < offsetMs || (durationMs !== null && sourceMs >= offsetMs + durationMs)) return null;
  return (sourceMs - offsetMs) / 1000;
}
export const possessionTime = (ms: number) => `${Math.floor(ms / 60000).toString().padStart(2, "0")}:${((ms % 60000) / 1000).toFixed(3).padStart(6, "0")}`;

export function PossessionSegmentTable({ segments, assetId, importedBy, me, canReview, stale, busy, reasons, onReason, onDecide, onSeek, canSeek, onCorrect, onDecideCorrection }:
  { segments: VisionPossessionSegment[]; assetId: string; importedBy: string; me?: string; canReview: boolean; stale: boolean; busy: boolean;
    reasons: Record<string, string>; onReason: (id: string, value: string) => void; onDecide: (id: string, decision: "accepted" | "rejected") => void; onSeek: (ms: number) => void; canSeek: (ms: number) => boolean;
    onCorrect?: (id: string, input: PossessionCorrectionInput) => void; onDecideCorrection?: (id: string, decision: "accepted" | "rejected", reason?: string) => void }) {
  return <div className="admin-sb-table-wrap"><table className="vision-table"><thead><tr><th>Source interval</th><th>Original evidence</th><th>Original review</th><th>Original decisions and corrections</th></tr></thead><tbody>
    {segments.map((row) => <tr key={row.id}><td><button type="button" disabled={busy || !canSeek(row.startMs)} onClick={() => onSeek(row.startMs)} aria-label={`Watch interval ${possessionTime(row.startMs)}`}>
      {possessionTime(row.startMs)} – {possessionTime(row.endMs)}</button><p>{row.frames} source frame intervals</p></td><td>
      <strong>{row.sourceState === "unknown" ? "Unknown" : `Candidate track #${row.localTrackId}`}</strong>
      {row.reason && <p>{row.reason.replaceAll("_", " ")}</p>}
      {row.evidenceConfidence !== null && <p>Minimum detection confidence: {row.evidenceConfidence.toFixed(3)}</p>}
      {row.actorTrackId && <Link to={`/admin/vision/workstation/identity/${assetId}?track=${row.actorTrackId}&at=${row.startMs}`}>Inspect original track</Link>}
    </td><td>{row.decision ? <><strong>{row.decision.decision === "accepted" && row.sourceState === "unknown" ? "Unknown confirmed" : row.decision.decision}</strong>
      {row.decision.reason && <p>{row.decision.reason}</p>}<p>Reviewed by {row.decision.reviewedBy.slice(0, 8)}</p></> : "Unreviewed"}</td><td>
      {possessionReviewAllowed(importedBy, me, canReview, stale, !!row.decision) ? <>
        <label>Review reason<input aria-label={`Review reason for interval ${row.ordinal + 1}`} maxLength={1000} value={reasons[row.id] ?? ""} disabled={busy} onChange={(e) => onReason(row.id, e.target.value)} /></label>
        <button type="button" disabled={busy} onClick={() => onDecide(row.id, "accepted")}>{row.sourceState === "unknown" ? "Confirm Unknown" : "Accept candidate"}</button>{" "}
        <button type="button" disabled={busy || !reasons[row.id]?.trim()} onClick={() => onDecide(row.id, "rejected")}>Reject</button>
      </> : <span>{row.decision ? "Decision recorded" : stale ? "Evidence changed" : importedBy === me ? "Other reviewer decides" : "Review permission required"}</span>}
      {onCorrect && onDecideCorrection && <PossessionCorrectionPanel row={row} me={me} canReview={canReview} stale={stale} busy={busy} onCorrect={onCorrect} onDecide={onDecideCorrection} onSeek={onSeek} canSeek={canSeek} />}
    </td></tr>)}
  </tbody></table></div>;
}
