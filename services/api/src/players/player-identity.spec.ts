import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { playerIdentityFields } from "./player-identity";

describe("deriving a player's dedupe key", () => {
  it("lowercases and collapses, so one keyboard does not create two people", () => {
    expect(playerIdentityFields("ADEBISI  SEGUN").normalizedName).toBe("adebisi segun");
  });

  it("keeps the display name as a person wrote it", () => {
    // Only the derived key is normalised. The name on the profile is theirs.
    expect(playerIdentityFields("ADEBISI SEGUN").displayName).toBe("ADEBISI SEGUN");
  });

  it("trims, because a trailing space would make a second person", () => {
    expect(playerIdentityFields("  Segun Adebisi  ")).toEqual({
      displayName: "Segun Adebisi",
      normalizedName: "segun adebisi",
    });
  });

  it("returns null rather than an empty key when the name normalises to nothing", () => {
    /* An empty string is a value the unique index enforces, so exactly one such row
       could exist and every other would collide with it. Null is the honest answer. */
    expect(playerIdentityFields("...").normalizedName).toBeNull();
    expect(playerIdentityFields("   ").normalizedName).toBeNull();
  });
});

/**
 * The guard.
 *
 * `normalizedName` is optional in the schema, so leaving it out of a `player.create`
 * is silent — and four paths did exactly that, each producing players with a null
 * key that no lookup finds and no unique index constrains. A fifth derived it with
 * the wrong function. Between them that is most of why the live directory reached
 * 165 names held by more than one record.
 *
 * A comment asking the next person to remember would not have caught any of it.
 * These read the source and fail the build.
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

/** The argument to a call, read by matching brackets rather than counting lines. */
function callArgument(source: string, openParen: number): string {
  let depth = 0;
  for (let i = openParen; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "}" || ch === "]") {
      depth -= 1;
      if (depth === 0) return source.slice(openParen, i + 1);
    }
  }
  return source.slice(openParen);
}

type Site = { file: string; line: number; body: string };

const ALL_SOURCES = [
  ...sourceFiles(join(API_ROOT, "src")),
  ...sourceFiles(join(API_ROOT, "prisma")),
];

function playerCreationSites(): Site[] {
  const sites: Site[] = [];
  for (const file of ALL_SOURCES) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/\.player\.(create|upsert)\s*\(/g)) {
      const openParen = match.index! + match[0].length - 1;
      sites.push({
        file: relative(API_ROOT, file).replace(/\\/g, "/"),
        line: source.slice(0, match.index).split("\n").length,
        body: callArgument(source, openParen),
      });
    }
  }
  return sites;
}

/**
 * Whether the call builds the row inline, so its fields can be read from the call.
 *
 * An object literal that spreads a variable — `{ slug, ...update }` — does not
 * count: the fields are somewhere else, and insisting on seeing the key here would
 * flag a site that sets it perfectly well. `...playerIdentityFields(name)` is not a
 * variable spread, and the check below accepts it by name anyway.
 */
const SPREADS_A_VARIABLE = /\.\.\.[A-Za-z_$][\w$]*[,\s}]/;
const buildsInline = (body: string) =>
  /(data|create):\s*\{/.test(body) && !SPREADS_A_VARIABLE.test(body);

describe("every path that creates a player sets its dedupe key", () => {
  const sites = playerCreationSites();

  it("finds the creation sites at all, so a passing suite means something", () => {
    /* If a refactor renames the call, this fails loudly rather than the guards
       below quietly passing over an empty list. */
    expect(sites.length).toBeGreaterThan(8);
  });

  it("sets normalizedName wherever the row is built inline", () => {
    const missing = sites
      .filter((s) => buildsInline(s.body))
      .filter((s) => !/normalizedName|playerIdentityFields/.test(s.body))
      .map((s) => `${s.file}:${s.line}`);

    expect(
      missing,
      "These build a Player inline without its dedupe key, so the row gets a null " +
        "normalizedName — invisible to every lookup, and unconstrained by the unique " +
        "index. Spread playerIdentityFields(displayName) from " +
        `src/players/player-identity.ts:\n  ${missing.join("\n  ")}`
    ).toEqual([]);
  });

  it("derives it somewhere, even where the row is built in a variable", () => {
    /* `create: data` and `...update` hide the fields from the call itself, so the
       weaker check is that the file derives the key at all. Being precise here is
       the difference between a guard people keep and one they switch off. */
    const missing = sites
      .filter((s) => !buildsInline(s.body))
      .filter((s) => !/playerLookupKey|playerIdentityFields/.test(readFileSync(join(API_ROOT, s.file), "utf8")))
      .map((s) => `${s.file}:${s.line}`);

    expect(missing, `No dedupe key is derived anywhere in:\n  ${missing.join("\n  ")}`).toEqual([]);
  });

  it("never derives the key with the display normaliser", () => {
    /* `normalizePlayerName` trims and collapses whitespace and deliberately keeps
       the casing — its own docstring says to use `playerLookupKey` for equality
       checks. Using it as the key wrote `ADEBISI SEGUN`, which no lookup matches
       and which the unique index cannot tell from `adebisi segun`. One line in one
       seed, and hundreds of players on live became unreachable. */
    const offenders: string[] = [];
    for (const file of ALL_SOURCES) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (/normalizedName:\s*normalizePlayerName\s*\(/.test(line)) {
            offenders.push(`${relative(API_ROOT, file).replace(/\\/g, "/")}:${i + 1}`);
          }
        });
    }
    expect(
      offenders,
      "normalizedName must come from playerLookupKey, never normalizePlayerName:\n  " +
        offenders.join("\n  ")
    ).toEqual([]);
  });
});
