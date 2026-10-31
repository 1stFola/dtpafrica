/*
 * What the console says about each Edge alert, and which ones wait for an Edge admin (F25;
 * docs/fairplay/runbook.md has the full table). The Edge decides; this only words it.
 */

/** Alerts that wait for a person: as `ACKNOWLEDGED_ALERTS` in the Edge's api.py. */
export const ACKNOWLEDGED = ["publisher_address_changed", "segment_partial", "segment_corrupt", "segment_missing",
  "segment_mismatch", "evidence_mismatch", "outbox_parked"] as const;

const WORDS: Record<string, string> = {
  publisher_address_changed: "Publishing from a new address: someone else may be sending this feed. Check the camera before trusting new footage.",
  source_disconnected: "No feed from this camera.",
  recording_stalled: "Connected, but nothing is being written.",
  segment_partial: "A recording file ended mid-write (a drop or restart). It can be repaired; acknowledge once noted.",
  segment_corrupt: "A recording file holds no readable footage: that time is lost. Acknowledge once noted.",
  segment_missing: "A recorded file has gone from the disk. Report it, then acknowledge.",
  segment_mismatch: "A recording file no longer matches its hash: do not use it as evidence. Report it, then acknowledge.",
  segment_video_gap: "Pictures are missing at the start of a recording file.",
  evidence_mismatch: "An evidence clip no longer matches its hash: cut it again. Report it, then acknowledge.",
  outbox_parked: "The cloud refused some sync items; they are kept. An Edge admin checks them, then acknowledges.",
  restore_unchecked: "This Edge was restored from a backup. No clip can be viewed, approved, exported or uploaded until it has asked the cloud what was withdrawn since. Connect it to the internet; with no cloud to ask, an Edge admin decides (docs/fairplay/edge-backup.md).",
};

export function alertWords(kind: string): string {
  return WORDS[kind] ?? kind.replaceAll("_", " ");
}

export function waitsForAdmin(kind: string): boolean {
  return (ACKNOWLEDGED as readonly string[]).includes(kind);
}
