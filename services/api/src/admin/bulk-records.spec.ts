/**
 * Running a records action over many rows.
 *
 * The behaviour under test is what happens when some rows refuse — which several will, because
 * a competition with fixtures behind it is not deletable and that is the point of the guard.
 */
import { describe, expect, it, vi } from "vitest";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { BULK_LIMIT, readBulkIds, reasonFor, runBulk } from "./bulk-records";

describe("readBulkIds", () => {
  it("reads a list of ids", () => {
    expect(readBulkIds(["a", "b"], "competitionIds")).toEqual(["a", "b"]);
  });

  it("drops duplicates rather than failing on them", () => {
    /* A double-clicked checkbox must not turn into a reported failure for a row that was in
       fact deleted the first time round. */
    expect(readBulkIds(["a", "a", "b"], "ids")).toEqual(["a", "b"]);
  });

  it("drops blanks and trims", () => {
    expect(readBulkIds([" a ", "", "   "], "ids")).toEqual(["a"]);
  });

  it("refuses anything that is not a list of ids", () => {
    expect(() => readBulkIds("a", "ids")).toThrow(BadRequestException);
    expect(() => readBulkIds(undefined, "ids")).toThrow(BadRequestException);
    expect(() => readBulkIds([1, 2], "ids")).toThrow(BadRequestException);
  });

  it("refuses an empty list, which would otherwise read as a successful no-op", () => {
    expect(() => readBulkIds([], "ids")).toThrow(BadRequestException);
    expect(() => readBulkIds(["", " "], "ids")).toThrow(BadRequestException);
  });

  it("refuses more than one request should carry, and says how many", () => {
    const many = Array.from({ length: BULK_LIMIT + 1 }, (_, i) => `id-${i}`);
    expect(() => readBulkIds(many, "matchIds")).toThrow(/201 ids; 200 is the most/);
  });

  it("allows exactly the limit", () => {
    const many = Array.from({ length: BULK_LIMIT }, (_, i) => `id-${i}`);
    expect(readBulkIds(many, "ids")).toHaveLength(BULK_LIMIT);
  });

  it("names the field it was given, so the message says which list was wrong", () => {
    expect(() => readBulkIds([], "teamIds")).toThrow(/teamIds/);
  });
});

describe("reasonFor", () => {
  it("passes a guard's own words through", () => {
    /* These are what an admin reads, so they have to be the message the guard wrote and not
       "Bad Request". */
    expect(
      reasonFor(new BadRequestException("Cannot delete a team that is linked to matches."))
    ).toBe("Cannot delete a team that is linked to matches.");
    expect(reasonFor(new NotFoundException("Competition not found"))).toBe(
      "Competition not found"
    );
  });

  it("has something to say about anything else", () => {
    expect(reasonFor(null)).toBe("Unknown error");
    expect(reasonFor({})).toBe("Unknown error");
    expect(reasonFor("plain string")).toBe("plain string");
  });
});

describe("runBulk", () => {
  it("applies the action to every id", async () => {
    const act = vi.fn(async () => {});
    expect(await runBulk(["a", "b", "c"], act)).toEqual({
      requested: 3,
      done: 3,
      failures: [],
    });
    expect(act).toHaveBeenCalledTimes(3);
  });

  it("carries on past a row that refuses, and reports which", async () => {
    /* The case the guards create: one competition still has fixtures, the other two do not.
       Stopping at the first would make the result depend on the order of the table. */
    const act = vi.fn(async (id: string) => {
      if (id === "b") throw new BadRequestException("Cannot delete a competition with teams");
    });
    expect(await runBulk(["a", "b", "c"], act)).toEqual({
      requested: 3,
      done: 2,
      failures: [{ id: "b", reason: "Cannot delete a competition with teams" }],
    });
    expect(act).toHaveBeenCalledTimes(3);
  });

  it("reports every refusal, not just the first", async () => {
    const act = async (id: string) => {
      throw new BadRequestException(`no: ${id}`);
    };
    const result = await runBulk(["a", "b"], act);
    expect(result.done).toBe(0);
    expect(result.failures.map((f) => f.id)).toEqual(["a", "b"]);
  });

  it("runs in the order it was given, one at a time", async () => {
    /* Sequential on purpose: each of these actions is several queries and some recompute
       standings, so two hundred at once would exhaust the connection pool. */
    const order: string[] = [];
    let running = 0;
    let overlapped = false;
    const act = async (id: string) => {
      running += 1;
      if (running > 1) overlapped = true;
      await Promise.resolve();
      order.push(id);
      running -= 1;
    };
    await runBulk(["a", "b", "c"], act);
    expect(order).toEqual(["a", "b", "c"]);
    expect(overlapped).toBe(false);
  });
});
