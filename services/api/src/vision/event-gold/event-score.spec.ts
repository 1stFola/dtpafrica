import { describe, expect, it } from "vitest";
import type { EventGoldLabels, GoldEvent } from "@dtp/vision-contracts";
import { scoreEvents, type EventPrediction } from "./event-score";
const label = (id: string, startMs: number, actor: string | null = null): GoldEvent => ({ id, type: "shot", startMs, endMs: startMs, actorMatchSquadPlayerId: actor });
const pred = (id: string, startMs: number, actor: string | null = null): EventPrediction => ({ ...label(id, startMs, actor), inPlay: true });
const gold = (...events: GoldEvent[]): EventGoldLabels => ({ events, nonPlayWindows: [] });
describe("event scoring", () => {
  it("matches once per event and reports extra duplicates rather than inflating recall", () => {
    const result = scoreEvents(gold(label("g", 100)), [pred("p", 100), pred("duplicate", 110)], 20);
    expect(result.all).toMatchObject({ tp: 1, fp: 1, fn: 0, precision: 0.5, recall: 1, f1: 2 / 3 });
    expect(result.duplicatePredictionIds).toHaveLength(1);
  });
  it("maximises matches instead of taking the nearest candidate greedily", () => {
    const result = scoreEvents(gold(label("g1", 100), label("g2", 200)), [pred("p1", 150), pred("p2", 60)], 60);
    expect(result.all.tp).toBe(2);
    expect(result.pairs.map((pair) => [pair.referenceId, pair.predictionId])).toEqual([["g1", "p2"], ["g2", "p1"]]);
  });
  it("requires compatible types and both boundaries within the fixed tolerance", () => {
    const result = scoreEvents(gold({ ...label("g", 100), endMs: 300 }), [{ ...pred("p", 100), endMs: 401 }, { ...pred("wrong-type", 100), endMs: 300, type: "pass" }], 100);
    expect(result.all).toMatchObject({ tp: 0, fp: 2, fn: 1, precision: 0, recall: 0 });
    expect(scoreEvents(gold(label("g", 100)), [pred("p", 200)], 100).all.tp).toBe(1);
  });
  it("measures actor error after temporal matching and excludes unknown reference actors", () => {
    const result = scoreEvents(gold(label("known", 100, "slot-1"), label("unknown", 500)), [pred("known-p", 100), pred("unknown-p", 500, "slot-2")], 0);
    expect(result.all).toMatchObject({ tp: 2, matchedKnownActors: 1, correctActors: 0, actorAccuracy: 0, actorRecall: 0 });
    expect(result.pairs.find((pair) => pair.referenceId === "unknown")?.actorCorrect).toBeNull();
    expect(scoreEvents(gold(label("unknown", 100)), [pred("p", 100)], 0).all.actorAccuracy).toBeNull();
  });
  it("penalises unsuppressed replay proposals and reports suppression separately", () => {
    const refs = { events: [], nonPlayWindows: [{ startMs: 100, endMs: 300, kind: "replay" as const }] };
    const result = scoreEvents(refs, [pred("replay-error", 100), { ...pred("suppressed", 150), inPlay: false }, pred("at-end", 300)], 0);
    expect(result.all.fp).toBe(2);
    expect(result.suppressedPredictionIds).toEqual(["suppressed"]);
    expect(result.nonPlayErrors[0]?.predictionIds).toEqual(["replay-error"]);
  });
  it("reports absent support as null and refuses unsupported inputs rather than dropping rows", () => {
    expect(scoreEvents(gold(), [], 500).all).toMatchObject({ precision: null, recall: null, f1: null, actorAccuracy: null, meanStartErrorMs: null });
    expect(() => scoreEvents(gold(), [pred("p", 0), pred("p", 0)], 0)).toThrow("unique");
    expect(() => scoreEvents(gold(), Array.from({ length: 201 }, (_, i) => pred(String(i), i)), 0)).toThrow("Split");
    expect(() => scoreEvents(gold(), [], NaN)).toThrow("tolerance");
    expect(() => scoreEvents(gold(), [{ ...pred("bad", 0), endMs: Infinity }], 0)).toThrow("Invalid event evidence");
  });
  it("is stable under input permutation and uses timing rather than actor agreement to choose a pair", () => {
    const refs = gold(label("g", 100, "slot"));
    const candidates = [pred("far-correct", 110, "slot"), pred("near-wrong", 100, "wrong")];
    const result = scoreEvents(refs, candidates, 20);
    expect(result.pairs[0]?.predictionId).toBe("near-wrong");
    expect(result.all.actorAccuracy).toBe(0);
    expect(scoreEvents(refs, [...candidates].reverse(), 20)).toEqual(result);
  });
  it("agrees with exhaustive maximum-cardinality / minimum-error matching on small random cases", () => {
    let seed = 11; const random = () => { seed = (seed * 16807) % 2147483647; return seed % 300; };
    for (let sample = 0; sample < 100; sample++) {
      const refs = Array.from({ length: 3 }, (_, i) => label(`g${i}`, random()));
      const candidates = Array.from({ length: 3 }, (_, i) => pred(`p${i}`, random()));
      let bestCount = -1, bestError = Infinity;
      const visit = (index: number, used: Set<number>, count: number, error: number) => {
        if (index === refs.length) { if (count > bestCount || (count === bestCount && error < bestError)) { bestCount = count; bestError = error; } return; }
        visit(index + 1, used, count, error);
        candidates.forEach((candidate, n) => { const delta = Math.abs(refs[index]!.startMs - candidate.startMs); if (!used.has(n) && delta <= 80) visit(index + 1, new Set([...used, n]), count + 1, error + 2 * delta); });
      };
      visit(0, new Set(), 0, 0);
      const actual = scoreEvents(gold(...refs), candidates, 80);
      expect(actual.all.tp).toBe(bestCount);
      expect(actual.pairs.reduce((sum, pair) => sum + pair.startErrorMs + pair.endErrorMs, 0)).toBe(bestError);
    }
  });
});
