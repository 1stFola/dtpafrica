import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminAuthContext } from "../../admin/auth/admin-auth.types";
import { VisionClockService } from "./clock.service";

const ASSET = "aaaa1111-2222-4333-8444-555566667777";
const mockPrisma = {
  visionVideoAsset: { findUnique: vi.fn() },
  visionClockAnchor: { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  $transaction: vi.fn(),
};
const mockAudit = { record: vi.fn() };
const reviewer: AdminAuthContext = { method: "jwt", roleSlug: "vision_reviewer", roleName: null, permissions: [], userId: "u-reviewer" };
const apiKey: AdminAuthContext = { method: "api_key", roleSlug: null, roleName: null, permissions: [] };

let service: VisionClockService;

beforeEach(() => {
  vi.clearAllMocks();
  service = new VisionClockService(mockPrisma as never, mockAudit as never);
  mockAudit.record.mockResolvedValue(undefined);
  mockPrisma.visionVideoAsset.findUnique.mockResolvedValue({ id: ASSET, durationMs: 6_000_000 });
  mockPrisma.visionClockAnchor.findMany.mockResolvedValue([]);
  mockPrisma.visionClockAnchor.create.mockImplementation(({ data }: { data: object }) => Promise.resolve({ id: "ca-1", supersededBy: null, ...data }));
  mockPrisma.visionClockAnchor.updateMany.mockResolvedValue({ count: 0 });
  mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(mockPrisma));
});

describe("anchoring the clock", () => {
  it("is a person's, for a real half, inside the footage, ending after it starts", async () => {
    await expect(service.anchor(ASSET, { half: 1, sourceMs: 9000 }, apiKey)).rejects.toMatchObject({ response: { error: "ClockNeedsAPerson" } });
    await expect(service.anchor(ASSET, { half: 5, sourceMs: 9000 }, reviewer)).rejects.toMatchObject({ response: { error: "HalfUnknown" } });
    await expect(service.anchor(ASSET, { half: 1, sourceMs: 7_000_000 }, reviewer)).rejects.toMatchObject({ response: { error: "AnchorOutsideAsset" } });
    await expect(service.anchor(ASSET, { half: 1, sourceMs: 9000, endMs: 9000 }, reviewer)).rejects.toMatchObject({ response: { error: "HalfEndsBeforeItStarts" } });
    const out = await service.anchor(ASSET, { half: 1, sourceMs: 9000, endMs: 2_709_000 }, reviewer);
    expect(out).toMatchObject({ videoAssetId: ASSET, half: 1, sourceMs: 9000, endMs: 2_709_000, decidedBy: "u-reviewer" });
    expect(mockPrisma.visionClockAnchor.updateMany).toHaveBeenCalledWith({ where: { videoAssetId: ASSET, half: 1, supersededBy: null, id: { not: "ca-1" } }, data: { supersededBy: "ca-1" } });
    expect(mockAudit.record).toHaveBeenCalledWith(expect.objectContaining({ action: "clock.anchored" }), reviewer);
  });

  it("keeps the halves in order, both ways", async () => {
    mockPrisma.visionClockAnchor.findMany.mockResolvedValue([{ half: 1, sourceMs: 9000, endMs: 2_709_000 }]);
    await expect(service.anchor(ASSET, { half: 2, sourceMs: 2_000_000 }, reviewer)).rejects.toMatchObject({ response: { error: "HalfOutOfOrder" } });
    await expect(service.anchor(ASSET, { half: 2, sourceMs: 3_000_000 }, reviewer)).resolves.toMatchObject({ half: 2 });
    mockPrisma.visionClockAnchor.findMany.mockResolvedValue([{ half: 2, sourceMs: 3_000_000, endMs: null }]);
    await expect(service.anchor(ASSET, { half: 1, sourceMs: 9000, endMs: 3_100_000 }, reviewer)).rejects.toMatchObject({ response: { error: "HalfOutOfOrder" } });
    await expect(service.anchor(ASSET, { half: 1, sourceMs: 9000, endMs: 2_709_000 }, reviewer)).resolves.toMatchObject({ half: 1 });
  });
});

describe("reading the clock", () => {
  it("names the halves and places a millisecond on them", async () => {
    mockPrisma.visionClockAnchor.findMany.mockResolvedValue([
      { half: 2, sourceMs: 3_000_000, endMs: null },
      { half: 1, sourceMs: 9000, endMs: 2_709_000 },
    ]);
    const out = await service.read(ASSET, 3_000_000 + 132_000);
    expect(out.anchored).toBe(true);
    expect(out.anchors.map((a) => a.half)).toEqual([1, 2]);
    expect(out.anchors[0]!.name).toBe("1st half");
    expect(out.at).toMatchObject({ sourceMs: 3_132_000, status: "on", half: 2, display: "47:12" });
    expect((await service.read(ASSET)).at).toBeNull();
    mockPrisma.visionClockAnchor.findMany.mockResolvedValue([]);
    expect(await service.read(ASSET, 5)).toMatchObject({ anchored: false, at: { status: "unanchored" } });
  });
});
