/**
 * The live-feed switches as the server reads them, for the admin controls that show them.
 *
 * `readLiveFeature` on the API is the one that decides, and these two must agree with it:
 * every fixture is on the public feed unless an admin has switched that game off, and
 * commentary audio is off until somebody switches it on. An admin control that read the
 * stored JSON directly would show "Approve public live" for a match the public can already
 * see, and pressing it would switch the feed off while reading as though it switched it on.
 *
 * Approved is not the same as live. A game goes live when its recorder presses Kick off; the
 * switch only decides whether it may be shown at all.
 */
type LiveFeatureJson = {
  liveFeature?: { enabled?: boolean; audioEnabled?: boolean } | null;
} | null | undefined;

/** Whether this match may be shown on the public live feed. Default: yes. */
export function publicLiveApproved(stats: LiveFeatureJson): boolean {
  const enabled = stats?.liveFeature?.enabled;
  return typeof enabled === "boolean" ? enabled : true;
}

/** Whether live commentary audio is on. Default: no, and never while the feed is off. */
export function liveCommentaryApproved(stats: LiveFeatureJson): boolean {
  return publicLiveApproved(stats) && stats?.liveFeature?.audioEnabled === true;
}
