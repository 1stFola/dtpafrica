import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import type { AdminAuthContext } from "../../admin/auth/admin-auth.types";
import { notFound, personFor, refusal } from "./refusals";

describe("a refusal", () => {
  it("is the exception of its status, carrying every part of the shape", () => {
    const cases = [
      [400, BadRequestException],
      [401, UnauthorizedException],
      [403, ForbiddenException],
      [404, NotFoundException],
      [409, ConflictException],
    ] as const;
    for (const [status, type] of cases) {
      const e = refusal(status, "SomethingRefused", "It was refused.", "Do this instead.");
      expect(e).toBeInstanceOf(type);
      expect(e.getStatus()).toBe(status);
      expect(e.getResponse()).toEqual({ statusCode: status, error: "SomethingRefused", message: "It was refused.", remediation: "Do this instead." });
    }
  });

  it("carries what a screen reads beside it, without losing the shape", () => {
    const body = refusal(400, "InvalidBoxes", "2 problems.", "Fix them.", { problems: ["a", "b"], statusCode: 418 }).getResponse();
    expect(body).toEqual({ statusCode: 400, error: "InvalidBoxes", message: "2 problems.", remediation: "Fix them.", problems: ["a", "b"] });
  });

  it("says what was not found, by name, and is a 404 with a remediation", () => {
    const e = notFound("model version", "mv-1");
    expect(e).toBeInstanceOf(NotFoundException);
    // A bare string made this `error: "Not Found"` with nothing to do next.
    expect(e.getResponse()).toEqual({ statusCode: 404, error: "NotFound", message: "Unknown model version mv-1", remediation: "Check the id; the model version may have been removed." });
    expect(notFound("match", "m-1", "Link the asset again.").getResponse()).toMatchObject({ remediation: "Link the asset again." });
  });
});

describe("requiring a person", () => {
  const requirePerson = personFor("EventNeedsAPerson", "An event is a claim with a name on it.");
  const person: AdminAuthContext = { method: "jwt", roleSlug: "vision_reviewer", roleName: null, permissions: [], userId: "u-1", email: "a@dtp.test" };
  const key: AdminAuthContext = { method: "api_key", roleSlug: null, roleName: null, permissions: [] };

  it("answers with who they are", () => {
    expect(requirePerson(person, "propose an event")).toEqual({ userId: "u-1", email: "a@dtp.test" });
  });

  it("refuses the operator key, and nobody at all, in the service's own words", () => {
    for (const actor of [key, undefined]) {
      let thrown: unknown;
      try {
        requirePerson(actor, "propose an event");
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(ForbiddenException);
      expect((thrown as ForbiddenException).getResponse()).toEqual({
        statusCode: 403,
        error: "EventNeedsAPerson",
        message: "Only a signed-in person may propose an event.",
        remediation: "Sign in as yourself.",
        detail: "An event is a claim with a name on it.",
      });
    }
  });
});

/**
 * Every refusal in the Vision module, read as text. One thrown with a bare
 * string, or as an object with no `remediation`, fails here, and so does a
 * service that grows its own person check. This began as four services
 * (docs/vision/63) and is the whole module since docs/vision/64.
 */
describe("every refusal in the module", () => {
  const root = join(__dirname, "..");
  const sources = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return sources(full);
      return name.endsWith(".ts") && !name.endsWith(".spec.ts") ? [full] : [];
    });
  const files = sources(root);
  const label = (file: string) => relative(root, file).replace(/\\/g, "/");
  const KINDS = "(NotFound|BadRequest|Conflict|Forbidden|Unauthorized)";

  /** The object literal starting at `from`, to its matching brace. */
  function literal(text: string, from: number): string {
    let depth = 0;
    for (let i = from; i < text.length; i += 1) {
      if (text[i] === "{") depth += 1;
      else if (text[i] === "}" && --depth === 0) return text.slice(from, i + 1);
    }
    return text.slice(from);
  }

  it("is in a file this test found", () => {
    // A walk that finds nothing would make the checks below pass.
    expect(files.length).toBeGreaterThan(60);
    expect(files.map(label)).toContain("annotation/annotation.service.ts");
  });

  it("is not thrown as a bare string", () => {
    const bare = files.flatMap((file) => [...readFileSync(file, "utf8").matchAll(new RegExp(`new ${KINDS}Exception\\(\\s*[\`"']`, "g"))].map((m) => `${label(file)}: ${m[0]}`));
    expect(bare).toEqual([]);
  });

  it("has a remediation", () => {
    const without = files.flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return [...text.matchAll(new RegExp(`new ${KINDS}Exception\\(\\s*\\{`, "g"))]
        .map((m) => literal(text, text.indexOf("{", m.index)))
        .filter((body) => !body.includes("remediation"))
        .map((body) => `${label(file)}: ${/error:\s*"([^"]+)"/.exec(body)?.[1] ?? body.slice(0, 60)}`);
    });
    expect(without).toEqual([]);
  });

  it("is named: a refusal built with the helper says which refusal it is", () => {
    const unnamed = files.flatMap((file) => [...readFileSync(file, "utf8").matchAll(/refusal\(\s*\d{3},\s*""/g)].map(() => label(file)));
    expect(unnamed).toEqual([]);
  });

  it("keeps one copy of the person check", () => {
    for (const file of files) {
      expect(readFileSync(file, "utf8"), label(file)).not.toMatch(/function requirePerson\(/);
    }
    for (const name of ["events/events.service.ts", "identity/identity.service.ts", "clock/clock.service.ts", "calibration/calibration.service.ts", "models/promotions.service.ts"]) {
      expect(readFileSync(join(root, name), "utf8"), name).toMatch(/const requirePerson = personFor\(/);
    }
  });
});
