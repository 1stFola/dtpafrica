import { createHash } from "node:crypto";
import { BadRequestException, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PartnerUploadGuard, type PartnerUploadRequest } from "./partner-upload.guard";
import { VisionPartnerUploadsController } from "./partner-uploads.controller";

/**
 * The partner upload link.
 *
 * A grassroots club secretary has no DTP account, and creating one for every club
 * is neither realistic nor safe. So they get a token that does exactly one thing.
 * These tests are mostly about what it *cannot* do.
 */

const TOKEN = "t".repeat(64);
const HASH = createHash("sha256").update(TOKEN).digest("hex");

const mockPrisma = { visionPartnerUploadGrant: { findUnique: vi.fn() } };
const mockUploads = {
  begin: vi.fn(),
  view: vi.fn(),
  signParts: vi.fn(),
  complete: vi.fn(),
};

function grant(overrides: Record<string, unknown> = {}) {
  return {
    id: "grant-1",
    partnerId: "partner-1",
    sourceVideoRecordId: "source-1",
    maxBytes: BigInt(5_000_000_000),
    allowedMimeTypes: ["video/mp4"],
    expiresAt: new Date(Date.now() + 86_400_000),
    usedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

function ctxFor(headers: Record<string, string>) {
  const req: Record<string, unknown> = { headers };
  return {
    req,
    ctx: { switchToHttp: () => ({ getRequest: () => req }) } as never,
  };
}

function controller() {
  return new VisionPartnerUploadsController(mockUploads as never);
}

function request(): PartnerUploadRequest {
  return {
    headers: {},
    partnerUpload: {
      grantId: "grant-1",
      partnerId: "partner-1",
      sourceVideoRecordId: "source-1",
      maxBytes: 5_000_000_000,
      allowedMimeTypes: ["video/mp4"],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.visionPartnerUploadGrant.findUnique.mockResolvedValue(grant());
  mockUploads.begin.mockResolvedValue({ id: "session-1" });
  mockUploads.view.mockResolvedValue({ id: "session-1" });
  mockUploads.signParts.mockResolvedValue([]);
  mockUploads.complete.mockResolvedValue({ state: "completed", jobsQueued: [] });
});

describe("the guard", () => {
  it("accepts a valid token and attaches the grant", async () => {
    const guard = new PartnerUploadGuard(mockPrisma as never);
    const { req, ctx } = ctxFor({ "x-vision-upload-token": TOKEN });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(mockPrisma.visionPartnerUploadGrant.findUnique.mock.calls[0]![0].where).toEqual({
      tokenHash: HASH,
    });
    expect(req.partnerUpload).toMatchObject({ grantId: "grant-1", sourceVideoRecordId: "source-1" });
  });

  it("refuses a request with no token", async () => {
    const guard = new PartnerUploadGuard(mockPrisma as never);
    await expect(guard.canActivate(ctxFor({}).ctx)).rejects.toThrow(UnauthorizedException);
  });

  // A partner has no business learning which of the four it was; the distinctions
  // are in the audit log where they belong.
  it.each([
    ["unknown", null],
    ["revoked", grant({ revokedAt: new Date() })],
    ["expired", grant({ expiresAt: new Date(Date.now() - 1000) })],
  ])("gives the same message for a %s link", async (_label, row) => {
    mockPrisma.visionPartnerUploadGrant.findUnique.mockResolvedValue(row);
    const guard = new PartnerUploadGuard(mockPrisma as never);

    await expect(
      guard.canActivate(ctxFor({ "x-vision-upload-token": TOKEN }).ctx)
    ).rejects.toThrow("Invalid or expired upload link");
  });

  // One grant, one upload: re-use would turn a single link into an open door.
  it("refuses a link that has already been used, and says so plainly", async () => {
    mockPrisma.visionPartnerUploadGrant.findUnique.mockResolvedValue(
      grant({ usedAt: new Date() })
    );
    const guard = new PartnerUploadGuard(mockPrisma as never);

    await expect(
      guard.canActivate(ctxFor({ "x-vision-upload-token": TOKEN }).ctx)
    ).rejects.toThrow(/already been used/);
  });

  // Three separate auth stacks, no shared code path.
  it("ignores an admin API key and a worker token entirely", async () => {
    const guard = new PartnerUploadGuard(mockPrisma as never);
    const { ctx } = ctxFor({
      "x-admin-api-key": "an-admin-key",
      "x-vision-worker-token": "a-worker-token",
      authorization: "Bearer an-admin-jwt",
    });

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    expect(mockPrisma.visionPartnerUploadGrant.findUnique).not.toHaveBeenCalled();
  });

  it("stores only the hash, never the token", async () => {
    const guard = new PartnerUploadGuard(mockPrisma as never);
    await guard.canActivate(ctxFor({ "x-vision-upload-token": TOKEN }).ctx);
    const lookup = JSON.stringify(mockPrisma.visionPartnerUploadGrant.findUnique.mock.calls[0]);
    expect(lookup).not.toContain(TOKEN);
  });
});

describe("the grant fixes what a partner may do", () => {
  it("tells the holder what the link is for", () => {
    expect(controller().grant(request())).toEqual({
      sourceVideoRecordId: "source-1",
      maxBytes: 5_000_000_000,
      allowedMimeTypes: ["video/mp4"],
    });
  });

  // A partner never names the source. It cannot upload against someone else's.
  it("uses the grant's source record, not anything from the request", async () => {
    await controller().begin(request(), { mimeType: "video/mp4" });
    expect(mockUploads.begin.mock.calls[0]![0].sourceVideoRecordId).toBe("source-1");
    expect(mockUploads.begin.mock.calls[0]![2]).toBe("grant-1");
  });

  // Validation happens before any promise exists, so these throw synchronously.
  it("refuses a media type the link does not allow", () => {
    expect(() => controller().begin(request(), { mimeType: "application/zip" })).toThrow(
      BadRequestException
    );
    expect(mockUploads.begin).not.toHaveBeenCalled();
  });

  it("refuses a file larger than the link permits", () => {
    expect(() =>
      controller().begin(request(), { mimeType: "video/mp4", expectedBytes: 9_000_000_000 })
    ).toThrow(/up to 5000000000 bytes/);
  });

  it("allows a file within the ceiling", async () => {
    await controller().begin(request(), { mimeType: "video/mp4", expectedBytes: 100 });
    expect(mockUploads.begin).toHaveBeenCalledOnce();
  });

  // Scoping is enforced in the service so no route can forget it; the controller
  // only has to pass the grant through.
  it("scopes every session call to its own grant", async () => {
    const c = controller();
    const req = request();

    await c.view(req, "session-1");
    await c.signParts(req, "session-1", { partNumbers: [1] });
    await c.complete(req, "session-1", {});

    expect(mockUploads.view).toHaveBeenCalledWith("session-1", "grant-1");
    expect(mockUploads.signParts).toHaveBeenCalledWith("session-1", [1], "grant-1");
    expect(mockUploads.complete.mock.calls[0]![3]).toMatchObject({ grantId: "grant-1" });
  });

  /**
   * A partner does not decide whether DTP analyses the footage. Ingestion is
   * always requested; the rights engine decides whether it runs.
   */
  it("always requests ingestion, leaving the decision to the rights engine", async () => {
    await controller().complete(request(), "session-1", {});
    expect(mockUploads.complete.mock.calls[0]![3]).toMatchObject({ enqueueIngest: true });
  });

  it("refuses when the guard context is missing", () => {
    expect(() => controller().grant({ headers: {} })).toThrow(ForbiddenException);
  });
});
