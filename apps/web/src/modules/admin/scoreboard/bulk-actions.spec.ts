/**
 * What a bulk records action asks before it runs, and says afterwards.
 *
 * The reason this is tested rather than inlined: a bulk action partially succeeds, and the
 * sentence describing that is the only place an admin learns which rows are still there.
 */
import { describe, expect, it, vi } from "vitest";
import {
  BULK_REQUEST_LIMIT,
  chunkIds,
  confirmBulk,
  countOf,
  reportBulk,
  runInBatches,
} from "./bulk-actions";

const COMPETITION = { one: "competition", many: "competitions" };
const TEAM = { one: "team", many: "teams" };

const result = (
  done: number,
  failures: { id: string; reason: string }[] = []
) => ({ requested: done + failures.length, done, failures });

describe("countOf", () => {
  it("agrees with itself about one", () => {
    expect(countOf(COMPETITION, 1)).toBe("1 competition");
    expect(countOf(COMPETITION, 0)).toBe("0 competitions");
    expect(countOf(COMPETITION, 12)).toBe("12 competitions");
  });
});

describe("confirmBulk", () => {
  it("names the rows, so the count is not the only thing to go on", () => {
    const text = confirmBulk({
      verb: "Delete",
      noun: TEAM,
      names: ["FC Babington", "FC Enegwea"],
    });
    expect(text).toContain("Delete 2 teams?");
    expect(text).toContain("FC Babington");
    expect(text).toContain("FC Enegwea");
    expect(text).not.toContain("more");
  });

  it("counts the rest once the list would get long", () => {
    const names = Array.from({ length: 9 }, (_, i) => `Club ${i + 1}`);
    const text = confirmBulk({ verb: "Delete", noun: TEAM, names });
    expect(text).toContain("Delete 9 teams?");
    expect(text).toContain("Club 5");
    expect(text).not.toContain("Club 6");
    expect(text).toContain("… and 4 more");
  });

  it("carries a caveat when there is one to give", () => {
    const text = confirmBulk({
      verb: "Delete",
      noun: COMPETITION,
      names: ["Jagaban Cup"],
      caveat: "A competition with teams or fixtures will be left alone.",
    });
    expect(text).toContain("Delete 1 competition?");
    expect(text.endsWith("A competition with teams or fixtures will be left alone.")).toBe(true);
  });
});

describe("reportBulk", () => {
  it("reports a clean run and nothing else", () => {
    expect(reportBulk(result(3), COMPETITION, "deleted")).toEqual({
      ok: "3 competitions deleted",
      problem: null,
    });
  });

  it("reports what went through and what stayed", () => {
    const report = reportBulk(
      result(3, [
        { id: "a", reason: "Cannot delete a competition with teams" },
        { id: "b", reason: "Cannot delete a competition with teams" },
      ]),
      COMPETITION,
      "deleted"
    );
    expect(report.ok).toBe("3 competitions deleted");
    expect(report.problem).toBe(
      "2 competitions were left as they are. Cannot delete a competition with teams (2)"
    );
  });

  it("says nothing went through when nothing did", () => {
    /* No success toast for a run that deleted nothing -- the page used to show "deleted" on a
       refusal because the single-row handler reported before it checked. */
    const report = reportBulk(
      result(0, [{ id: "a", reason: "Cannot delete a live match" }]),
      { one: "fixture", many: "fixtures" },
      "deleted"
    );
    expect(report.ok).toBeNull();
    expect(report.problem).toBe("1 fixture was left as it is. Cannot delete a live match");
  });

  it("groups the reasons by how many rows each one held", () => {
    /* Forty rows refusing for one reason is one sentence, and the commonest reason leads it. */
    const report = reportBulk(
      result(0, [
        { id: "a", reason: "Rare" },
        { id: "b", reason: "Common" },
        { id: "c", reason: "Common" },
      ]),
      TEAM,
      "deleted"
    );
    expect(report.problem).toBe("3 teams were left as they are. Common (2) Rare");
  });

  it("counts a single refusal without a number after it", () => {
    const report = reportBulk(result(1, [{ id: "a", reason: "Nope" }]), TEAM, "deleted");
    expect(report.problem).toBe("1 team was left as it is. Nope");
  });
});

describe("chunkIds", () => {
  it("splits a list into requests the server will take", () => {
    const ids = Array.from({ length: 450 }, (_, i) => `id-${i}`);
    const batches = chunkIds(ids);
    expect(batches.map((b) => b.length)).toEqual([200, 200, 50]);
    expect(batches.flat()).toEqual(ids);
  });

  it("leaves a list that already fits as one request", () => {
    expect(chunkIds(["a", "b"])).toEqual([["a", "b"]]);
    expect(chunkIds([])).toEqual([]);
  });

  it("matches the limit the server enforces", () => {
    /* The server refuses a longer list outright rather than truncating it, so these two
       numbers disagreeing means every "select all" on the directory fails. */
    expect(BULK_REQUEST_LIMIT).toBe(200);
  });
});

describe("runInBatches", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`);

  it("runs a long list in several requests and reports it as one", async () => {
    /* The directory shows every squad row there is. Select all of three thousand and press
       Delete, and this is the difference between it working and a 400. */
    const act = vi.fn(async (batch: string[]) => ({
      requested: batch.length,
      done: batch.length,
      failures: [],
    }));
    const result = await runInBatches(ids(450), act);

    expect(act).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ requested: 450, done: 450, failures: [] });
  });

  it("adds the failures from every batch together", async () => {
    const act = async (batch: string[]) => ({
      requested: batch.length,
      done: batch.length - 1,
      failures: [{ id: batch[0]!, reason: "Nope" }],
    });
    const result = await runInBatches(ids(250), act);

    expect(result.done).toBe(248);
    expect(result.failures.map((f) => f.id)).toEqual(["id-0", "id-200"]);
  });

  it("throws when the first request fails, so a dead server is not read as a refusal", async () => {
    const act = async () => {
      throw new Error("Network error");
    };
    await expect(runInBatches(ids(10), act)).rejects.toThrow("Network error");
  });

  it("keeps going when a later request fails, and says which rows it covered", async () => {
    /* The first two hundred really were deleted. Throwing here would tell the admin nothing
       happened, and they would select the same rows and try again. */
    let call = 0;
    const act = async (batch: string[]) => {
      call += 1;
      if (call === 2) throw new Error("Network error");
      return { requested: batch.length, done: batch.length, failures: [] };
    };
    const result = await runInBatches(ids(401), act);

    expect(result.requested).toBe(401);
    expect(result.done).toBe(201);
    expect(result.failures).toHaveLength(200);
    expect(result.failures[0]).toEqual({ id: "id-200", reason: "Network error" });
  });
});