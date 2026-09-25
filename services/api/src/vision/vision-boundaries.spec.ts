import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Architecture tests.
 *
 * docs/vision/01-ARCHITECTURE.md states the rule as a review failure: no
 * provider name may appear in a table name, column name, API path, dataset
 * manifest or domain type. A rule that depends on someone remembering to grep
 * will eventually be skipped under delivery pressure, so it is asserted here.
 */

const VISION_ROOT = __dirname;
const CONTRACTS_SRC = join(__dirname, "..", "..", "..", "..", "packages", "vision-contracts", "src");

/** Directories permitted to name a vendor, because they are the adapters. */
const ADAPTER_DIRS = ["storage", "compute"];

function tsFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
        out.push(full);
      }
    }
  };
  walk(root);
  return out;
}

function isAdapterFile(path: string): boolean {
  const rel = relative(VISION_ROOT, path);
  const [top] = rel.split(sep);
  return ADAPTER_DIRS.includes(top);
}

/** Vendor names, as case-insensitive whole words. */
const VENDOR_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "runpod", pattern: /\brunpod\b/i },
  { name: "cloudflare", pattern: /\bcloudflare\b/i },
  { name: "lambda cloud", pattern: /\blambdacloud\b/i },
  { name: "vast.ai", pattern: /\bvast\.ai\b/i },
];

describe("no vendor leaks out of its adapter", () => {
  it("keeps provider names inside storage/ and compute/", () => {
    const offenders: string[] = [];

    for (const file of tsFiles(VISION_ROOT)) {
      if (isAdapterFile(file)) continue;
      // Spec files describe the rule, so they may name what they forbid.
      if (file.endsWith(".spec.ts")) continue;

      const source = readFileSync(file, "utf8");
      for (const { name, pattern } of VENDOR_PATTERNS) {
        if (pattern.test(source)) {
          offenders.push(`${relative(VISION_ROOT, file)} mentions ${name}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("keeps provider names out of the shared contracts entirely", () => {
    const offenders: string[] = [];

    for (const file of tsFiles(CONTRACTS_SRC)) {
      if (file.endsWith(".spec.ts")) continue;
      const source = readFileSync(file, "utf8");
      for (const { name, pattern } of VENDOR_PATTERNS) {
        if (pattern.test(source)) {
          offenders.push(`${relative(CONTRACTS_SRC, file)} mentions ${name}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

/**
 * The control plane is a 2 vCPU / 2 GB box that serves dtp.africa. Nothing in
 * the Vision module may write to its disk or shell out to a media tool: bytes
 * and transcodes belong on a worker.
 */
describe("the control plane never touches media", () => {
  const FORBIDDEN = [
    { name: "a filesystem write", pattern: /\b(writeFileSync|createWriteStream|appendFileSync)\b/ },
    { name: "a child process", pattern: /\b(spawnSync|execSync|spawn\(|exec\()/ },
    { name: "ffmpeg or ffprobe", pattern: /\bffmpeg\b|\bffprobe\b/i },
  ];

  it("contains no filesystem write, subprocess or media tool invocation", () => {
    const offenders: string[] = [];

    for (const file of tsFiles(VISION_ROOT)) {
      // This file reads sources to assert the rule; specs may name it.
      if (file.endsWith(".spec.ts")) continue;

      const source = readFileSync(file, "utf8");
      for (const { name, pattern } of FORBIDDEN) {
        if (pattern.test(source)) {
          offenders.push(`${relative(VISION_ROOT, file)} contains ${name}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe("no large-object path proxies bytes through the API", () => {
  // The ObjectStore port deliberately exposes only presigned URLs plus
  // explicitly small-object helpers. A method that streamed a whole video
  // through the control plane would have to be added here first.
  it("exposes only presigned transfer and small-object helpers", () => {
    const port = readFileSync(join(VISION_ROOT, "storage", "object-store.ts"), "utf8");

    expect(port).toContain("presignGet");
    expect(port).toContain("presignPut");
    expect(port).toContain("presignUploadPart");
    // Bulk read/write helpers are named so their limits cannot be overlooked.
    expect(port).toContain("putSmallObject");
    expect(port).toContain("getSmallObject");
    expect(port).not.toMatch(/\bstreamObject\b|\buploadStream\b|\bdownloadToFile\b/);
  });
});
