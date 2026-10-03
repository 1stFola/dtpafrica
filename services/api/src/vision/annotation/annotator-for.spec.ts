import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { annotatorFor } from "./annotation.controller";

/** Who annotates is the signed-in person, not the request body (docs/vision/50, PR-4). */
describe("annotatorFor", () => {
  const session = { method: "session", userId: "alice", roleSlug: null, roleName: null, permissions: [] } as never;
  const key = { method: "api_key", roleSlug: null, roleName: null, permissions: [] } as never;

  it("is the signed-in person, whether or not the body names them", () => {
    expect(annotatorFor(session)).toBe("alice");
    expect(annotatorFor(session, "alice")).toBe("alice");
  });

  it("refuses a body naming someone else, so nobody can claim or submit as another", () => {
    expect(() => annotatorFor(session, "bob")).toThrow(BadRequestException);
  });

  it("lets the operator key, which has no person, name the annotator, and requires it to", () => {
    expect(annotatorFor(key, "gate-ann-1")).toBe("gate-ann-1");
    expect(() => annotatorFor(key)).toThrow(BadRequestException);
  });
});
