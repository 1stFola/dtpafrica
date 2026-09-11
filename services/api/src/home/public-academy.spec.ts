import { describe, it, expect, vi } from "vitest";
import { HomeService } from "./home.service";

const ROW = {
  id: "a1",
  slug: "coal-city-united",
  name: "Coal City United",
  contactPerson: "Private Contact",
  email: "owner@example.com",
  phone: "+2348000000000",
  city: "Enugu",
  country: "Nigeria",
  description: null,
  foundedYear: null,
  logoUrl: null,
  websiteUrl: null,
  loginUsername: "coalcity",
  passwordHash: "$2b$10$abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQR",
  subscriptionTier: "pro",
  maxPlayers: 40,
  isPublished: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("public academy endpoints", () => {
  const prisma = {
    academy: {
      findFirst: vi.fn(async () => ROW),
      findMany: vi.fn(async () => [ROW]),
    },
    sbCompetition: { findUnique: vi.fn(async () => null) },
  };
  const service = new HomeService(prisma as never, null as never);

  // Regression: GET /home/academies/:slug returned the raw row, password hash
  // included, to unauthenticated callers.
  it("never exposes the password hash or private contact fields by slug", async () => {
    const body = JSON.stringify(await service.academyBySlug("coal-city-united"));
    expect(body).not.toContain("passwordHash");
    expect(body).not.toContain(ROW.passwordHash);
    expect(body).not.toContain(ROW.email);
    expect(body).not.toContain(ROW.phone);
    expect(body).not.toContain("subscriptionTier");
  });

  it("returns the same shape as the public listing", async () => {
    const [listed] = await service.listAcademies();
    const bySlug = await service.academyBySlug("coal-city-united");
    expect(Object.keys(bySlug).sort()).toEqual(Object.keys(listed).sort());
  });
});
