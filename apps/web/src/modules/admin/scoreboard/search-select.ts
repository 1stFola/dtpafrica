/**
 * Matching for the type-to-search pickers on the records page.
 *
 * The merge dialogs used to offer a plain <select> holding every player or team
 * there is, so finding one meant scrolling through thousands. Here the admin
 * types, and every word they type has to appear somewhere in the option's name
 * or its context (club, competition), in any order and ignoring case, accents,
 * punctuation and spacing. Closer name matches come first.
 */
export type SearchOption = {
  id: string;
  label: string;
  /** Club, competition or source, shown under the name and searched too. */
  detail?: string;
  /** A short tag, e.g. "Same competition". */
  badge?: string;
};

export function searchKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function filterSearchOptions<T extends SearchOption>(
  options: T[],
  query: string,
  limit = 50
): T[] {
  const needle = searchKey(query);
  if (!needle) return options.slice(0, limit);
  const words = needle.split(" ");

  const ranked: Array<{ option: T; rank: number; order: number }> = [];
  options.forEach((option, order) => {
    const label = searchKey(option.label);
    const haystack = `${label} ${searchKey(option.detail ?? "")}`;
    /* Spacing is not a difference either: "box2box" finds "Box 2 Box FC". */
    const compact = haystack.replace(/ /g, "");
    if (!words.every((w) => haystack.includes(w) || compact.includes(w))) return;
    const rank =
      label === needle
        ? 0
        : label.startsWith(needle)
          ? 1
          : words.every((w) => label.includes(w))
            ? 2
            : 3;
    ranked.push({ option, rank, order });
  });
  ranked.sort((a, b) => a.rank - b.rank || a.order - b.order);
  return ranked.slice(0, limit).map((r) => r.option);
}
