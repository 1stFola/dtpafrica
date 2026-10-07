import { useState } from "react";
import type { VisionEventCandidate } from "../../../api/vision";
import { EVENT_TYPES, allowedActions } from "./event-review";
import { formatClock } from "./annotation-time";

/**
 * The inspector beside the roster: the selected candidate, what it rests on,
 * and every correction and decision the service allows this person -- the
 * boundary moved to the playhead, the actor set to the selected track, the
 * type changed, a second person's accept or reject, a publisher's promotion.
 * A correction is a new row and starts review again; the inspector says so.
 */
export function VisionEventInspector({
  candidate,
  me,
  can,
  sourceMs,
  selectedTrackLabel,
  trackLabel,
  busy,
  onCorrect,
  onDecide,
  onPromote,
  onClose,
}: {
  candidate: VisionEventCandidate;
  me: string | undefined;
  can: { review: boolean; publish: boolean };
  sourceMs: number;
  selectedTrackLabel: string | null;
  trackLabel: (trackId: string | null) => string | null;
  busy: boolean;
  onCorrect: (changes: { type?: string; startMs?: number; endMs?: number; actor?: boolean; note?: string }, label: string) => void;
  onDecide: (decision: "accepted" | "rejected", reason?: string) => void;
  onPromote: (create: boolean) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [type, setType] = useState(candidate.type);
  const allowed = allowedActions(candidate, me, can);
  /* Already the start of the frame being shown: the page snaps it. */
  const at = Math.round(sourceMs);

  return (
    <section className="vision-panel vision-inspector" aria-label="Event candidate">
      <div className="vision-panel__head">
        <h3 className="vision-panel__title">
          {candidate.type.replace(/_/g, " ")} <code className="vision-mono vision-sub">{candidate.id.slice(0, 8)}</code>
        </h3>
        <button type="button" onClick={onClose} aria-label="Close the inspector">
          ✕
        </button>
      </div>

      {candidate.evidenceStale && <p role="alert" className="vision-warn">Original source, calibration, proxy or track evidence changed. Review and correction actions are unavailable; import a compatible new run.</p>}
      {candidate.importRun && <details><summary>Original carry run provenance</summary>
        <p>{candidate.method === "model" ? "Original automatic proposal" : "Manual revision; the original algorithm proposal remains separate"}.</p>
        <p>Inference job: {candidate.importRun.inferenceJobId}</p><p className="vision-gold-checksum">Artifact checksum: {candidate.importRun.artifactChecksum}</p>
        <p>Imported by: {candidate.importRun.createdBy}. A different person accepts the proposal. No roster actor was inferred.</p>
      </details>}

      <dl className="vision-inspector__facts">
        <dt>Window</dt>
        <dd>
          {formatClock(candidate.startMs)}–{formatClock(candidate.endMs)}
          {candidate.matchClock ? ` · ${candidate.matchClock} on the match clock` : " · off the match clock"}
        </dd>
        <dt>Actor</dt>
        <dd>{trackLabel(candidate.actorTrackId) ?? "nobody named"}</dd>
        <dt>Review</dt>
        <dd>
          {candidate.reviewState}
          {candidate.reviewNote ? ` — ${candidate.reviewNote}` : ""}
          {allowed.yours ? " · yours; a second person decides" : ""}
          {allowed.proposedByYou ? " · you proposed this and someone else corrected it; a third person accepts" : ""}
        </dd>
        <dt>Match record</dt>
        <dd>
          {candidate.promotedEventId
            ? `${candidate.promotionKind} as event ${candidate.promotedEventId.slice(0, 8)}`
            : candidate.promotionStale
              ? "was promoted, and that event has since left the match record; correct it to start review again"
              : candidate.promotable
              ? `promotable as ${candidate.scoreboardType}${candidate.inPlay ? "" : ", but inside a replay"}`
              : "stays Vision evidence: the recorder has no row for this type"}
        </dd>
        <dt>Evidence</dt>
        <dd>{candidate.evidence.length ? candidate.evidence.map((e) => e.kind.replace(/_/g, " ")).join(", ") : "none"}</dd>
        {candidate.note && (
          <>
            <dt>Note</dt>
            <dd>{candidate.note}</dd>
          </>
        )}
      </dl>

      {allowed.correct && (
        <div className="vision-inspector__correct">
          <div className="vision-actions">
            <button type="button" disabled={busy} onClick={() => onCorrect({ startMs: at }, `Start moved to ${formatClock(at)}.`)} title="A new row with the start at the playhead">
              Start here
            </button>
            <button type="button" disabled={busy} onClick={() => onCorrect({ endMs: at }, `End moved to ${formatClock(at)}.`)} title="A new row with the end at the playhead">
              End here
            </button>
            <button type="button" disabled={busy || !selectedTrackLabel} onClick={() => onCorrect({ actor: true }, `Actor set to ${selectedTrackLabel}.`)} title="A new row naming the selected track and the slot it was said to be">
              Actor: {selectedTrackLabel ?? "select a track"}
            </button>
          </div>
          <div className="vision-inline">
            <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Event type">
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <button type="button" disabled={busy || type === candidate.type} onClick={() => onCorrect({ type }, `Type changed to ${type}.`)}>
              Change type
            </button>
          </div>
          <p className="vision-footnote">A correction is a new row that supersedes this one and is unreviewed again, whoever corrected it.</p>
        </div>
      )}

      {(allowed.accept || allowed.reject) && (
        <div className="vision-inspector__decide">
          <div className="vision-actions">
            <button type="button" disabled={busy} onClick={() => onDecide("accepted")}>
              Accept
            </button>
            <button type="button" disabled={busy || reason.trim().length < 3} title="Say why in the box first" onClick={() => onDecide("rejected", reason.trim())}>
              Reject
            </button>
          </div>
          <input type="text" data-reject-reason="event" placeholder="Why is it wrong? (needed to reject)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason for rejecting" />
        </div>
      )}

      {allowed.promote && (
        <div className="vision-actions">
          <button type="button" disabled={busy} onClick={() => onPromote(false)} title="Enrich the recorder's event at this minute">
            Promote
          </button>
          <button type="button" disabled={busy} onClick={() => onPromote(true)} title="Add it to the match record if the recorder has nothing at this minute: the score and the scorer&apos;s totals change with it">
            Promote, creating
          </button>
        </div>
      )}
    </section>
  );
}
