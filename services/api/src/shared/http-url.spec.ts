import { describe, expect, it, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { isHttpUrl, normalizeWebsiteUrl } from "./http-url";
import { CreateSupportReportDto } from "../support/dto/create-support-report.dto";
import { UpsertAcademyDto } from "../admin/dto/upsert-academy.dto";
import { AcademyProfileChangeRequestDto } from "../academy-dashboard/dto/academy-change-request.dto";
import { AdsConfigService } from "../ads/ads-config.service";
import type { PrismaService } from "../prisma/prisma.service";

// Each of these is a way to get script to run from an `<a href>` someone else clicks.
const HOSTILE = [
  "javascript:alert(document.cookie)",
  "JavaScript:alert(1)",
  " javascript:alert(1)",
  "java\tscript:alert(1)",
  "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
  "vbscript:msgbox(1)",
  "//evil.example/steal",
  "/admin/ops/support",
  "not a url",
];

describe("isHttpUrl", () => {
  it.each([
    "https://dtp.africa/scoreboard",
    "http://localhost:5173/players/ebulu-emmanuel?tab=stats",
    "https://www.club.example",
  ])("accepts %s", (value) => {
    expect(isHttpUrl(value)).toBe(true);
  });

  it.each(HOSTILE)("refuses %j", (value) => {
    expect(isHttpUrl(value)).toBe(false);
  });

  it("refuses what is not a string", () => {
    expect(isHttpUrl(undefined)).toBe(false);
    expect(isHttpUrl(42)).toBe(false);
  });
});

describe("normalizeWebsiteUrl", () => {
  it("puts https:// in front of a bare host, the way people type a website", () => {
    expect(normalizeWebsiteUrl("www.club.example")).toBe("https://www.club.example");
    expect(normalizeWebsiteUrl("  club.example/about ")).toBe("https://club.example/about");
  });

  it("leaves a value that names a scheme for the validator to judge", () => {
    expect(normalizeWebsiteUrl("javascript:alert(1)")).toBe("javascript:alert(1)");
    expect(normalizeWebsiteUrl("http://club.example")).toBe("http://club.example");
  });

  it("leaves empty and non-strings alone", () => {
    expect(normalizeWebsiteUrl("")).toBe("");
    expect(normalizeWebsiteUrl(null)).toBe(null);
  });
});

const errorsFor = async <T extends object>(cls: new () => T, plain: Record<string, unknown>) => {
  const dto = plainToInstance(cls, plain);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  return { dto, fields: errors.map((e) => e.property) };
};

describe("the public support report", () => {
  const report = (pageUrl?: unknown) => ({
    category: "other",
    subject: "Something broke",
    description: "The page would not load at all.",
    ...(pageUrl === undefined ? {} : { pageUrl }),
  });

  it.each(HOSTILE)("refuses pageUrl %j", async (pageUrl) => {
    expect((await errorsFor(CreateSupportReportDto, report(pageUrl))).fields).toContain("pageUrl");
  });

  it("accepts the page the reporter was on, or none", async () => {
    expect((await errorsFor(CreateSupportReportDto, report("https://dtp.africa/scoreboard"))).fields).toEqual([]);
    expect((await errorsFor(CreateSupportReportDto, report())).fields).toEqual([]);
  });
});

describe.each([
  ["the admin academy form", UpsertAcademyDto, { name: "Remo Stars Academy" }],
  ["an academy's change request", AcademyProfileChangeRequestDto, {}],
] as const)("websiteUrl on %s", (_label, cls, base) => {
  it.each(["javascript:alert(1)", "data:text/html,<script>alert(1)</script>"])(
    "refuses %j",
    async (websiteUrl) => {
      expect((await errorsFor(cls as never, { ...base, websiteUrl })).fields).toContain("websiteUrl");
    }
  );

  it("stores a bare host as an https link", async () => {
    const { dto, fields } = await errorsFor(cls as never, { ...base, websiteUrl: "www.remostars.example" });
    expect(fields).toEqual([]);
    expect((dto as { websiteUrl?: string }).websiteUrl).toBe("https://www.remostars.example");
  });

  it("can still be cleared", async () => {
    expect((await errorsFor(cls as never, { ...base, websiteUrl: "" })).fields).toEqual([]);
  });
});

describe("the ad banner's destinationUrl", () => {
  const service = () => {
    const prisma = {
      staticContent: {
        findUnique: vi.fn(async () => null),
        upsert: vi.fn(async ({ create }: { create: { value: string } }) => ({
          value: create.value,
          updatedAt: new Date(0),
        })),
      },
    };
    return { prisma, ads: new AdsConfigService(prisma as unknown as PrismaService) };
  };

  it("refuses a javascript: link before anything is stored", async () => {
    const { prisma, ads } = service();
    await expect(
      ads.updateConfig({ slots: { scoreboardTop: { destinationUrl: "javascript:alert(1)" } } } as never)
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.staticContent.upsert).not.toHaveBeenCalled();
  });

  it("stores an https link", async () => {
    const { prisma, ads } = service();
    await ads.updateConfig({
      slots: { scoreboardTop: { destinationUrl: "https://sponsor.example/offer" } },
    } as never);
    expect(prisma.staticContent.upsert).toHaveBeenCalledTimes(1);
  });
});
