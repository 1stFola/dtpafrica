/**
 * What the Vision gates name their fixtures, and nothing wider.
 *
 * Separated from `purge-vision-gate-litter.ts` and tested, because these patterns
 * *are* the safety mechanism. The script deletes rows from whatever database it is
 * pointed at, and the only thing standing between it and real data is whether a name
 * matches. That deserves tests rather than care.
 *
 * Every pattern is anchored and ends in a gate's run id — `randomUUID().slice(0, 8)`,
 * so eight lowercase hex characters. A `contains` match is safe *inside* a gate,
 * which knows its own run id, and dangerous here: `gold benchmark for Lagos 2027` is
 * somebody's dataset, and it shares a prefix with the gate's.
 *
 * `prefix` is what Prisma can filter on — it has no regex — so candidates are fetched
 * by prefix and then held against `pattern` in JavaScript. The prefix is deliberately
 * the looser of the two: it only decides what gets *considered*.
 */

/** A gate run id: eight lowercase hex characters. */
const RUN = "[0-9a-f]{8}";

export type NamePattern = { prefix: string; pattern: RegExp };

/** Dataset version labels the gate's sections create. */
export const VERSION_LABELS: NamePattern[] = [
  { prefix: "gate-", pattern: new RegExp(`^gate-${RUN}-(v1|v2|bad|bad2|export)$`) },
  { prefix: "gold benchmark ", pattern: new RegExp(`^gold benchmark ${RUN}$`) },
  { prefix: "trains on gold ", pattern: new RegExp(`^trains on gold ${RUN}$`) },
];

/** Label schema versions the gates publish for their own tasks. */
export const SCHEMA_VERSIONS: NamePattern[] = [
  { prefix: "gate-gold-", pattern: new RegExp(`^gate-gold-${RUN}$`) },
  { prefix: "gate-export-", pattern: new RegExp(`^gate-export-${RUN}$`) },
  { prefix: "gate-", pattern: new RegExp(`^gate-${RUN}-schema$`) },
];

/** Reviewer ids the gate signs its own verdicts with. */
export const REVIEWER_IDS: NamePattern[] = [
  { prefix: "gate-reviewer-", pattern: new RegExp(`^gate-reviewer(-one|-two)?-${RUN}$`) },
];

/**
 * The partner a gate builds its fixture under.
 *
 * Matched on the placeholder contact address **and** a run-id name. Either alone is
 * too broad: a real partner can be called anything, and an address is not a name.
 * Only `vision:datasetcheck`, `vision:annotationcheck`, `vision:modelcheck`,
 * `vision:boxcheck`, `vision:benchcheck` and `vision:promotioncheck` use this
 * address; the other gates name their partners after real-looking clubs and clean
 * up after themselves.
 */
export const GATE_PARTNER = {
  contactEmail: "gate@example.test",
  pattern: new RegExp(`^(Dataset|Annotation|Model registry|Boxes|Benchmark|Promotion|Tracks|Track metrics|Teams) gate ${RUN}$`),
};

/** Whether a name is one a gate generated, rather than one a person chose. */
export function isGateName(name: string | null | undefined, patterns: NamePattern[]): boolean {
  if (!name) return false;
  return patterns.some((p) => p.pattern.test(name));
}

/** The distinct prefixes to ask the database for. */
export function prefixesOf(patterns: NamePattern[]): string[] {
  return [...new Set(patterns.map((p) => p.prefix))];
}
