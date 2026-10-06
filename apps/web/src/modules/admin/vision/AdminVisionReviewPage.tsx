import { useCallback, useEffect, useRef, useState } from "react";
import { reviewQueueOrder, type ReviewQueueOrder } from "@dtp/vision-contracts";
import { ReviewOrderControl } from "./ReviewOrderControl";
import { Link, useSearchParams } from "react-router-dom";
import { fetchVisionReviewQueue, type VisionReviewQueue, type VisionReviewQueueItem } from "../../../api/vision";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { useAdminVisionContext } from "./AdminVisionLayout";
import { formatClock } from "./annotation-time";
import { Panel, Pill, formatWhen, short } from "./vision-ui";

/**
 * The review queue: what this person should look at next, across every piece
 * of footage, confidence or age first, their own proposals left out. Each item opens on
 * the video at its moment, where the decision is made; the queue itself decides
 * nothing. `,` and `.` on the workstation walk the same list on one asset.
 */
export function AdminVisionReviewPage() {
  usePageTitle("Review queue");
  const { refreshOverview } = useAdminVisionContext();
  const [params, setParams] = useSearchParams();
  const order = params.has("order") ? reviewQueueOrder(params.get("order")) : "confidence";
  const assetId = params.get("asset") ?? "";
  const [queue, setQueue] = useState<VisionReviewQueue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  const load = useCallback(async () => {
    const current = ++request.current;
    setError(null);
    try {
      const result = await fetchVisionReviewQueue({ assetId: assetId || undefined, limit: 200, order });
      if (current !== request.current) return;
      setQueue(result);
      await refreshOverview();
    } catch (e) {
      if (current === request.current) setError(e instanceof Error ? e.message : String(e));
    }
  }, [assetId, refreshOverview, order]);

  useEffect(() => {
    void load();
    return () => { request.current++; };
  }, [load]);

  return (
    <div className="vision-page">
      {error && <p className="vision-panel vision-panel--error">{error}</p>}
      <Panel
        title="What needs a second person"
        actions={
          <button type="button" onClick={() => void load()}>
            Refresh
          </button>
        }
      >
        <ReviewOrderControl order={order} onChange={(value) => {
          setQueue(null);
          setParams((previous) => { const next = new URLSearchParams(previous); next.set("order", value); return next; });
        }} />
        {!queue ? (
          <p className="muted">Loading…</p>
        ) : (
          <p className="vision-footnote muted">
            {queue.waiting.identities} identity window(s) and {queue.waiting.events} event candidate(s) are waiting for someone who did not propose them
            {assetId ? " on this footage" : ""}. Yours are not listed: a second person decides those. {order === "confidence" ? "Lowest stored confidence first; equal scores use oldest first." : "Oldest first."} Confidence is a claim score, not measured accuracy. Each opens on the video at its moment, where <kbd>,</kbd> and <kbd>.</kbd> walk the rest in the chosen order.
            {queue.count < queue.waiting.identities + queue.waiting.events && ` Showing the first ${queue.count}.`}
            {assetId && (
              <>
                {" "}
                <Link to={`/admin/vision/review?order=${order}`}>Every piece of footage →</Link>
              </>
            )}
          </p>
        )}
      </Panel>

      {queue && queue.items.length === 0 && (
        <Panel title="Nothing waiting">
          <p className="muted">Every identity and event candidate someone else proposed has been decided{assetId ? " on this footage" : ""}.</p>
        </Panel>
      )}

      {queue && queue.items.length > 0 && (
        <Panel title="Review items">
          <div className="admin-sb-table-wrap">
            <table className="vision-table">
              <thead>
                <tr>
                  <th scope="col">Waiting since</th>
                  <th scope="col">Footage</th>
                  <th scope="col">Confidence</th>
                  <th scope="col">What</th>
                  <th scope="col">When</th>
                  <th scope="col">Proposed by</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {queue.items.map((item) => (
                  <tr key={`${item.kind}:${item.id}`}>
                    <td className="vision-sub">{formatWhen(item.createdAt)}</td>
                    <td>{item.asset.title ?? `Footage ${short(item.videoAssetId)}`}<div className="vision-sub muted">{item.asset.match}</div></td>
                    <td>{Math.round(item.confidence * 100)}%</td>
                    <td>
                      <Pill tone={item.kind === "event" ? "warn" : "muted"}>{item.kind}</Pill> {describeItem(item)}
                    </td>
                    <td className="vision-sub">
                      {item.matchClock ?? "off the clock"}
                      <div className="muted">{formatClock(item.sourceMs)} in the file</div>
                    </td>
                    <td className="vision-sub">
                      <code className="vision-mono">{short(item.decidedBy)}</code>
                    </td>
                    <td>
                      <Link to={linkFor(item, order)}>Open on the video →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}

/** `shot`, or `track #4 said to be #9 Nine, 12:00–15:00`. */
export function describeItem(item: VisionReviewQueueItem): string {
  if (item.kind === "event") return (item.type ?? "event").replace(/_/g, " ");
  const who = item.slot ? `#${item.slot.jerseyNumber ?? "—"} ${item.slot.name}` : item.matchSquadPlayerId ? "a roster slot" : "unknown";
  return `track #${item.localTrackId} said to be ${who}, ${formatClock(item.validFromMs ?? item.sourceMs)}–${formatClock(item.validToMs ?? item.sourceMs)}`;
}

/** Where the item is decided: the identity workstation, with the candidate or the track and the moment in the URL. */
export function linkFor(item: VisionReviewQueueItem, order?: ReviewQueueOrder): string {
  const base = `/admin/vision/workstation/identity/${item.videoAssetId}`;
  const query = new URLSearchParams(item.kind === "event" ? { event: item.id } : { track: item.trackId ?? "", at: String(item.sourceMs) });
  if (order) query.set("order", order);
  if (order && item.kind === "identity") query.set("review", item.id);
  return `${base}?${query}`;
}
