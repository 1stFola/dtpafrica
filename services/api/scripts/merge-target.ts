/**
 * Which of two records for one person survives a merge.
 *
 * This is the only judgement in the whole merge, and it is worth separating and
 * testing because the merge itself is mechanical: everything moves to the target
 * and the source is deleted. Choose wrong and the survivor is the emptier record —
 * no photo, no academy, a slug nobody has linked to — while the one people have
 * been visiting disappears.
 *
 * In order:
 *
 *   1. **A real profile wins.** A photo or an academy means somebody filled this
 *      record in deliberately. The other was made by an import that could not find
 *      it.
 *   2. **Then the canonical slug.** `/jimoh-rasheed` over `/jimoh-rasheed-1`: the
 *      suffix is what `resolveUniquePlayerSlug` adds when the name is already
 *      taken, so it marks the copy. It is also the URL anyone has ever shared.
 *   3. **Then the one carrying history**, so fewer rows have to move.
 *   4. **Then the older record**, and finally the lower id — not because either is
 *      better, but so the answer does not depend on the order rows come back in.
 *      A tool that picks differently each run is one nobody can check.
 *
 * Deliberately *not* a rule: the tidier-looking display name. `JIMOH RASHEED` and
 * `Jimoh Rasheed` are the same person and the casing says nothing about which
 * record people use. Fixing the name afterwards is one edit; merging into the
 * wrong record is not.
 */

export type MergeCandidate = {
  id: string;
  displayName: string;
  slug: string;
  hasProfile: boolean;
  events: number;
  createdAt: Date;
};

export type MergeChoice = {
  target: MergeCandidate;
  sources: MergeCandidate[];
  why: string;
};

/** A slug the uniqueness resolver had to suffix, so a record already held the name. */
export function isSuffixedSlug(slug: string): boolean {
  return /-\d+$/.test(slug);
}

export function chooseMergeTarget(candidates: MergeCandidate[]): MergeChoice {
  const ranked = [...candidates].sort(
    (a, b) =>
      Number(b.hasProfile) - Number(a.hasProfile) ||
      Number(isSuffixedSlug(a.slug)) - Number(isSuffixedSlug(b.slug)) ||
      b.events - a.events ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id.localeCompare(b.id)
  );

  const target = ranked[0]!;
  const rest = ranked.slice(1);
  const why = target.hasProfile && !rest.some((r) => r.hasProfile)
    ? "the only one with a real profile"
    : !isSuffixedSlug(target.slug) && rest.every((r) => isSuffixedSlug(r.slug))
      ? `keeps /${target.slug}; the others are suffixed copies`
      : target.events > (rest[0]?.events ?? -1)
        ? `carries ${target.events} event(s), the others ${rest.map((r) => r.events).join("/")}`
        : "nothing to choose between them, so the older record survives";

  return { target, sources: rest, why };
}
