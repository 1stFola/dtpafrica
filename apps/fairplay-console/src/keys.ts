/*
 * Keyboard shortcuts. Every one has a button too: the keyboard is a faster way, never the
 * only way (PID §9). Ignored while typing in a field.
 */

export type Action =
  | "togglePlay"
  | "back10"
  | "back30"
  | "back60"
  | "nudgeBack"
  | "nudgeForward"
  | "cycleSpeed"
  | "flag"
  | "latestIncident"
  | "live"
  | "source:ground"
  | "source:drone"
  | "source:programme"
  | "help";

export const SHORTCUTS: { key: string; label: string; action: Action }[] = [
  { key: " ", label: "Space", action: "togglePlay" },
  { key: "ArrowLeft", label: "← or 1", action: "back10" },
  { key: "1", label: "1", action: "back10" },
  { key: "2", label: "2", action: "back30" },
  { key: "3", label: "3", action: "back60" },
  { key: ",", label: ",", action: "nudgeBack" },
  { key: ".", label: ".", action: "nudgeForward" },
  { key: "s", label: "S", action: "cycleSpeed" },
  { key: "f", label: "F", action: "flag" },
  { key: "i", label: "I", action: "latestIncident" },
  { key: "l", label: "L", action: "live" },
  { key: "g", label: "G", action: "source:ground" },
  { key: "d", label: "D", action: "source:drone" },
  { key: "p", label: "P", action: "source:programme" },
  { key: "?", label: "?", action: "help" },
];

const TYPING = new Set(["INPUT", "TEXTAREA", "SELECT"]);

export function actionFor(event: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; target?: EventTarget | null }): Action | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const target = event.target as { tagName?: string; isContentEditable?: boolean } | null;
  if (target && (TYPING.has(target.tagName ?? "") || target.isContentEditable)) return null;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  return SHORTCUTS.find((s) => s.key === key)?.action ?? null;
}

/** 0.25× is offered only when measured on this device; see measureSlowRate in replay.ts. */
export function nextSpeed(current: number, allowQuarter: boolean): number {
  const speeds = allowQuarter ? [1, 0.5, 0.25] : [1, 0.5];
  const i = speeds.indexOf(current);
  return speeds[(i + 1) % speeds.length] ?? 1;
}
