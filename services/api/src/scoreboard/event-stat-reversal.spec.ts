import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ScoreboardLifecycleService } from "./scoreboard-lifecycle.service";

/**
 * Deleting a goal has to take its credit back.
 *
 * `applyMatchEventToPlayerStats` only ever increments. Nothing decremented, so a
 * deleted goal left its credit on `SbPlayerCompetitionStats` and `careerGoals`
 * permanently. The worst of it was `ingestMatchTimelineCsv`, which wipes every
 * event on a match and writes fresh ones: each re-import gave every scorer in that
 * match another phantom goal. On live that is the entire 1XCup surplus —
 * forty-six players whose stored totals sit above what their events support.
 *
 * Four call sites had the bug and none of them looked wrong. A comment would not
 * have caught the fifth, so this reads the source instead.
 */
const API_ROOT = resolve(__dirname, "../..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (entry.endsWith(".ts") && !entry.endsWith(".spec.ts")) out.push(path);
  }
  return out;
}

/**
 * The service that owns the counting is exempt.
 *
 * It is where the reversal lives, and it deletes nothing — but naming it here
 * rather than pattern-matching keeps the exemption to one file that somebody had
 * to choose, instead of a rule a new file could accidentally satisfy.
 */
const EXEMPT = new Set(["src/scoreboard/scoreboard-lifecycle.service.ts"]);

type Site = { file: string; line: number; before: string };

function deletionSites(): Site[] {
  const sites: Site[] = [];
  for (const file of sourceFiles(join(API_ROOT, "src"))) {
    const rel = relative(API_ROOT, file).replace(/\\/g, "/");
    if (EXEMPT.has(rel)) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (!/sbMatchEvent\.delete(Many)?\s*\(/.test(line)) return;
      /* The reversal has to happen before the rows go, because `deleteMany` does
         not hand back what it removed. So the window looked at is the code
         leading up to the delete, not following it. */
      sites.push({ file: rel, line: i + 1, before: lines.slice(Math.max(0, i - 30), i).join("\n") });
    });
  }
  return sites;
}

describe("every path that deletes a match event takes its credit back", () => {
  const sites = deletionSites();

  it("finds the deletion sites at all, so a passing suite means something", () => {
    // If a refactor renames the call, this fails loudly rather than the guard
    // below quietly passing over an empty list.
    expect(sites.length).toBeGreaterThan(2);
  });

  it("reverses the stats before deleting", () => {
    const missing = sites
      .filter((s) => !/reverseMatchEventStats/.test(s.before))
      .map((s) => `${s.file}:${s.line}`);

    expect(
      missing,
      "These delete match events without taking back the credit those events were " +
        "given, so the goals stay counted on the player's profile and in the stat " +
        "leaders for ever. Call lifecycle.reverseMatchEventStats (or " +
        "reverseMatchEventStatsByFilter) first, while the rows can still be read:" +
        `\n  ${missing.join("\n  ")}`
    ).toEqual([]);
  });
});

/**
 * The arithmetic, separately from the wiring.
 *
 * The guard above proves the reversal is *called*. These prove it takes back the
 * right amount — and, just as importantly, that it takes back nothing when there
 * was never a credit to take.
 */

type Row = { id: string; goals: number; assists: number };

function lifecycleWith(stats: Row | null, career: { careerGoals: number; careerAssists: number }) {
  const written: { stats?: unknown; career?: unknown } = {};
  const prisma = {
    sbPlayerCompetitionStats: {
      findUnique: async () => stats,
      update: async ({ data }: { data: unknown }) => {
        written.stats = data;
      },
    },
    player: {
      findUnique: async () => career,
      update: async ({ data }: { data: unknown }) => {
        written.career = data;
      },
    },
  };
  const service = new ScoreboardLifecycleService(prisma as never, {} as never);
  return { service, written };
}

const counted = (over: Record<string, unknown> = {}) => ({
  type: "goal",
  playerId: "p1",
  assistPlayerId: null,
  metadata: { statsApplied: true },
  ...over,
});

describe("taking the credit back", () => {
  it("removes one goal per counted goal", async () => {
    const { service, written } = lifecycleWith({ id: "s1", goals: 3, assists: 0 }, {
      careerGoals: 5,
      careerAssists: 0,
    });
    await service.reverseMatchEventStats([counted()] as never, "c1");
    expect(written.stats).toMatchObject({ goals: 2 });
    expect(written.career).toMatchObject({ careerGoals: 4 });
  });

  it("does nothing for an event that was never counted", async () => {
    /* The commonest event here had no player on it, so nobody was ever credited.
       Reversing it would invent a debt and take a goal off someone who scored it. */
    const { service, written } = lifecycleWith({ id: "s1", goals: 3, assists: 0 }, {
      careerGoals: 5,
      careerAssists: 0,
    });
    const n = await service.reverseMatchEventStats(
      [counted({ metadata: { statsApplied: false } })] as never,
      "c1"
    );
    expect(n).toBe(0);
    expect(written.stats).toBeUndefined();
    expect(written.career).toBeUndefined();
  });

  it("does nothing for an event with no player attached", async () => {
    const { service, written } = lifecycleWith({ id: "s1", goals: 3, assists: 0 }, {
      careerGoals: 5,
      careerAssists: 0,
    });
    await service.reverseMatchEventStats([counted({ playerId: null })] as never, "c1");
    expect(written.stats).toBeUndefined();
  });

  it("counts a penalty as a goal", async () => {
    const { service, written } = lifecycleWith({ id: "s1", goals: 2, assists: 0 }, {
      careerGoals: 2,
      careerAssists: 0,
    });
    await service.reverseMatchEventStats([counted({ type: "goal_penalty" })] as never, "c1");
    expect(written.stats).toMatchObject({ goals: 1 });
  });

  it("never credits an assist on a penalty", async () => {
    // applyMatchEventToPlayerStats only assists on a plain goal, so neither does this.
    const { service, written } = lifecycleWith({ id: "s1", goals: 1, assists: 4 }, {
      careerGoals: 1,
      careerAssists: 4,
    });
    await service.reverseMatchEventStats(
      [counted({ type: "goal_penalty", playerId: null, assistPlayerId: "p1" })] as never,
      "c1"
    );
    expect(written.stats).toBeUndefined();
  });

  it("aggregates several events for the same player", async () => {
    const { service, written } = lifecycleWith({ id: "s1", goals: 5, assists: 0 }, {
      careerGoals: 9,
      careerAssists: 0,
    });
    await service.reverseMatchEventStats([counted(), counted(), counted()] as never, "c1");
    expect(written.stats).toMatchObject({ goals: 2 });
    expect(written.career).toMatchObject({ careerGoals: 6 });
  });

  it("floors at zero rather than going negative", async () => {
    /* A career total also holds what a player entered at registration. Taking back
       a credit this service granted is right; driving the number below zero on the
       way is not. */
    const { service, written } = lifecycleWith({ id: "s1", goals: 1, assists: 0 }, {
      careerGoals: 0,
      careerAssists: 0,
    });
    await service.reverseMatchEventStats([counted(), counted(), counted()] as never, "c1");
    expect(written.stats).toMatchObject({ goals: 0 });
    expect(written.career).toMatchObject({ careerGoals: 0 });
  });

  it("copes when the player has no stats row for that competition", async () => {
    const { service, written } = lifecycleWith(null, { careerGoals: 2, careerAssists: 0 });
    await service.reverseMatchEventStats([counted()] as never, "c1");
    expect(written.stats).toBeUndefined();
    expect(written.career).toMatchObject({ careerGoals: 1 });
  });
});
