/**
 * Picking rows to act on in bulk.
 *
 * The rule that makes this worth its own module is what happens when the filter moves. A
 * selection is made against what was on screen, so "select all" means *all of these*, not all
 * of everything — and a row that scrolls out of the filter must leave the selection with it.
 * Otherwise an admin narrows to one club, presses Delete Selected, and takes forty rows from
 * the club they were looking at a moment ago. `pruneToVisible` is the whole of that guarantee,
 * and the reason the state lives here rather than in a `useState` nobody can test.
 *
 * Pure and DOM-free, so it is tested the way `vitest.config.ts` says the web tests work.
 */

/** Selected ids. A `Set` because the row checkboxes ask "is this one in?" once per row. */
export type Selection = ReadonlySet<string>;

export const EMPTY_SELECTION: Selection = new Set<string>();

export function isSelected(selection: Selection, id: string | null): boolean {
  return id != null && selection.has(id);
}

export function toggle(selection: Selection, id: string): Selection {
  const next = new Set(selection);
  if (!next.delete(id)) next.add(id);
  return next;
}

/**
 * Select every visible row, or clear them, by what is already selected.
 *
 * Only the visible ids are touched. A selection made under one filter survives a trip through
 * another as long as those rows come back -- which is how somebody picks two teams from one
 * club and three from another before deleting.
 */
export function toggleAllVisible(selection: Selection, visibleIds: readonly string[]): Selection {
  const next = new Set(selection);
  if (allVisibleSelected(selection, visibleIds)) {
    for (const id of visibleIds) next.delete(id);
    return next;
  }
  for (const id of visibleIds) next.add(id);
  return next;
}

/**
 * Whether the header checkbox should read as checked.
 *
 * An empty table is not "all selected": the box would show ticked over nothing, and pressing it
 * would appear to do nothing at all.
 */
export function allVisibleSelected(selection: Selection, visibleIds: readonly string[]): boolean {
  return visibleIds.length > 0 && visibleIds.every((id) => selection.has(id));
}

/** Whether some but not all visible rows are selected, for the indeterminate box. */
export function someVisibleSelected(selection: Selection, visibleIds: readonly string[]): boolean {
  return visibleIds.some((id) => selection.has(id)) && !allVisibleSelected(selection, visibleIds);
}

/**
 * Drop anything the current filter does not show.
 *
 * Returns the same `Selection` when nothing changed, so a React state setter given this does
 * not start a render for a filter change that selected nothing.
 */
export function pruneToVisible(selection: Selection, visibleIds: readonly string[]): Selection {
  if (selection.size === 0) return selection;
  const visible = new Set(visibleIds);
  let dropped = false;
  const next = new Set<string>();
  for (const id of selection) {
    if (visible.has(id)) next.add(id);
    else dropped = true;
  }
  return dropped ? next : selection;
}

/** The selected ids in the order they appear on screen, which is the order they are acted on. */
export function selectedInOrder(selection: Selection, visibleIds: readonly string[]): string[] {
  return visibleIds.filter((id) => selection.has(id));
}
