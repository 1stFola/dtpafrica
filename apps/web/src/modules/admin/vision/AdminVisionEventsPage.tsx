import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  decideVisionEvent,
  fetchVisionAssets,
  fetchVisionEventCandidates,
  promoteVisionEvent,
  proposeVisionEvent,
  type VisionAssetRow,
  type VisionEventCandidate,
} from "../../../api/vision";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { useAdminAuth } from "../AdminAuthContext";
import { EVENT_TYPES, allowedActions } from "./event-review";
import { useAdminVisionContext } from "./AdminVisionLayout";
import { Field, Panel, Pill, formatDuration, short, toneOfState, useAction } from "./vision-ui";


/**
 * Event candidates per asset, as a table: propose one by time, a second person's
 * decision, and promotion into the match record. The same actions with the video
 * under them are on the identity workstation (its timeline and inspector,
 * docs/vision/48), which each row links to.
 */
export function AdminVisionEventsPage() {
  usePageTitle("Events");
  const { hasPermission, session } = useAdminAuth();
  const { refreshOverview } = useAdminVisionContext();
  const [params, setParams] = useSearchParams();
  const assetId = params.get("asset") ?? "";
  const [assets, setAssets] = useState<VisionAssetRow[]>([]);
  const [list, setList] = useState<Awaited<ReturnType<typeof fetchVisionEventCandidates>> | null>(null);
  const [all, setAll] = useState(false);
  const [form, setForm] = useState({ type: "shot", startMs: "", endMs: "", note: "" });
  const [reason, setReason] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setAssets((await fetchVisionAssets()).assets);
    if (assetId) setList(await fetchVisionEventCandidates(assetId, all));
    else setList(null);
    await refreshOverview();
  }, [all, assetId, refreshOverview]);
  const { busy, run, messages, setError } = useAction(load);

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [load, setError]);

  const canReview = hasPermission("vision.review");
  const canPublish = hasPermission("vision.publish");
  const me = session?.userId;
  const asset = assets.find((a) => a.id === assetId);

  return (
    <div className="vision-page">
      {messages}
      <Panel title="Footage">
        <div className="vision-filters">
          <label>
            <span>Asset</span>
            <select value={assetId} onChange={(e) => setParams(e.target.value ? { asset: e.target.value } : {})}>
              <option value="">Choose footage…</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.sourceVideoRecord?.title ?? "untitled"} · {short(a.id)} · {a.counts.eventCandidates} event(s)
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Show</span>
            <select value={all ? "all" : "current"} onChange={(e) => setAll(e.target.value === "all")}>
              <option value="current">Current candidates</option>
              <option value="all">Including superseded</option>
            </select>
          </label>
        </div>
        {asset && (
          <p className="vision-footnote muted">
            {asset.sbMatch ? `${asset.sbMatch.homeTeam.name} v ${asset.sbMatch.awayTeam.name}` : "not linked to a match: nothing can be promoted"} · {formatDuration(asset.durationMs)} ·{" "}
            <Link to={`/admin/vision/workstation/identity/${asset.id}`}>Identity review →</Link> · <Link to={`/admin/vision/workstation/calibration/${asset.id}`}>Calibration →</Link>
            {list && !list.clock.anchored && " · the match clock is not anchored, so candidates read no minute and cannot be promoted"}
          </p>
        )}
      </Panel>

      {assetId && canReview && (
        <Panel title="Propose an event">
          <form
            className="vision-form vision-form--grid"
            onSubmit={(e) => {
              e.preventDefault();
              void run(`${form.type} proposed at ${form.startMs}ms; a second person decides.`, async () => {
                await proposeVisionEvent({ videoAssetId: assetId, type: form.type, startMs: Number(form.startMs), endMs: Number(form.endMs || form.startMs), note: form.note.trim() || undefined });
                setForm({ ...form, note: "" });
              });
            }}
          >
            <Field label="Type">
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {EVENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Start (source ms)" hint="read it off the identity screen's Match / source clock">
              <input type="number" min={0} value={form.startMs} onChange={(e) => setForm({ ...form, startMs: e.target.value })} required />
            </Field>
            <Field label="End (source ms)" hint="blank for an instant">
              <input type="number" min={0} value={form.endMs} onChange={(e) => setForm({ ...form, endMs: e.target.value })} />
            </Field>
            <Field label="Note">
              <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </Field>
            <button type="submit" disabled={busy || form.startMs === ""}>
              Propose
            </button>
          </form>
          <p className="vision-footnote muted">The actor track and roster slot are set on the identity screen, where a track can be selected; a candidate proposed here carries the segment, calibration and clock evidence the service finds itself.</p>
        </Panel>
      )}

      {assetId && (
        <Panel title={`Candidates${list ? ` (${list.count})` : ""}`}>
          {!list ? (
            <p className="muted">Loading…</p>
          ) : list.candidates.length === 0 ? (
            <p className="muted">No candidates on this footage.</p>
          ) : (
            <div className="admin-sb-table-wrap">
              <table className="vision-table">
                <thead>
                  <tr>
                    <th scope="col">Event</th>
                    <th scope="col">When</th>
                    <th scope="col">Review</th>
                    <th scope="col">Match record</th>
                    <th scope="col">Evidence</th>
                    <th scope="col" />
                  </tr>
                </thead>
                <tbody>
                  {list.candidates.map((c: VisionEventCandidate) => (
                    <tr key={c.id} className={c.supersededBy ? "vision-table__superseded" : ""}>
                      <td>
                        <strong>{c.type}</strong> <code className="vision-mono vision-sub">{short(c.id)}</code>{" "}
                        <Link to={`/admin/vision/workstation/identity/${assetId}?event=${c.id}`} className="vision-sub">
                          on the video →
                        </Link>
                        {!c.inPlay && <Pill tone="warn">not play</Pill>}
                        {c.supersededBy && <Pill tone="muted">superseded</Pill>}
                        {c.note && <div className="vision-sub muted">{c.note}</div>}
                      </td>
                      <td className="vision-sub">
                        {c.matchClock ?? "off the clock"}
                        <div className="muted">
                          {c.startMs}–{c.endMs} ms
                        </div>
                      </td>
                      <td>
                        <Pill tone={toneOfState(c.reviewState)}>{c.reviewState}</Pill>
                        {c.reviewNote && <div className="vision-sub muted">{c.reviewNote}</div>}
                      </td>
                      <td className="vision-sub">
                        {c.promotedEventId ? (
                          <Pill tone="ok">{c.promotionKind}</Pill>
                        ) : c.promotionStale ? (
                          <span className="muted">left the match record; correct it to review again</span>
                        ) : c.promotable ? (
                          <span className="muted">promotable as {c.scoreboardType}</span>
                        ) : (
                          <span className="muted">stays evidence</span>
                        )}
                      </td>
                      <td className="vision-sub muted">{c.evidence.map((e) => e.kind).join(", ") || "—"}</td>
                      <td>
                        {(() => {
                          /* One rule for what a candidate allows, shared with the workstation. This page had
                             its own copy, which offered Promote on a candidate that is not in play. */
                          const allowed = allowedActions(c, me, { review: canReview, publish: canPublish });
                          const why = (reason[c.id] ?? "").trim();
                          return (
                          <div className="vision-inline">
                            {allowed.accept && (
                              <>
                                <button type="button" disabled={busy} onClick={() => run(`${c.type} accepted.`, () => decideVisionEvent(c.id, "accepted"))}>
                                  Accept
                                </button>
                                <input value={reason[c.id] ?? ""} onChange={(e) => setReason({ ...reason, [c.id]: e.target.value })} placeholder="reason" aria-label="Rejection reason" />
                                <button type="button" disabled={busy || why.length < 3} onClick={() => run(`${c.type} rejected.`, () => decideVisionEvent(c.id, "rejected", why))}>
                                  Reject
                                </button>
                              </>
                            )}
                            {allowed.yours && canReview && <span className="muted">yours: a second person decides</span>}
                            {allowed.promote && (
                              <>
                                <button type="button" disabled={busy} onClick={() => run(`${c.type} promoted.`, () => promoteVisionEvent(c.id))}>
                                  Promote
                                </button>
                                <button type="button" disabled={busy} onClick={() => run(`${c.type} added to the match record.`, () => promoteVisionEvent(c.id, true))} title="Add a goal to the match record where the recorder has none at this minute: the score and the scorer&apos;s totals change with it">
                                  Promote, creating
                                </button>
                              </>
                            )}
                          </div>
                          );
                        })()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
