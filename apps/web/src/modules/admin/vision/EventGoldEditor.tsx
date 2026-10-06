import { useState } from "react";
import { VISION_EVENT_TYPES, validateEventGoldLabels, type EventGoldLabels, type GoldEvent, type GoldNonPlayWindow } from "@dtp/vision-contracts";
import type { VisionEventGoldDetail } from "../../../api/vision";

export function EventGoldEditor({ reference, initial, sourceMs, busy, reconciliation = false, onSubmit }: { reference: VisionEventGoldDetail; initial?: EventGoldLabels; sourceMs: number; busy: boolean; reconciliation?: boolean; onSubmit: (labels: EventGoldLabels, reason: string) => Promise<void> }) {
  const [labels, setLabels] = useState<EventGoldLabels>(initial ?? { events: [], nonPlayWindows: [] });
  const [complete, setComplete] = useState(false);
  const [reason, setReason] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const at = Math.min(reference.windowEndMs - 1, Math.max(reference.windowStartMs, Math.round(sourceMs)));
  const patchEvent = (index: number, change: Partial<GoldEvent>) => setLabels((value) => ({ ...value, events: value.events.map((event, i) => i === index ? { ...event, ...change } : event) }));
  const patchRange = (index: number, change: Partial<GoldNonPlayWindow>) => setLabels((value) => ({ ...value, nonPlayWindows: value.nonPlayWindows.map((range, i) => i === index ? { ...range, ...change } : range) }));
  return <form onSubmit={(event) => {
    event.preventDefault(); const result = validateEventGoldLabels(labels, { startMs: reference.windowStartMs, endMs: reference.windowEndMs }); setProblems(result.problems);
    if (result.labels && complete) void onSubmit(result.labels, reason);
  }}>
    <fieldset disabled={busy} className="vision-gold-editor">
      <legend>{reconciliation ? "Reconciled reference" : "Your independent labels"}</legend>
      <p className="muted">Label all live events in this window using source seconds. Mark uncertain actors Unknown. Record replay, intro and halftime intervals separately; do not add their events as live play.</p>
      <button type="button" disabled={labels.events.length >= 200} onClick={() => setLabels((value) => ({ ...value, events: [...value.events, { id: crypto.randomUUID(), type: "shot", startMs: at, endMs: at, actorMatchSquadPlayerId: null }] }))}>Add event at playhead</button>
      {labels.events.map((row, index) => <div className="vision-gold-label-row" key={row.id}>
        <label>Event {index + 1} type<select value={row.type} onChange={(event) => patchEvent(index, { type: event.target.value as GoldEvent["type"] })}>{VISION_EVENT_TYPES.map((type) => <option value={type} key={type}>{type.replace(/_/g, " ")}</option>)}</select></label>
        <label>Start (source seconds)<input type="number" required step="0.001" min={reference.windowStartMs / 1000} max={(reference.windowEndMs - 1) / 1000} value={row.startMs / 1000} onChange={(event) => patchEvent(index, { startMs: Math.round(Number(event.target.value) * 1000) })} /></label>
        <label>End (source seconds)<input type="number" required step="0.001" min={row.startMs / 1000} max={reference.windowEndMs / 1000} value={row.endMs / 1000} onChange={(event) => patchEvent(index, { endMs: Math.round(Number(event.target.value) * 1000) })} /></label>
        <label>Actor<select value={row.actorMatchSquadPlayerId ?? ""} onChange={(event) => patchEvent(index, { actorMatchSquadPlayerId: event.target.value || null })}><option value="">Unknown</option>{reference.roster.map((slot) => <option value={slot.id} key={slot.id}>{slot.team?.name ? `${slot.team.name} · ` : ""}#{slot.jerseyNumber ?? "—"} {slot.playerName}</option>)}</select></label>
        <button type="button" onClick={() => setLabels((value) => ({ ...value, events: value.events.filter((event) => event.id !== row.id) }))}>Remove event {index + 1}</button>
      </div>)}
      <button type="button" disabled={labels.nonPlayWindows.length >= 200} onClick={() => setLabels((value) => ({ ...value, nonPlayWindows: [...value.nonPlayWindows, { startMs: at, endMs: Math.min(at + 1000, reference.windowEndMs), kind: "replay" }] }))}>Add non-play interval</button>
      {labels.nonPlayWindows.map((row, index) => <div className="vision-gold-label-row" key={index}>
        <label>Non-play {index + 1} kind<select value={row.kind} onChange={(event) => patchRange(index, { kind: event.target.value as GoldNonPlayWindow["kind"] })}>{["replay", "intro", "halftime"].map((kind) => <option key={kind}>{kind}</option>)}</select></label>
        <label>Start (source seconds)<input type="number" required step="0.001" value={row.startMs / 1000} onChange={(event) => patchRange(index, { startMs: Math.round(Number(event.target.value) * 1000) })} /></label>
        <label>End (source seconds)<input type="number" required step="0.001" value={row.endMs / 1000} onChange={(event) => patchRange(index, { endMs: Math.round(Number(event.target.value) * 1000) })} /></label>
        <button type="button" onClick={() => setLabels((value) => ({ ...value, nonPlayWindows: value.nonPlayWindows.filter((_, i) => i !== index) }))}>Remove non-play {index + 1}</button>
      </div>)}
      {reconciliation && <label>How disagreements were resolved<textarea required maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} /></label>}
      <label className="vision-gold-complete"><input type="checkbox" checked={complete} onChange={(event) => setComplete(event.target.checked)} /> I reviewed the entire window, including periods with no live events.</label>
      {problems.length > 0 && <ul role="alert">{problems.map((problem, index) => <li key={index}>{problem}</li>)}</ul>}
      <button type="submit" disabled={!complete || busy}>{reconciliation ? "Propose reconciliation" : "Submit independent labels"}</button>
      <p className="muted">Submission is immutable. Unsubmitted edits stay on this page and are lost if you leave or reload. Empty labels explicitly mean you found no live events or non-play intervals.</p>
    </fieldset>
  </form>;
}
