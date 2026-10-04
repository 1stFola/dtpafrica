import { beforeEach, describe, expect, it, vi } from "vitest";
import { VisionSourcesService } from "./sources.service";

/**
 * Restrictions on a grant are read when a person submits them
 * (`readRestrictions` in the contracts). What they mean afterwards is the rights
 * policy's business, tested in rights-policy.spec.ts.
 */

const PARTNER = "11111111-1111-4111-8111-111111111111";
const mockPrisma = { visionRightsScope: { create: vi.fn() }, visionRightsEvidence: { findUnique: vi.fn() } };
const mockAudit = { record: vi.fn() };
const person = { method: "jwt", roleSlug: "vision_admin", roleName: null, permissions: [], userId: "u-1" } as never;

let service: VisionSourcesService;

beforeEach(() => {
  vi.clearAllMocks();
  service = new VisionSourcesService(mockPrisma as never, {} as never, {} as never, mockAudit as never, {} as never, {} as never, {} as never);
  mockPrisma.visionRightsScope.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "scope-1", ...data }));
});

describe("granting a scope with restrictions", () => {
  it("refuses a deny entry that is not a scope, before anything is stored", async () => {
    // "canPublish" reads like a restriction on publication and would have restricted nothing.
    const refused = await service.grantScope({ partnerId: PARTNER, canAnalyze: true, canPublishHighlight: true, restrictions: { deny: ["canPublish"] } }, person).catch((e) => e.getResponse());
    expect(refused).toMatchObject({ statusCode: 400, error: "RestrictionsInvalid" });
    expect(refused.message).toContain("canPublishHighlight");
    for (const bad of [{ deny: "canTrain" }, { note: 4 }, "no minors", ["canTrain"]]) {
      await expect(service.grantScope({ partnerId: PARTNER, canAnalyze: true, restrictions: bad as never }, person)).rejects.toMatchObject({ response: { error: "RestrictionsInvalid" } });
    }
    expect(mockPrisma.visionRightsScope.create).not.toHaveBeenCalled();
    expect(mockAudit.record).not.toHaveBeenCalled();
  });

  it("stores a deny list and a note as given, with nothing to warn about", async () => {
    const restrictions = { deny: ["canPublishHighlight"], note: "Publication withheld pending guardian consent." };
    const scope = await service.grantScope({ partnerId: PARTNER, canAnalyze: true, restrictions }, person);
    expect(mockPrisma.visionRightsScope.create.mock.calls[0]![0].data.restrictions).toEqual(restrictions);
    expect(scope).not.toHaveProperty("restrictionsWarning");
    expect(mockAudit.record.mock.calls[0]![0].data).not.toHaveProperty("unrecognisedRestrictions");
  });

  it("stores a flag the policy does not understand, and says it will deny every scope", async () => {
    const scope = (await service.grantScope({ partnerId: PARTNER, canAnalyze: true, restrictions: { noIdentifiableMinors: true } }, person)) as { restrictionsWarning?: string };
    expect(mockPrisma.visionRightsScope.create).toHaveBeenCalledTimes(1);
    expect(scope.restrictionsWarning).toContain('"noIdentifiableMinors"');
    expect(scope.restrictionsWarning).toContain("denies every scope");
    expect(mockAudit.record.mock.calls[0]![0].data).toMatchObject({ unrecognisedRestrictions: ["noIdentifiableMinors"] });
  });

  it("takes a grant with no restrictions at all", async () => {
    const scope = await service.grantScope({ partnerId: PARTNER, canAnalyze: true }, person);
    expect(scope).not.toHaveProperty("restrictionsWarning");
  });
});
