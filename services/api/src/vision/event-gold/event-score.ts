import { MAX_GOLD_EVENTS, validateEventGoldLabels, type EventGoldLabels, type GoldEvent } from "@dtp/vision-contracts";

export const EVENT_SCORER_VERSION = "event-score/v1";
export type EventPrediction = GoldEvent & { inPlay: boolean };
const ratio = (n: number, d: number) => d ? n / d : null;

/** Rectangular minimum-cost assignment; dummy columns allow unmatched reference events. */
function assignment(cost: number[][]): number[] {
  const rows = cost.length;
  if (!rows) return [];
  const columns = cost[0]!.length;
  const u = Array(rows + 1).fill(0) as number[], v = Array(columns + 1).fill(0) as number[];
  const p = Array(columns + 1).fill(0) as number[], way = Array(columns + 1).fill(0) as number[];
  for (let i = 1; i <= rows; i++) {
    p[0] = i;
    let j0 = 0;
    const min = Array(columns + 1).fill(Infinity) as number[], used = Array(columns + 1).fill(false) as boolean[];
    do {
      used[j0] = true;
      const i0 = p[j0]!;
      let delta = Infinity, j1 = 0;
      for (let j = 1; j <= columns; j++) if (!used[j]) {
        const next = cost[i0 - 1]![j - 1]! - u[i0]! - v[j]!;
        if (next < min[j]!) { min[j] = next; way[j] = j0; }
        if (min[j]! < delta) { delta = min[j]!; j1 = j; }
      }
      for (let j = 0; j <= columns; j++) {
        if (used[j]) { u[p[j]!]! += delta; v[j]! -= delta; } else min[j]! -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const previous = way[j0]!; p[j0] = p[previous]!; j0 = previous; } while (j0 !== 0);
  }
  const result = Array(rows).fill(-1) as number[];
  for (let j = 1; j <= columns; j++) if (p[j]) result[p[j]! - 1] = j - 1;
  return result;
}

/** Maximise one-to-one matches, then minimise boundary error. Actors never influence matching. */
export function scoreEvents(gold: EventGoldLabels, predictions: readonly EventPrediction[], toleranceMs: number) {
  if (!Number.isSafeInteger(toleranceMs) || toleranceMs < 0 || toleranceMs > 10_000) throw new Error("Temporal tolerance must be an integer between 0 and 10000ms.");
  if (gold.events.length > MAX_GOLD_EVENTS || predictions.length > MAX_GOLD_EVENTS) throw new Error("Split the scoring window: at most 200 reference events and 200 predictions.");
  if (new Set(predictions.map((row) => row.id)).size !== predictions.length) throw new Error("Prediction IDs must be unique.");
  const window = { startMs: 0, endMs: Number.MAX_SAFE_INTEGER };
  if (!validateEventGoldLabels(gold, window).labels || !validateEventGoldLabels({ events: predictions, nonPlayWindows: [] }, window).labels || predictions.some((row) => typeof row.inPlay !== "boolean")) throw new Error("Invalid event evidence: use supported types, finite source milliseconds and explicit actor / play state.");
  const refs = [...gold.events].sort((a, b) => a.id.localeCompare(b.id));
  const active = predictions.filter((row) => row.inPlay).sort((a, b) => a.id.localeCompare(b.id));
  const eligible = (a: GoldEvent, b: GoldEvent) => a.type === b.type && Math.abs(a.startMs - b.startMs) <= toleranceMs && Math.abs(a.endMs - b.endMs) <= toleranceMs;
  const penalty = 2 * refs.length + 1;
  const cost = refs.map((ref) => [...active.map((pred) => eligible(ref, pred) ? (Math.abs(ref.startMs - pred.startMs) + Math.abs(ref.endMs - pred.endMs)) / (toleranceMs + 1) : penalty * 3), ...refs.map(() => penalty)]);
  const selected = assignment(cost);
  const pairs = refs.flatMap((ref, index) => {
    const pred = active[selected[index]!];
    if (!pred || !eligible(ref, pred)) return [];
    return [{ referenceId: ref.id, predictionId: pred.id, type: ref.type, startErrorMs: Math.abs(ref.startMs - pred.startMs), endErrorMs: Math.abs(ref.endMs - pred.endMs), actorCorrect: ref.actorMatchSquadPlayerId === null ? null : ref.actorMatchSquadPlayerId === pred.actorMatchSquadPlayerId }];
  });
  const matchedRefs = new Set(pairs.map((row) => row.referenceId)), matchedPreds = new Set(pairs.map((row) => row.predictionId));
  const missed = refs.filter((row) => !matchedRefs.has(row.id));
  const falsePositives = active.filter((row) => !matchedPreds.has(row.id));
  const types = [...new Set([...refs, ...active].map((row) => row.type))].sort();
  const metricsFor = (type: string | null) => {
    const reference = refs.filter((row) => type === null || row.type === type);
    const predicted = active.filter((row) => type === null || row.type === type);
    const matches = pairs.filter((row) => type === null || row.type === type);
    const tp = matches.length, fp = predicted.length - tp, fn = reference.length - tp;
    const known = matches.filter((row) => row.actorCorrect !== null), correct = known.filter((row) => row.actorCorrect).length;
    return { reference: reference.length, predictions: predicted.length, tp, fp, fn, precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn), f1: ratio(2 * tp, 2 * tp + fp + fn),
      matchedKnownActors: known.length, correctActors: correct, actorAccuracy: ratio(correct, known.length), actorRecall: ratio(correct, reference.filter((row) => row.actorMatchSquadPlayerId !== null).length),
      meanStartErrorMs: ratio(matches.reduce((sum, row) => sum + row.startErrorMs, 0), matches.length), meanEndErrorMs: ratio(matches.reduce((sum, row) => sum + row.endErrorMs, 0), matches.length) };
  };
  const nonPlayErrors = gold.nonPlayWindows.map((range) => ({ ...range, predictionIds: active.filter((row) => row.startMs >= range.startMs && row.startMs < range.endMs).map((row) => row.id) }));
  return { scorerVersion: EVENT_SCORER_VERSION, toleranceMs, all: metricsFor(null), byType: types.map((type) => ({ type, ...metricsFor(type) })), pairs,
    missedReferenceIds: missed.map((row) => row.id), falsePositiveIds: falsePositives.map((row) => row.id), suppressedPredictionIds: predictions.filter((row) => !row.inPlay).map((row) => row.id),
    duplicatePredictionIds: falsePositives.filter((pred) => refs.some((ref) => eligible(ref, pred))).map((row) => row.id), nonPlayErrors };
}
