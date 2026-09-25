import { beforeEach, describe, expect, it, vi } from "vitest";
import { RightsPolicyService } from "./rights-policy.service";

// ── Mock PrismaService ──────────────────────────────────────────────────────
const mockPrisma = {
  visionVideoAsset: { findUnique: vi.fn() },
  visionSourceVideoRecord: { findUnique: vi.fn() },
  visionRightsScope: { findMany: vi.fn() },
};

const PARTNER = "partner-1";
const RECORD = "record-1";
const ASSET = "asset-1";
const PLAYER = "player-1";
const NOW = new Date("2026-09-24T12:00:00Z");

type ScopeOverrides = Partial<{
  id: string;
  grantLevel: string;
  partnerId: string | null;
  sourceVideoRecordId: string | null;
  playerId: string | null;
  canAnalyze: boolean;
  canTrain: boolean;
  canPublishHighlight: boolean;
  canShareWithScout: boolean;
  grantedAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  restrictions: unknown;
}>;

let scopeSeq = 0;

function scope(overrides: ScopeOverrides = {}) {
  return {
    id: `scope-${++scopeSeq}`,
    grantLevel: "partner",
    partnerId: PARTNER,
    sourceVideoRecordId: null,
    playerId: null,
    canAnalyze: false,
    canTrain: false,
    canPublishHighlight: false,
    canShareWithScout: false,
    grantedAt: new Date("2026-01-01T00:00:00Z"),
    expiresAt: null,
    revokedAt: null,
    restrictions: null,
    ...overrides,
  };
}

/** An acquired, DTP-owned asset — the only shape that can be trained on. */
function acquiredAsset(overrides: Partial<{ corpus: string; acquisitionStatus: string }> = {}) {
  return {
    corpus: overrides.corpus ?? "dtp_owned",
    sourceVideoRecordId: RECORD,
    sourceVideoRecord: {
      partnerId: PARTNER,
      acquisitionStatus: overrides.acquisitionStatus ?? "acquired",
    },
  };
}

function makeService() {
  return new RightsPolicyService(mockPrisma as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  scopeSeq = 0;
  mockPrisma.visionVideoAsset.findUnique.mockResolvedValue(acquiredAsset());
  mockPrisma.visionSourceVideoRecord.findUnique.mockResolvedValue({
    partnerId: PARTNER,
    acquisitionStatus: "acquired",
  });
  mockPrisma.visionRightsScope.findMany.mockResolvedValue([]);
});

describe("a denial is never a bare boolean", () => {
  it("carries a reason and remediation the UI can act on", async () => {
    const decision = await makeService().canAnalyze({ videoAssetId: ASSET });

    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error("unreachable");
    expect(decision.reason).toBe("no_scope");
    expect(decision.detail).toContain("canAnalyze");
    expect(decision.remediation).toMatch(/rights evidence/i);
  });

  it("refuses when neither an asset nor a source record is supplied", async () => {
    const decision = await makeService().canAnalyze({});
    expect(decision.allowed).toBe(false);
  });
});

describe("the four scopes are independent", () => {
  it("permits internal analysis while refusing public highlights", async () => {
    mockPrisma.visionRightsScope.findMany.mockResolvedValue([
      scope({ canAnalyze: true, canPublishHighlight: false }),
    ]);
    const service = makeService();

    expect((await service.canAnalyze({ videoAssetId: ASSET })).allowed).toBe(true);
    expect((await service.canPublishHighlight({ videoAssetId: ASSET })).allowed).toBe(false);
  });

  it("does not let an analysis grant imply a training grant", async () => {
    mockPrisma.visionRightsScope.findMany.mockResolvedValue([scope({ canAnalyze: true })]);
    const decision = await makeService().canTrain({ videoAssetId: ASSET });
    expect(decision.allowed).toBe(false);
  });
});

// The single most important behaviour in the module: a guardian's player-level
// withdrawal must override a partner-wide grant. Decision Q2, 24 Sep 2026.
describe("most specific wins, deny beats allow", () => {
  it("lets a player-level withdrawal override a live partner-wide grant", async () => {
    mockPrisma.visionRightsScope.findMany.mockResolvedValue([
      scope({ grantLevel: "partner", canPublishHighlight: true }),
      scope({
        grantLevel: "player",
        partnerId: null,
        playerId: PLAYER,
        canPublishHighlight: true,
        revokedAt: new Date("2026-06-01T00:00:00Z"),
      }),
    ]);

    const decision = await makeService().canPublishHighlight(
      { videoAssetId: ASSET, playerId: PLAYER },
      NOW
    );

    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error("unreachable");
    expect(decision.reason).toBe("revoked");
  });

  it("does not apply another player's withdrawal to this player", async () => {
    mockPrisma.visionRightsScope.findMany.mockResolvedValue([
      scope({ grantLevel: "partner", canPublishHighlight: true }),
    ]);

    const decision = await makeService().canPublishHighlight(
      { videoAssetId: ASSET, playerId: "someone-else" },
      NOW
    );

    expect(decision.allowed).toBe(true);
  });

  it("lets a player-level grant stand where the partner grant is silent", async () => {
    mockPrisma.visionRightsScope.findMany.mockResolvedValue([
      scope({ grantLevel: "partner", canShareWithScout: false }),
      scope({
        grantLevel: "player",
        partnerId: null,
        playerId: PLAYER,
        canShareWithScout: true,
      }),
    ]);

    const decision = await makeService().canShareWithScout(
      { videoAssetId: ASSET, playerId: PLAYER },
      NOW
    );
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) throw new Error("unreachable");
    expect(decision.grantLevel).toBe("player");
  });

  it("does not fall back to a broader grant when a narrower level refuses", async () => {
    mockPrisma.visionRightsScope.findMany.mockResolvedValue([
      scope({ grantLevel: "partner", canTrain: true }),
      scope({
        grantLevel: "source",
        partnerId: null,
        sourceVideoRecordId: RECORD,
        canTrain: false,
      }),
    ]);

    const decision = await makeService().canTrain({ videoAssetId: ASSET }, NOW);
    expect(decision.allowed).toBe(false);
  });

  it("refuses when one applicable grant at a level is revoked, even with a live sibling", async () => {
    mockPrisma.visionRightsScope.findMany.mockResolvedValue([
      scope({ grantLevel: "partner", canAnalyze: true }),
      scope({ grantLevel: "partner", canAnalyze: true, revokedAt: new Date("2026-05-01T00:00:00Z") }),
    ]);

    const decision = await makeService().canAnalyze({ videoAssetId: ASSET }, NOW);
    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error("unreachable");
    expect(decision.reason).toBe("revoked");
  });
});

describe("expiry", () => {
  it("refuses an expired grant and says so", async () => {
    mockPrisma.visionRightsScope.findMany.mockResolvedValue([
      scope({ canAnalyze: true, expiresAt: new Date("2026-08-01T00:00:00Z") }),
    ]);

    const decision = await makeService().canAnalyze({ videoAssetId: ASSET }, NOW);
    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error("unreachable");
    expect(decision.reason).toBe("expired");
  });

  it("refuses a grant that has not started yet", async () => {
    mockPrisma.visionRightsScope.findMany.mockResolvedValue([
      scope({ canAnalyze: true, grantedAt: new Date("2027-01-01T00:00:00Z") }),
    ]);

    expect((await makeService().canAnalyze({ videoAssetId: ASSET }, NOW)).allowed).toBe(false);
  });

  it("reports the expiry on an allowed decision, so a caller can warn ahead", async () => {
    const expiresAt = new Date("2026-12-31T00:00:00Z");
    mockPrisma.visionRightsScope.findMany.mockResolvedValue([scope({ canAnalyze: true, expiresAt })]);

    const decision = await makeService().canAnalyze({ videoAssetId: ASSET }, NOW);
    if (!decision.allowed) throw new Error("expected allow");
    expect(decision.expiresAt).toBe(expiresAt.toISOString());
  });
});

// The firewall: no amount of paperwork makes research-only footage trainable.
describe("training requires a DTP-owned, acquired, checksummed copy", () => {
  it("refuses research-only footage even with canTrain granted", async () => {
    mockPrisma.visionVideoAsset.findUnique.mockResolvedValue(
      acquiredAsset({ corpus: "research_only" })
    );
    mockPrisma.visionRightsScope.findMany.mockResolvedValue([scope({ canTrain: true })]);

    const decision = await makeService().canTrain({ videoAssetId: ASSET }, NOW);
    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error("unreachable");
    expect(decision.reason).toBe("research_corpus");
  });

  it("refuses a catalogued source record with no acquired copy", async () => {
    mockPrisma.visionRightsScope.findMany.mockResolvedValue([
      scope({ canTrain: true, canAnalyze: true }),
    ]);

    const decision = await makeService().canTrain({ sourceVideoRecordId: RECORD }, NOW);
    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error("unreachable");
    expect(decision.reason).toBe("pending_acquisition");
  });

  it("refuses an asset whose acquisition has not completed", async () => {
    mockPrisma.visionVideoAsset.findUnique.mockResolvedValue(
      acquiredAsset({ acquisitionStatus: "acquiring" })
    );
    mockPrisma.visionRightsScope.findMany.mockResolvedValue([scope({ canTrain: true })]);

    const decision = await makeService().canTrain({ videoAssetId: ASSET }, NOW);
    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error("unreachable");
    expect(decision.reason).toBe("pending_acquisition");
  });

  it("allows training on an acquired, DTP-owned asset with the grant", async () => {
    mockPrisma.visionRightsScope.findMany.mockResolvedValue([scope({ canTrain: true })]);
    expect((await makeService().canTrain({ videoAssetId: ASSET }, NOW)).allowed).toBe(true);
  });

  it("still allows analysis of research-only footage, which is what it is for", async () => {
    mockPrisma.visionVideoAsset.findUnique.mockResolvedValue(
      acquiredAsset({ corpus: "research_only" })
    );
    mockPrisma.visionRightsScope.findMany.mockResolvedValue([scope({ canAnalyze: true })]);

    expect((await makeService().canAnalyze({ videoAssetId: ASSET }, NOW)).allowed).toBe(true);
  });
});

describe("restrictions", () => {
  it("blocks only the scope named in a deny list", async () => {
    mockPrisma.visionRightsScope.findMany.mockResolvedValue([
      scope({
        canPublishHighlight: true,
        canAnalyze: true,
        restrictions: { deny: ["canPublishHighlight"] },
      }),
    ]);
    const service = makeService();

    const publish = await service.canPublishHighlight({ videoAssetId: ASSET }, NOW);
    expect(publish.allowed).toBe(false);
    if (publish.allowed) throw new Error("unreachable");
    expect(publish.reason).toBe("restriction_violated");

    // A restriction on publication says nothing about internal analysis: the
    // four scopes stay independent even when one of them is restricted.
    expect((await service.canAnalyze({ videoAssetId: ASSET }, NOW)).allowed).toBe(true);
  });

  // A restriction the code does not understand is not a restriction that can be
  // waived, so an unrecognised shape denies rather than being ignored.
  it("denies on a restriction shape it does not recognise", async () => {
    mockPrisma.visionRightsScope.findMany.mockResolvedValue([
      scope({ canAnalyze: true, restrictions: "territory: NG only" }),
    ]);

    const decision = await makeService().canAnalyze({ videoAssetId: ASSET }, NOW);
    expect(decision.allowed).toBe(false);
  });

  it("ignores an empty restrictions object", async () => {
    mockPrisma.visionRightsScope.findMany.mockResolvedValue([
      scope({ canAnalyze: true, restrictions: {} }),
    ]);

    expect((await makeService().canAnalyze({ videoAssetId: ASSET }, NOW)).allowed).toBe(true);
  });
});

describe("missing subjects", () => {
  it("refuses when the asset does not exist", async () => {
    mockPrisma.visionVideoAsset.findUnique.mockResolvedValue(null);
    const decision = await makeService().canAnalyze({ videoAssetId: "nope" }, NOW);
    expect(decision.allowed).toBe(false);
  });
});

describe("describe()", () => {
  it("reports all four scopes at once for the rights panel", async () => {
    mockPrisma.visionRightsScope.findMany.mockResolvedValue([
      scope({ canAnalyze: true, canTrain: true }),
    ]);

    const all = await makeService().describe({ videoAssetId: ASSET }, NOW);
    expect(all.canAnalyze.allowed).toBe(true);
    expect(all.canTrain.allowed).toBe(true);
    expect(all.canPublishHighlight.allowed).toBe(false);
    expect(all.canShareWithScout.allowed).toBe(false);
  });
});
