import { beforeEach, describe, expect, it, vi } from "vitest";
import { RightsPolicyService } from "./rights-policy.service";

/**
 * `canTrainMany` against `canTrain`, asset by asset.
 *
 * The fake holds rows and honours the filters it is given, so a batched query
 * that asks for the wrong rows, or hands one asset another's grants, gives a
 * different answer here. A mock that returns whatever it was told to would not.
 */
const NOW = new Date("2026-10-03T12:00:00Z");

type Asset = { id: string; corpus: string; sourceVideoRecordId: string | null };
type Rec = { id: string; partnerId: string; acquisitionStatus: string };
type Scope = Record<string, unknown> & { partnerId: string | null; sourceVideoRecordId: string | null; playerId: string | null };

let seq = 0;
const scope = (over: Partial<Scope> & Record<string, unknown>): Scope => ({
  id: `scope-${++seq}`,
  grantLevel: "partner",
  partnerId: null,
  sourceVideoRecordId: null,
  playerId: null,
  canAnalyze: true,
  canTrain: true,
  canPublishHighlight: false,
  canShareWithScout: false,
  grantedAt: new Date("2026-01-01T00:00:00Z"),
  expiresAt: null,
  revokedAt: null,
  restrictions: null,
  ...over,
});

const RECORDS: Rec[] = [
  { id: "rec-a1", partnerId: "partner-a", acquisitionStatus: "acquired" },
  { id: "rec-a2", partnerId: "partner-a", acquisitionStatus: "acquired" },
  { id: "rec-a3", partnerId: "partner-a", acquisitionStatus: "pending" },
  { id: "rec-b1", partnerId: "partner-b", acquisitionStatus: "acquired" },
  { id: "rec-c1", partnerId: "partner-c", acquisitionStatus: "acquired" },
  { id: "rec-d1", partnerId: "partner-d", acquisitionStatus: "acquired" },
];
const ASSETS: Asset[] = [
  { id: "granted", corpus: "dtp_owned", sourceVideoRecordId: "rec-a1" },
  { id: "source-says-no", corpus: "dtp_owned", sourceVideoRecordId: "rec-a2" },
  { id: "not-acquired", corpus: "dtp_owned", sourceVideoRecordId: "rec-a3" },
  { id: "research", corpus: "research_only", sourceVideoRecordId: "rec-a1" },
  { id: "no-grant", corpus: "dtp_owned", sourceVideoRecordId: "rec-b1" },
  { id: "revoked", corpus: "dtp_owned", sourceVideoRecordId: "rec-c1" },
  { id: "restricted", corpus: "dtp_owned", sourceVideoRecordId: "rec-d1" },
  { id: "no-record", corpus: "dtp_owned", sourceVideoRecordId: null },
];
const SCOPES: Scope[] = [
  scope({ partnerId: "partner-a" }),
  // The narrower level speaks and does not grant training: it wins over the partner's grant.
  scope({ grantLevel: "source", sourceVideoRecordId: "rec-a2", canTrain: false }),
  scope({ partnerId: "partner-c" }),
  scope({ partnerId: "partner-c", revokedAt: new Date("2026-06-01T00:00:00Z") }),
  scope({ partnerId: "partner-d", restrictions: { noIdentifiableMinors: true } }),
];

const withRecord = (a: Asset) => {
  const record = RECORDS.find((r) => r.id === a.sourceVideoRecordId);
  return { ...a, sourceVideoRecord: record ? { partnerId: record.partnerId, acquisitionStatus: record.acquisitionStatus } : null };
};
type ScopeWhere = { partnerId?: string | { in: string[] }; sourceVideoRecordId?: string | { in: string[] }; playerId?: string };
const hits = (value: string | null, wanted: string | { in: string[] } | undefined) => value !== null && wanted !== undefined && (typeof wanted === "string" ? wanted === value : wanted.in.includes(value));

const prisma = {
  visionVideoAsset: {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const a = ASSETS.find((x) => x.id === where.id);
      return a ? withRecord(a) : null;
    }),
    findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => ASSETS.filter((a) => where.id.in.includes(a.id)).map(withRecord)),
  },
  visionSourceVideoRecord: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => RECORDS.find((r) => r.id === where.id) ?? null) },
  visionRightsScope: {
    findMany: vi.fn(async ({ where }: { where: { OR: ScopeWhere[] } }) =>
      SCOPES.filter((s) => where.OR.some((w) => hits(s.partnerId, w.partnerId) || hits(s.sourceVideoRecordId, w.sourceVideoRecordId) || hits(s.playerId, w.playerId)))
    ),
  },
};

let service: RightsPolicyService;
beforeEach(() => {
  vi.clearAllMocks();
  service = new RightsPolicyService(prisma as never);
});

describe("training rights for many assets at once", () => {
  const ids = [...ASSETS.map((a) => a.id), "does-not-exist"];

  it("gives each asset the answer it gets when asked alone", async () => {
    const many = await service.canTrainMany(ids, NOW);
    expect([...many.keys()]).toEqual(ids);
    for (const id of ids) expect(many.get(id), id).toEqual(await service.canTrain({ videoAssetId: id }, NOW));
  });

  it("covers every kind of answer, so agreeing is not agreeing on one case", async () => {
    const many = await service.canTrainMany(ids, NOW);
    const reason = (id: string) => {
      const d = many.get(id)!;
      return d.allowed ? "allowed" : d.reason;
    };
    expect(Object.fromEntries(ids.map((id) => [id, reason(id)]))).toEqual({
      granted: "allowed",
      "source-says-no": "no_scope",
      "not-acquired": "pending_acquisition",
      research: "research_corpus",
      // Another partner's grant is not this asset's.
      "no-grant": "no_scope",
      revoked: "revoked",
      restricted: "restriction_violated",
      "no-record": "no_scope",
      "does-not-exist": "no_scope",
    });
  });

  it("reads the assets once and the grants once, however many were asked about", async () => {
    await service.canTrainMany(ids, NOW);
    expect(prisma.visionVideoAsset.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.visionRightsScope.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.visionVideoAsset.findUnique).not.toHaveBeenCalled();
    expect(prisma.visionSourceVideoRecord.findUnique).not.toHaveBeenCalled();
  });

  it("asks an asset once when it is named twice, and nothing when none are named", async () => {
    const many = await service.canTrainMany(["granted", "granted"], NOW);
    expect(many.size).toBe(1);
    vi.clearAllMocks();
    expect((await service.canTrainMany([], NOW)).size).toBe(0);
    expect(prisma.visionVideoAsset.findMany).not.toHaveBeenCalled();
    expect(prisma.visionRightsScope.findMany).not.toHaveBeenCalled();
  });

  it("asks for no grants when no asset has a partner or a record", async () => {
    const many = await service.canTrainMany(["no-record"], NOW);
    expect(many.get("no-record")).toMatchObject({ allowed: false, reason: "no_scope" });
    expect(prisma.visionRightsScope.findMany).not.toHaveBeenCalled();
  });
});
