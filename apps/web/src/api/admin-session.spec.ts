import { describe, expect, it } from "vitest";
import {
  AdminApiError,
  cacheAdminSession,
  isAuthRefusal,
  isNetworkFailure,
  readCachedAdminSession,
} from "./admin";

/**
 * Telling "the API refused you" from "the API did not answer".
 *
 * Only the first signs somebody out. A session check that failed for want of signal used to
 * sign recorders out when the page reloaded in a dead spot, onto a login page that needed
 * the signal they did not have.
 */

describe("isAuthRefusal", () => {
  it("is a 401 or a 403", () => {
    expect(isAuthRefusal(new AdminApiError("Unauthorized", 401))).toBe(true);
    expect(isAuthRefusal(new AdminApiError("Forbidden", 403))).toBe(true);
  });

  it("is not a dropped connection, a timeout or a server fault", () => {
    expect(isAuthRefusal(new TypeError("Failed to fetch"))).toBe(false);
    expect(isAuthRefusal(new Error("The server did not answer in time."))).toBe(false);
    expect(isAuthRefusal(new AdminApiError("Bad Gateway", 502))).toBe(false);
    expect(isAuthRefusal(new AdminApiError("Internal", 500))).toBe(false);
  });
});

describe("isNetworkFailure", () => {
  it("is no usable answer: a failed fetch, a timeout, a gateway or a server fault", () => {
    expect(isNetworkFailure(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkFailure(new Error("The server did not answer in time."))).toBe(true);
    expect(isNetworkFailure(new AdminApiError("Bad Gateway", 502))).toBe(true);
    expect(isNetworkFailure(new AdminApiError("Internal", 500))).toBe(true);
  });

  it("is not the server refusing a save", () => {
    expect(isNetworkFailure(new AdminApiError("This sheet is approved.", 400))).toBe(false);
    expect(isNetworkFailure(new AdminApiError("Forbidden", 403))).toBe(false);
  });
});

describe("the session kept for a reload with no signal", () => {
  it("keeps the role and permissions, and nothing that identifies the person", () => {
    const items = new Map<string, string>();
    (globalThis as { sessionStorage?: unknown }).sessionStorage = {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => void items.set(k, v),
      removeItem: (k: string) => void items.delete(k),
    };
    cacheAdminSession({
      ok: true,
      method: "jwt",
      roleSlug: "match_recorder",
      roleName: "Match recorder",
      permissions: ["scoreboard.stats.record"],
      userId: "user-1",
      email: "recorder@example.com",
      displayName: "Ada Recorder",
      competitionIds: ["c-1"],
    });
    const stored = [...items.values()].join("");
    expect(stored).not.toContain("recorder@example.com");
    expect(stored).not.toContain("Ada Recorder");
    expect(stored).not.toContain("user-1");
    expect(readCachedAdminSession()).toMatchObject({
      roleSlug: "match_recorder",
      permissions: ["scoreboard.stats.record"],
      competitionIds: ["c-1"],
    });
  });
});
