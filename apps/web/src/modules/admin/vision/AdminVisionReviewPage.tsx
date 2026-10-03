import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fetchVisionReviewQueue, type VisionReviewQueue, type VisionReviewQueueItem } from "../../../api/vision";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { useAdminVisionContext } from "./AdminVisionLayout";
import { formatClock } from "./annotation-time";
import { Panel, Pill, formatWhen, short } from "./vision-ui";

/**
 * The review queue: what this person should look at next, across every piece
 * of footage, oldest first, their own proposals left out. Each item opens on
 * the video at its moment, where the decision is made; the queue itself decides
 * nothing. `,` and `.` on the workstation walk the same list on one asset.
 */
export function AdminVisionReviewPage() {
  usePageTitle("Review queue");
  const { refreshOverview } = useAdminVisionContext();
  const [params] = useSearchParams();
  const assetId = params.get("asset") ?? "";
  const [queue, setQueue] = useState<VisionReviewQueue | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setQueue(await fetchVisionReviewQueue({ assetId: assetId || undefined, limit: 200 }));
      await refreshOverview();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [assetId, refreshOverview]);

  useEffect(() => {
    void load();
  }, [load]);

  /* Grouped by footage in queue order, so the longest-waiting footage is first. */
  const groups = useMemo(() => {
    const out: { videoAssetId: string; title: string; match: string | null; items: VisionReviewQueueItem[] }[] = [];
    for (const item of queue?.items ?? []) {
      let g = out.find((x) => x.videoAssetId === item.videoAssetId);
      if (!g) {
        g = { videoAssetId: item.videoAssetId, title: item.asset.title ?? `footage ${short(item.videoAssetId)}`, match: item.asset.match, items: [] };
        out.push(g);
      }
      g.items.push(item);
    }
    return out;
  }, [queue]);

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
        {!queue ? (
          <p className="muted">Loading…</p>
        ) : (
          <p className="vision-footnote muted">
            {queue.waiting.identities} identity window(s) and {queue.waiting.events} event candidate(s) are waiting for someone who did not propose them
            {assetId ? " on this footage" : ""}. Yours are not listed: a second person decides those. Oldest first; each opens on the video at its moment, where <kbd>,</kbd> and <kbd>.</kbd> walk the rest.
            {queue.count < queue.waiting.identities + queue.waiting.events && ` Showing the first ${queue.count}.`}
            {assetId && (
              <>
                {" "}
                <Link to="/admin/vision/review">Every piece of footage →</Link>
              </>
            )}
          </p>
        )}
      </Panel>

      {queue && groups.length === 0 && (
        <Panel title="Nothing waiting">
          <p className="muted">Every identity and event candidate someone else proposed has been decided{assetId ? " on this footage" : ""}.</p>
        </Panel>
      )}

      {groups.map((g) => (
        <Panel key={g.videoAssetId} title={`${g.title}${g.match ? ` · ${g.match}` : ""}`}>
          <div className="admin-sb-table-wrap">
            <table className="vision-table">
              <thead>
                <tr>
                  <th scope="col">Waiting since</th>
                  <th scope="col">What</th>
                  <th scope="col">When</th>
                  <th scope="col">Proposed by</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {g.items.map((item) => (
                  <tr key={`${item.kind}:${item.id}`}>
                    <td className="vision-sub">{formatWhen(item.createdAt)}</td>
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
                      <Link to={linkFor(item)}>Open on the video →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ))}
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
export function linkFor(item: VisionReviewQueueItem): string {
  const base = `/admin/vision/workstation/identity/${item.videoAssetId}`;
  if (item.kind === "event") return `${base}?event=${item.id}`;
  return `${base}?track=${item.trackId}&at=${item.sourceMs}`;
}
