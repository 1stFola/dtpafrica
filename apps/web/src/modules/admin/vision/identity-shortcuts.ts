/**
 * The identity workstation's keyboard map, as a function of the key event alone,
 * so it can be tested without a browser.
 *
 * docs/vision/08 § Keyboard map is the list. Three things about it were wrong on
 * the page (docs/vision/50, appendix D): `U`, the one the spec calls
 * non-negotiable, and `1`-`9`, `A`, `R`, `M`, `S` and `?` were missing; every
 * shortcut also fired under Ctrl, Cmd and Alt, so Ctrl+E proposed an event; and a
 * held key repeated, so holding `E` filed a candidate per repeat.
 *
 * Keys that move the playhead may repeat: holding an arrow steps through frames.
 * Keys that write something may not.
 */

export type Shortcut =
  | { kind: "play" }
  | { kind: "step"; frames: number; unit: "frame" | "second" }
  | { kind: "walkEvents"; direction: 1 | -1 }
  | { kind: "walkUncertain"; direction: 1 | -1 }
  | { kind: "propose" }
  | { kind: "unknown" }
  | { kind: "pick"; index: number }
  | { kind: "accept" }
  | { kind: "reject" }
  | { kind: "merge" }
  | { kind: "split" }
  | { kind: "help" };

export type KeyLike = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
  target?: { tagName?: string; isContentEditable?: boolean } | null;
};

const TYPING = new Set(["INPUT", "TEXTAREA", "SELECT"]);
/** Things Space presses. With one focused, Space is that press, not play and pause as well. */
const PRESSABLE = new Set(["BUTTON", "SUMMARY", "A"]);

/** Whether the keystroke belongs to something the person is typing into. */
export function isTyping(target: KeyLike["target"]): boolean {
  if (!target) return false;
  return TYPING.has(String(target.tagName ?? "").toUpperCase()) || target.isContentEditable === true;
}

export function shortcutOf(event: KeyLike): Shortcut | null {
  if (isTyping(event.target)) return null;
  // A browser or system shortcut is not ours: Ctrl+E, Cmd+R, Alt+anything.
  if (event.ctrlKey || event.metaKey || event.altKey) return null;

  // The playhead: these may repeat.
  switch (event.key) {
    case " ":
      if (PRESSABLE.has(String(event.target?.tagName ?? "").toUpperCase())) return null;
      return event.repeat ? null : { kind: "play" };
    case "ArrowLeft":
      return { kind: "step", frames: -1, unit: event.shiftKey ? "second" : "frame" };
    case "ArrowRight":
      return { kind: "step", frames: 1, unit: event.shiftKey ? "second" : "frame" };
    case "[":
      return { kind: "walkEvents", direction: -1 };
    case "]":
      return { kind: "walkEvents", direction: 1 };
    case ",":
      return { kind: "walkUncertain", direction: -1 };
    case ".":
      return { kind: "walkUncertain", direction: 1 };
    default:
  }

  // Everything below writes, or opens something: once per press.
  if (event.repeat) return null;
  if (event.key === "?") return { kind: "help" };
  if (/^[1-9]$/.test(event.key)) return { kind: "pick", index: Number(event.key) - 1 };
  switch (event.key.toLowerCase()) {
    case "e":
      return { kind: "propose" };
    case "u":
      return { kind: "unknown" };
    case "a":
      return { kind: "accept" };
    case "r":
      return { kind: "reject" };
    case "m":
      return { kind: "merge" };
    case "s":
      return { kind: "split" };
    default:
      return null;
  }
}

/** The map as a person reads it, for the `?` panel. Kept beside the function so the two cannot drift. */
export const SHORTCUT_HELP: readonly { keys: string; does: string }[] = [
  { keys: "Space", does: "Play or pause" },
  { keys: "← →", does: "One frame back or on; with Shift, one second" },
  { keys: ", .", does: "The previous or next thing waiting for you to decide" },
  { keys: "[ ]", does: "The previous or next event candidate" },
  { keys: "E", does: "Propose an event at the playhead" },
  { keys: "U", does: "Mark the selected track unknown, over the whole track" },
  { keys: "1 – 9", does: "Assign the selected track to that candidate in the list, over the whole track" },
  { keys: "A", does: "Accept what is selected: the event, or else the track's waiting identity" },
  { keys: "R", does: "Reject it; a reason is needed, so R goes to the reason box when it is empty" },
  { keys: "S", does: "Split at the playhead: the chosen candidate up to here" },
  { keys: "M", does: "Open Merge, to say the same person is on other tracks" },
  { keys: "?", does: "Show or hide this list" },
];
