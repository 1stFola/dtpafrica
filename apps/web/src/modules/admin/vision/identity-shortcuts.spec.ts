import { describe, expect, it } from "vitest";
import { SHORTCUT_HELP, isTyping, shortcutOf } from "./identity-shortcuts";

const key = (k: string, over: Record<string, unknown> = {}) => ({ key: k, ...over });

describe("the identity workstation's keyboard map", () => {
  it("has every key docs/vision/08 lists", () => {
    expect(shortcutOf(key(" "))).toEqual({ kind: "play" });
    expect(shortcutOf(key("ArrowLeft"))).toEqual({ kind: "step", frames: -1, unit: "frame" });
    expect(shortcutOf(key("ArrowRight", { shiftKey: true }))).toEqual({ kind: "step", frames: 1, unit: "second" });
    expect(shortcutOf(key(","))).toEqual({ kind: "walkUncertain", direction: -1 });
    expect(shortcutOf(key("."))).toEqual({ kind: "walkUncertain", direction: 1 });
    expect(shortcutOf(key("["))).toEqual({ kind: "walkEvents", direction: -1 });
    expect(shortcutOf(key("]"))).toEqual({ kind: "walkEvents", direction: 1 });
    expect(shortcutOf(key("a"))).toEqual({ kind: "accept" });
    expect(shortcutOf(key("r"))).toEqual({ kind: "reject" });
    // The one the spec calls non-negotiable: unknown is one keystroke.
    expect(shortcutOf(key("u"))).toEqual({ kind: "unknown" });
    expect(shortcutOf(key("m"))).toEqual({ kind: "merge" });
    expect(shortcutOf(key("s"))).toEqual({ kind: "split" });
    expect(shortcutOf(key("e"))).toEqual({ kind: "propose" });
    expect(shortcutOf(key("?", { shiftKey: true }))).toEqual({ kind: "help" });
  });

  it("takes a letter in either case, and the digits one to nine as the first nine candidates", () => {
    expect(shortcutOf(key("U", { shiftKey: true }))).toEqual({ kind: "unknown" });
    expect(shortcutOf(key("E"))).toEqual({ kind: "propose" });
    expect(shortcutOf(key("1"))).toEqual({ kind: "pick", index: 0 });
    expect(shortcutOf(key("9"))).toEqual({ kind: "pick", index: 8 });
    expect(shortcutOf(key("0"))).toBeNull();
  });

  it("leaves the browser's and the system's shortcuts alone", () => {
    // Ctrl+E used to propose an event; Cmd+R reloads the page and must not also reject.
    for (const modifier of ["ctrlKey", "metaKey", "altKey"]) {
      for (const k of ["e", "u", "a", "r", "1", " ", "ArrowLeft", ".", "]"]) {
        expect(shortcutOf(key(k, { [modifier]: true })), `${modifier}+${k}`).toBeNull();
      }
    }
  });

  it("does not repeat a key that writes, however long it is held", () => {
    // Holding E filed a candidate per repeat.
    for (const k of ["e", "u", "a", "r", "m", "s", "1", "?", " "]) expect(shortcutOf(key(k, { repeat: true })), k).toBeNull();
    // Holding an arrow, or walking, is how a person scrubs.
    expect(shortcutOf(key("ArrowRight", { repeat: true }))).toEqual({ kind: "step", frames: 1, unit: "frame" });
    expect(shortcutOf(key(".", { repeat: true }))).toEqual({ kind: "walkUncertain", direction: 1 });
    expect(shortcutOf(key("]", { repeat: true }))).toEqual({ kind: "walkEvents", direction: 1 });
  });

  it("is silent while the person is typing", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT", "input"]) {
      expect(shortcutOf(key("u", { target: { tagName } }))).toBeNull();
      expect(isTyping({ tagName })).toBe(true);
    }
    expect(shortcutOf(key("u", { target: { tagName: "DIV", isContentEditable: true } }))).toBeNull();
    expect(shortcutOf(key("u", { target: { tagName: "BUTTON" } }))).toEqual({ kind: "unknown" });
    expect(shortcutOf(key("u", { target: null }))).toEqual({ kind: "unknown" });
  });

  it("leaves Space to a focused button, which it presses", () => {
    // It pressed the button and toggled play as well.
    for (const tagName of ["BUTTON", "SUMMARY", "A"]) expect(shortcutOf(key(" ", { target: { tagName } })), tagName).toBeNull();
    expect(shortcutOf(key(" ", { target: { tagName: "DIV" } }))).toEqual({ kind: "play" });
    expect(shortcutOf(key("ArrowLeft", { target: { tagName: "BUTTON" } }))).toEqual({ kind: "step", frames: -1, unit: "frame" });
  });

  it("ignores keys that mean nothing here", () => {
    for (const k of ["x", "Enter", "Tab", "Escape", "F5", "ArrowUp"]) expect(shortcutOf(key(k)), k).toBeNull();
  });

  it("lists in its help every kind of thing it does", () => {
    const text = SHORTCUT_HELP.map((h) => h.keys).join(" ");
    for (const k of ["Space", "←", ",", "[", "E", "U", "1", "A", "R", "S", "M", "?"]) expect(text, k).toContain(k);
  });
});
