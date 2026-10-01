/**
 * Picking rows for a bulk action.
 *
 * The case worth the test is a selection outliving the filter that made it: an admin narrows to
 * one club, selects all, widens the filter and presses Delete. Whatever happens then had better
 * not be "and also the forty rows you selected a minute ago".
 */
import { describe, expect, it } from "vitest";
import {
  EMPTY_SELECTION,
  allVisibleSelected,
  isSelected,
  pruneToVisible,
  selectedInOrder,
  someVisibleSelected,
  toggle,
  toggleAllVisible,
} from "./row-selection";

const sel = (...ids: string[]) => new Set(ids);

describe("toggle", () => {
  it("adds a row that was not selected and removes one that was", () => {
    const once = toggle(EMPTY_SELECTION, "a");
    expect([...once]).toEqual(["a"]);
    expect([...toggle(once, "a")]).toEqual([]);
  });

  it("leaves the selection it was given alone", () => {
    /* React state: returning a mutated Set would not re-render, and would make two renders
       disagree about what is selected. */
    const before = sel("a");
    toggle(before, "b");
    expect([...before]).toEqual(["a"]);
  });
});

describe("isSelected", () => {
  it("says no for a row with no id to select it by", () => {
    /* A directory row with no squad row behind it. Its checkbox is disabled, and this is what
       keeps it unticked rather than reading as whatever `undefined` hashes to. */
    expect(isSelected(sel("a"), null)).toBe(false);
  });
});

describe("toggleAllVisible", () => {
  it("selects every visible row", () => {
    expect([...toggleAllVisible(EMPTY_SELECTION, ["a", "b", "c"])]).toEqual(["a", "b", "c"]);
  });

  it("clears them when they are all already selected", () => {
    expect([...toggleAllVisible(sel("a", "b"), ["a", "b"])]).toEqual([]);
  });

  it("fills the rest in when only some are selected", () => {
    expect([...toggleAllVisible(sel("a"), ["a", "b"])].sort()).toEqual(["a", "b"]);
  });

  it("keeps a selection made under another filter", () => {
    /* Two clubs filtered one at a time, then deleted together. Clearing the visible rows must
       not clear the ones the admin cannot currently see but chose on purpose. */
    expect([...toggleAllVisible(sel("other"), ["a", "b"])].sort()).toEqual([
      "a",
      "b",
      "other",
    ]);
    expect([...toggleAllVisible(sel("other", "a"), ["a"])]).toEqual(["other"]);
  });
});

describe("allVisibleSelected", () => {
  it("is false for an empty table", () => {
    /* `[].every(...)` is true, which would tick the header box over no rows at all. */
    expect(allVisibleSelected(EMPTY_SELECTION, [])).toBe(false);
    expect(allVisibleSelected(sel("a"), [])).toBe(false);
  });

  it("is true only when every visible row is in", () => {
    expect(allVisibleSelected(sel("a", "b"), ["a", "b"])).toBe(true);
    expect(allVisibleSelected(sel("a"), ["a", "b"])).toBe(false);
  });
});

describe("someVisibleSelected", () => {
  it("marks a partial selection and nothing else", () => {
    expect(someVisibleSelected(sel("a"), ["a", "b"])).toBe(true);
    expect(someVisibleSelected(sel("a", "b"), ["a", "b"])).toBe(false);
    expect(someVisibleSelected(EMPTY_SELECTION, ["a", "b"])).toBe(false);
  });
});

describe("pruneToVisible", () => {
  it("drops what the filter no longer shows", () => {
    /* The guarantee: a bulk action can only ever reach rows the admin can see. */
    expect([...pruneToVisible(sel("a", "gone"), ["a", "b"])]).toEqual(["a"]);
  });

  it("returns the same selection when nothing was dropped", () => {
    /* Identity, so a React setter given this does not render for a filter change that
       selected nothing. */
    const before = sel("a");
    expect(pruneToVisible(before, ["a", "b"])).toBe(before);
    expect(pruneToVisible(EMPTY_SELECTION, [])).toBe(EMPTY_SELECTION);
  });

  it("empties a selection when the filter shows nothing", () => {
    expect([...pruneToVisible(sel("a", "b"), [])]).toEqual([]);
  });
});

describe("selectedInOrder", () => {
  it("returns the selected ids in the order they are on screen", () => {
    /* Bulk actions run in this order and report failures against it, so a result list reads
       down the table rather than in whatever order the checkboxes were clicked. */
    expect(selectedInOrder(sel("c", "a"), ["a", "b", "c"])).toEqual(["a", "c"]);
  });
});
