import { beforeEach, describe, expect, it, vi } from "vitest";
import { REQUIRE_PERMISSIONS_KEY } from "../../admin/decorators/require-permissions.decorator";
import { DEFAULT_ROLES, ALL_PERMISSION_SLUGS, READ_ONLY_PERMISSION_SLUGS } from "../../admin/rbac/permissions.catalog";
import { AUDIT_PAGE_DEFAULT, AUDIT_PAGE_MAX, auditQuery } from "./audit-query";
import { VisionAuditController } from "./audit.controller";
import { VISION_AUDIT_ACTIONS } from "./vision-audit.service";

const ID = "3b1f6f0e-2c1a-4f65-9d0b-1a2b3c4d5e6f";

describe("what the audit screen may ask for", () => {
  it("asks for everything, a page at a time, when nothing is said", () => {
    expect(auditQuery({})).toEqual({ where: {}, limit: AUDIT_PAGE_DEFAULT, cursor: null });
    // Blank is nothing said: a form sends empty fields.
    expect(auditQuery({ action: " ", actor: "", from: "", limit: "" })).toEqual({ where: {}, limit: AUDIT_PAGE_DEFAULT, cursor: null });
  });

  it("narrows by one action, or by a family of them", () => {
    expect(auditQuery({ action: "media.raw.read" }).where).toEqual({ action: "media.raw.read" });
    expect(auditQuery({ action: "identity." }).where).toEqual({ action: { startsWith: "identity." } });
  });

  it("narrows by what was acted on", () => {
    expect(auditQuery({ targetKind: "vision_worker", targetId: " w-1 " }).where).toEqual({ targetKind: "vision_worker", targetId: "w-1" });
  });

  it("finds a person by id exactly, or by a piece of their email", () => {
    expect(auditQuery({ actor: ID }).where).toEqual({ actorId: ID });
    expect(auditQuery({ actor: "Ada@" }).where).toEqual({ actorEmail: { contains: "Ada@", mode: "insensitive" } });
  });

  it("narrows by how the actor came in, and `none` is a row with no actor", () => {
    expect(auditQuery({ method: "provision_key" }).where).toEqual({ actorMethod: "provision_key" });
    expect(auditQuery({ method: "none" }).where).toEqual({ actorMethod: null });
  });

  it("narrows by time, either end or both", () => {
    expect(auditQuery({ from: "2026-10-01T00:00:00Z" }).where).toEqual({ createdAt: { gte: new Date("2026-10-01T00:00:00Z") } });
    expect(auditQuery({ to: "2026-10-04T23:59:59Z" }).where).toEqual({ createdAt: { lte: new Date("2026-10-04T23:59:59Z") } });
    expect(auditQuery({ from: "2026-10-01T00:00:00Z", to: "2026-10-01T00:00:00Z" }).where).toEqual({
      createdAt: { gte: new Date("2026-10-01T00:00:00Z"), lte: new Date("2026-10-01T00:00:00Z") },
    });
  });

  it("holds a page to its limit", () => {
    expect(auditQuery({ limit: "1" }).limit).toBe(1);
    expect(auditQuery({ limit: "5000" }).limit).toBe(AUDIT_PAGE_MAX);
    expect(auditQuery({ cursor: ID }).cursor).toBe(ID);
  });

  it("refuses a filter it cannot read, by name, and never drops it", () => {
    const refused: [Record<string, string>, string][] = [
      [{ action: "Robert'); DROP" }, "action"],
      [{ targetKind: "a b" }, "targetKind"],
      [{ method: "password" }, "method"],
      [{ from: "yesterday" }, "from"],
      [{ to: "32/13/2026" }, "to"],
      [{ from: "2026-10-05T00:00:00Z", to: "2026-10-04T00:00:00Z" }, "from"],
      [{ limit: "0" }, "limit"],
      [{ limit: "-3" }, "limit"],
      [{ limit: "ten" }, "limit"],
      [{ cursor: "the-first-one" }, "cursor"],
    ];
    for (const [input, field] of refused) {
      let thrown: { status?: number; response?: Record<string, unknown> } = {};
      try {
        auditQuery(input);
      } catch (e) {
        thrown = e as typeof thrown;
      }
      expect(thrown.status, JSON.stringify(input)).toBe(400);
      expect(thrown.response, JSON.stringify(input)).toMatchObject({ error: "AuditFilterInvalid", field, remediation: expect.any(String) });
    }
  });
});

describe("reading the trail", () => {
  const row = (n: number) => ({ id: `id-${n}`, action: "media.raw.read", targetKind: "vision_video_asset", targetId: "a-1", actorId: null, actorEmail: null, actorMethod: "api_key", reason: "why", data: { bytes: BigInt(7) }, createdAt: new Date(`2026-10-04T00:00:0${n}Z`) });
  const prisma = { visionAuditLog: { findMany: vi.fn(), count: vi.fn() } };
  const controller = new VisionAuditController(prisma as never);

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.visionAuditLog.count.mockResolvedValue(3);
  });

  it("answers the first page newest first, with how much there is and what can be asked for", async () => {
    prisma.visionAuditLog.findMany.mockResolvedValueOnce([row(3), row(2), row(1)]).mockResolvedValueOnce([{ targetKind: "vision_video_asset" }, { targetKind: "vision_worker" }]);
    const out = (await controller.list({ limit: "2", action: "media.raw.read" })) as Record<string, any>;

    expect(prisma.visionAuditLog.findMany).toHaveBeenNthCalledWith(1, { where: { action: "media.raw.read" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 3 });
    // One more than the page was read to know there is another; it is not handed out.
    expect(out.items.map((i: { id: string }) => i.id)).toEqual(["id-3", "id-2"]);
    expect(out.nextCursor).toBe("id-2");
    expect(out.matching).toBe(3);
    expect(prisma.visionAuditLog.count).toHaveBeenCalledWith({ where: { action: "media.raw.read" } });
    expect(out.facets).toEqual({ actions: [...VISION_AUDIT_ACTIONS], targetKinds: ["vision_video_asset", "vision_worker"], methods: ["jwt", "api_key", "provision_key", "none"] });
    // A row goes out as JSON: a date as text, a BigInt as a number.
    expect(out.items[0]).toMatchObject({ createdAt: "2026-10-04T00:00:03.000Z", data: { bytes: 7 }, reason: "why", actorMethod: "api_key" });
  });

  it("continues from a cursor, and does not count the table again", async () => {
    prisma.visionAuditLog.findMany.mockResolvedValueOnce([row(1)]);
    const out = (await controller.list({ limit: "2", cursor: ID })) as Record<string, any>;

    expect(prisma.visionAuditLog.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.visionAuditLog.findMany).toHaveBeenCalledWith({ where: {}, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 3, cursor: { id: ID }, skip: 1 });
    expect(out.items).toHaveLength(1);
    // The last page: nothing follows.
    expect(out.nextCursor).toBeNull();
    expect(out).not.toHaveProperty("matching");
    expect(out).not.toHaveProperty("facets");
    expect(prisma.visionAuditLog.count).not.toHaveBeenCalled();
  });

  it("answers an empty trail as an empty page", async () => {
    prisma.visionAuditLog.findMany.mockResolvedValue([]);
    prisma.visionAuditLog.count.mockResolvedValue(0);
    expect(await controller.list({})).toMatchObject({ items: [], nextCursor: null, matching: 0 });
  });

  it("asks the database nothing for a filter it refuses", async () => {
    await expect(controller.list({ from: "yesterday" })).rejects.toMatchObject({ status: 400 });
    expect(prisma.visionAuditLog.findMany).not.toHaveBeenCalled();
  });

  it("only reads: it has no route that writes", () => {
    const routes = Object.getOwnPropertyNames(VisionAuditController.prototype).filter((n) => n !== "constructor" && Reflect.getMetadata("path", (VisionAuditController.prototype as never)[n]) !== undefined);
    expect(routes).toEqual(["list"]);
    // RequestMethod.GET is 0.
    expect(Reflect.getMetadata("method", VisionAuditController.prototype.list)).toBe(0);
  });
});

describe("who may read the trail", () => {
  const slugsFor = (slug: string) => {
    const role = DEFAULT_ROLES.find((r) => r.slug === slug);
    if (!role) throw new Error(`No default role "${slug}"`);
    return role.permissionSlugs === "all" ? ALL_PERMISSION_SLUGS : role.permissionSlugs;
  };

  it("needs vision.audit.read, and vision.read does not open it", () => {
    expect(Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, VisionAuditController.prototype.list)).toEqual(["vision.audit.read"]);
  });

  it("is the Vision admin and the super admin, and nobody else", () => {
    expect(ALL_PERMISSION_SLUGS).toContain("vision.audit.read");
    const holders = DEFAULT_ROLES.filter((r) => slugsFor(r.slug).includes("vision.audit.read")).map((r) => r.slug).sort();
    expect(holders).toEqual(["super_admin", "vision_admin"]);
    // The trail names who read youth footage. A role that may only look does not get to look at that.
    expect(READ_ONLY_PERMISSION_SLUGS).not.toContain("vision.audit.read");
  });
});
