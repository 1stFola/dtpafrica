import { useState } from "react";
import { fetchPossessionCorrectionTracks, type PossessionCorrectionInput, type VisionPossessionSegment } from "../../../api/vision";
import { possessionTime } from "./PossessionSegmentTable";

export function PossessionCorrectionPanel({ row, me, canReview, stale, busy, onCorrect, onDecide, onSeek, canSeek }: {
  row: VisionPossessionSegment; me?: string; canReview: boolean; stale: boolean; busy: boolean;
  onCorrect: (id: string, input: PossessionCorrectionInput) => void;
  onDecide: (id: string, decision: "accepted" | "rejected", reason?: string) => void;
  onSeek: (ms: number) => void; canSeek: (ms: number) => boolean;
}) {
  const versions = row.corrections ?? [], latest = versions[0];
  const [editing, setEditing] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [tracks, setTracks] = useState<Awaited<ReturnType<typeof fetchPossessionCorrectionTracks>>["tracks"]>([]);
  const [startMs, setStart] = useState(latest?.startMs ?? row.startMs), [endMs, setEnd] = useState(latest?.endMs ?? row.endMs);
  const [actorId, setActor] = useState(latest ? latest.actorTrackId ?? "" : row.actorTrackId ?? "");
  const [reason, setReason] = useState(""), [reviewReason, setReviewReason] = useState("");
  const allowed = canReview && !!me && !stale;
  async function open() {
    setEditing(true); setLoading(true); setError("");
    try { setTracks((await fetchPossessionCorrectionTracks(row.id)).tracks); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }
  return <div className="vision-possession-correction">
    {latest && <><strong>Latest correction: {latest.decision?.decision ?? "awaiting other reviewer"}</strong>
      <p><button type="button" disabled={busy || !canSeek(latest.startMs)} onClick={() => onSeek(latest.startMs)}>{possessionTime(latest.startMs)} – {possessionTime(latest.endMs)}</button>
        {" · "}{latest.state === "unknown" ? "Unknown" : `Manual candidate track #${latest.localTrackId}`}</p>
      <p>{latest.reason}</p><p>Correction author {latest.proposedBy.slice(0, 8)}</p>
      {(latest.startMs > row.startMs || latest.endMs < row.endMs) && <p>Trimmed portions remain unresolved Unknown.</p>}
      {latest.decision?.reason && <p>Decision reason: {latest.decision.reason}</p>}
      {!latest.decision && allowed && latest.proposedBy !== me && <>
        <label>Correction review reason<input aria-label={`Correction review reason for interval ${row.ordinal + 1}`} maxLength={1000} value={reviewReason} disabled={busy} onChange={(e) => setReviewReason(e.target.value)} /></label>
        <button type="button" disabled={busy} onClick={() => onDecide(latest.id, "accepted", reviewReason.trim() || undefined)}>Accept correction</button>{" "}
        <button type="button" disabled={busy || !reviewReason.trim()} onClick={() => onDecide(latest.id, "rejected", reviewReason.trim())}>Reject correction</button>
      </>}
      {!latest.decision && latest.proposedBy === me && <p>Other reviewer decides your correction.</p>}
      <details><summary>Correction history ({versions.length})</summary>{versions.map((v) => <p key={v.id}>{possessionTime(v.startMs)} – {possessionTime(v.endMs)} · {v.state === "unknown" ? "Unknown" : `track #${v.localTrackId}`} · {v.decision?.decision ?? (v.id === latest.id ? "pending" : "superseded")} · {v.reason} · author {v.proposedBy.slice(0, 8)}{v.decision && ` · reviewer ${v.decision.reviewedBy.slice(0, 8)}`}</p>)}</details>
    </>}
    {allowed && versions.length < 20 && !editing && <button type="button" disabled={busy} onClick={() => void open()}>Correct interval {row.ordinal + 1}</button>}
    {editing && <fieldset disabled={busy || loading}><legend>Manual correction</legend>
      <p>Trim within the original interval. Enter whole milliseconds on source frame boundaries. The other reviewer must decide this version.</p>
      {loading && <p role="status">Loading compatible tracks…</p>}{error && <p role="alert">{error}</p>}
      <label>Start (source ms)<input aria-label={`Correction start for interval ${row.ordinal + 1}`} type="number" min={row.startMs} max={row.endMs} step={1} value={startMs} onChange={(e) => setStart(Number(e.target.value))} /></label>
      <label>End (source ms)<input aria-label={`Correction end for interval ${row.ordinal + 1}`} type="number" min={row.startMs} max={row.endMs} step={1} value={endMs} onChange={(e) => setEnd(Number(e.target.value))} /></label>
      <label>Actor<select aria-label={`Correction actor for interval ${row.ordinal + 1}`} value={actorId} onChange={(e) => setActor(e.target.value)}><option value="">Unknown</option>{tracks.map((t) => <option key={t.id} value={t.id}>Track #{t.localTrackId} · {possessionTime(t.startMs)}–{possessionTime(t.endMs)}</option>)}</select></label>
      <label>Correction reason<input aria-label={`Correction reason for interval ${row.ordinal + 1}`} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <button type="button" disabled={!!error || !reason.trim() || !Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || startMs < row.startMs || endMs > row.endMs || startMs >= endMs} onClick={() => onCorrect(row.id, { parentKey: latest?.id ?? row.id, startMs, endMs, state: actorId ? "candidate" : "unknown", actorTrackId: actorId || null, reason: reason.trim() })}>Submit correction</button>{" "}
      <button type="button" onClick={() => setEditing(false)}>Cancel correction</button>
    </fieldset>}
  </div>;
}
