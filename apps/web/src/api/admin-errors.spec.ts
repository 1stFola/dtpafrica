import { describe, expect, it } from "vitest";
import { AdminApiError, describeFailure } from "./admin";

describe("a refusal as a person reads it", () => {
  it("keeps the code and the remediation the API sent, and says both", () => {
    const e = new AdminApiError(JSON.stringify({ statusCode: 409, error: "ProxyUnpinned", message: "The current proxy has no matching completed checksum evidence.", remediation: "Run transcode again." }), 409);
    expect(e.message).toBe("The current proxy has no matching completed checksum evidence.");
    expect(e.code).toBe("ProxyUnpinned");
    expect(e.remediation).toBe("Run transcode again.");
    expect(describeFailure(e)).toBe("The current proxy has no matching completed checksum evidence. Run transcode again.");
  });

  it("falls back to the message alone for a body that is not a refusal", () => {
    const plain = new AdminApiError("Bad gateway", 502);
    expect(plain.code).toBeNull();
    expect(plain.remediation).toBeNull();
    expect(describeFailure(plain)).toBe(plain.message);
    expect(describeFailure(new AdminApiError(JSON.stringify({ message: "No.", remediation: "  " }), 400))).toBe("No.");
    expect(describeFailure(new Error("offline"))).toBe("offline");
    expect(describeFailure("text")).toBe("text");
  });
});
