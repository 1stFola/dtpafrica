import { describe, expect, it } from "vitest";
import { AdminApiError, isAuthRefusal, isNetworkFailure } from "./admin";

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
