import { beforeEach, describe, expect, it, vi } from "vitest";
import { seedRbac } from "../seed/seed-rbac";
import { AdminRbacService } from "./admin-rbac.service";

vi.mock("../seed/seed-rbac", () => ({ seedRbac: vi.fn() }));

/**
 * A permission added to the catalogue reaches super_admin when the API starts.
 * Before this it took a manual `seed:rbac` that no deploy ran, so an email-signed
 * super admin was refused FairPlay while the Roles page showed every box ticked.
 * What the seed itself grants is in seed-rbac.spec.ts.
 */
describe("AdminRbacService at start", () => {
  const prisma = {};
  const service = new AdminRbacService(prisma as never, {} as never);

  beforeEach(() => {
    vi.mocked(seedRbac).mockReset();
  });

  it("runs the additive seed against its own database", async () => {
    await service.onModuleInit();
    expect(seedRbac).toHaveBeenCalledTimes(1);
    expect(seedRbac).toHaveBeenCalledWith(prisma);
  });

  it("lets the API start if the seed fails", async () => {
    vi.mocked(seedRbac).mockRejectedValue(new Error("database not answering"));
    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });
});
