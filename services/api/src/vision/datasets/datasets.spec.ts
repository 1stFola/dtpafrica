import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryObjectStore } from "../storage/in-memory-object-store";
import { VisionDatasetsService } from "./datasets.service";
import { DEFAULT_SPLIT_POLICY } from "./split-policy";

/**
 * The dataset factory's two refusals.
 *
 * The gate for this increment: footage DTP has no right to train on must be
 * structurally incapable of entering a corpus, and a dataset whose benchmark shares
 * a match with its training set must be incapable of being frozen. Both are tested
 * as refusals, because "it usually doesn't happen" is not a control.
 */

const VERSION = "dsv-1";

const mockPrisma = {
  visionDatasetVersion: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  visionDatasetMember: {
    findMany: vi.fn(),
    createMany: vi.fn(),
    updateMany: vi.fn(),
    groupBy: vi.fn(),
  },
  visionVideoAsset: { findUnique: vi.fn(), findMany: vi.fn() },
  visionLabelSchemaVersion: { findUnique: vi.fn() },
  visionAnnotationVersion: { findMany: vi.fn() },
  $transaction: vi.fn(),
};

const mockAudit = { record: vi.fn() };
const mockRights = {
  canTrain: vi.fn(),
  /* The batch, answered by asking the single mock about each asset: the tests below set
     what one asset's answer is, and the service now asks about all of them at once. */
  canTrainMany: vi.fn(),
};
const answerMany = () =>
  mockRights.canTrainMany.mockImplementation(async (ids: string[]) => {
    const out = new Map<string, unknown>();
    for (const id of [...new Set(ids)]) out.set(id, await mockRights.canTrain({ videoAssetId: id }));
    return out;
  });

let store: InMemoryObjectStore;
let service: VisionDatasetsService;

/** An asset that passes every gate, so each test can break exactly one. */
function eligibleAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: "asset-1",
    corpus: "dtp_owned",
    checksumSha256: "a".repeat(64),
    duplicateClusterId: null,
    sbMatchId: "match-1",
    sbMatch: { competitionId: "comp-1" },
    sourceVideoRecord: { acquisitionStatus: "acquired" },
    ...overrides,
  };
}

function unfrozenVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: VERSION,
    label: "v1",
    frozenAt: null,
    labelSchemaVersionId: null,
    splitPolicy: DEFAULT_SPLIT_POLICY,
    leakageReport: null,
    ...overrides,
  };
}

/**
 * A member row wide enough for every `select` the service issues.
 *
 * `checkLeakage`, `freeze` and `representation` each read different columns from
 * the same table, and one mock serves all three. `videoAsset` is a required
 * relation, so Prisma always returns it — omitting it here would be the mock
 * disagreeing with the database rather than the service being unguarded.
 */
function member(videoAssetId: string, groupKey: string, split: string) {
  return {
    id: `m-${videoAssetId}-${split}`,
    videoAssetId,
    groupKey,
    split,
    checksumSha256: "a".repeat(64),
    sbMatchId: null,
    videoAsset: {
      width: 1280,
      height: 720,
      isVariableFrameRate: false,
      sbMatch: { competitionId: "comp-1", competition: { name: "Lagos League" } },
      sourceVideoRecord: { sourceQualityRank: "broadcast", partnerId: "partner-1" },
    },
  };
}


/**
 * Install the member rows, honouring the parts of `where` that freeze relies on.
 *
 * `freeze` reads the members table three times with three different filters — all
 * of them, the gold split, and the same assets held out by *other* frozen versions.
 * A mock answering every call with the same rows would report every member as gold
 * and as contaminated, so the filters have to be respected rather than ignored.
 */
function membersAre(rows: ReturnType<typeof member>[]) {
  mockPrisma.visionDatasetMember.findMany.mockImplementation(({ where }: never) => {
    const w = (where ?? {}) as { split?: string | { in: string[] }; datasetVersionId?: unknown };
    /* The cross-version lookup. No test here has a second version, so nothing is
       held out by one. */
    if (w.datasetVersionId && typeof w.datasetVersionId === "object") return Promise.resolve([]);
    if (typeof w.split === "string") return Promise.resolve(rows.filter((r) => r.split === w.split));
    if (w.split && "in" in w.split) {
      const wanted = w.split.in;
      return Promise.resolve(rows.filter((r) => wanted.includes(r.split)));
    }
    return Promise.resolve(rows);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  store = new InMemoryObjectStore();
  service = new VisionDatasetsService(
    mockPrisma as never,
    store,
    mockRights as never,
    mockAudit as never
  );

  mockPrisma.visionDatasetVersion.findUnique.mockResolvedValue(unfrozenVersion());
  mockPrisma.visionDatasetVersion.update.mockImplementation(({ data }: never) =>
    Promise.resolve({ ...unfrozenVersion(), ...(data as object) })
  );
  mockPrisma.visionDatasetMember.findMany.mockResolvedValue([]);
  mockPrisma.visionDatasetMember.createMany.mockResolvedValue({ count: 0 });
  mockPrisma.visionDatasetMember.groupBy.mockResolvedValue([]);
  mockPrisma.visionAnnotationVersion.findMany.mockResolvedValue([]);
  mockPrisma.visionVideoAsset.findUnique.mockResolvedValue(eligibleAsset());
  /* Adding members reads the assets in one query. It answers from what a test set for one
     asset, under the id that was asked for, and leaves out an asset that does not exist. */
  mockPrisma.visionVideoAsset.findMany.mockImplementation(async ({ where }: never) => {
    const ids = ((where as { id?: { in?: string[] } }).id?.in ?? []) as string[];
    const rows = await Promise.all(ids.map(async (id) => [id, await mockPrisma.visionVideoAsset.findUnique({ where: { id } })] as const));
    return rows.filter(([, row]) => row).map(([id, row]) => ({ ...(row as object), id }));
  });
  mockRights.canTrain.mockResolvedValue({ allowed: true, reason: "granted", remediation: "" });
  answerMany();
  mockPrisma.$transaction.mockResolvedValue([]);
});

describe("dataset membership eligibility", () => {
  it("admits an asset that satisfies every condition", async () => {
    const result = await service.addMembers(VERSION, ["asset-1"]);
    expect(result).toEqual({ added: 1, rejected: [] });
    expect(mockPrisma.visionDatasetMember.createMany).toHaveBeenCalledOnce();
  });

  it("refuses research-only footage", async () => {
    // The corpus firewall. A catalogued URL DTP may study but not train on must
    // never reach a training set, whatever an operator clicks.
    mockPrisma.visionVideoAsset.findUnique.mockResolvedValue(
      eligibleAsset({ corpus: "research_only" })
    );

    const result = await service.addMembers(VERSION, ["asset-1"]);
    expect(result.added).toBe(0);
    expect(result.rejected[0]).toMatchObject({ videoAssetId: "asset-1", reason: "wrong_corpus" });
    expect(mockPrisma.visionDatasetMember.createMany).not.toHaveBeenCalled();
  });

  it("refuses experimental footage as well", async () => {
    mockPrisma.visionVideoAsset.findUnique.mockResolvedValue(
      eligibleAsset({ corpus: "experimental" })
    );
    const result = await service.addMembers(VERSION, ["asset-1"]);
    expect(result.rejected[0]?.reason).toBe("wrong_corpus");
  });

  it("refuses an asset whose source was never acquired", async () => {
    mockPrisma.visionVideoAsset.findUnique.mockResolvedValue(
      eligibleAsset({ sourceVideoRecord: { acquisitionStatus: "authorized" } })
    );
    const result = await service.addMembers(VERSION, ["asset-1"]);
    expect(result.rejected[0]?.reason).toBe("not_acquired");
  });

  it("refuses an asset with no checksum", async () => {
    // A placeholder is what an in-flight upload leaves behind. Without real bytes
    // the dataset cannot prove what it was built from.
    mockPrisma.visionVideoAsset.findUnique.mockResolvedValue(
      eligibleAsset({ checksumSha256: "" })
    );
    const result = await service.addMembers(VERSION, ["asset-1"]);
    expect(result.rejected[0]?.reason).toBe("no_checksum");
  });

  it("refuses a checksum that is the wrong length to be a SHA-256", async () => {
    mockPrisma.visionVideoAsset.findUnique.mockResolvedValue(
      eligibleAsset({ checksumSha256: "deadbeef" })
    );
    const result = await service.addMembers(VERSION, ["asset-1"]);
    expect(result.rejected[0]?.reason).toBe("no_checksum");
  });

  it("refuses an asset whose training right is denied", async () => {
    mockRights.canTrain.mockResolvedValue({
      allowed: false,
      reason: "guardian_withdrawal",
      remediation: "Restore the grant or remove the asset.",
    });
    const result = await service.addMembers(VERSION, ["asset-1"]);
    expect(result.rejected[0]).toMatchObject({ reason: "rights_denied" });
    // The remediation travels with the refusal: an operator must be able to act.
    expect(result.rejected[0]?.detail).toContain("Restore the grant");
  });

  it("checks rights rather than inferring them from the corpus", async () => {
    // A `dtp_owned` asset is not automatically trainable — a guardian can withdraw
    // consent for footage DTP does own. Conflating the two would make the rights
    // module decorative.
    await service.addMembers(VERSION, ["asset-1"]);
    expect(mockRights.canTrain).toHaveBeenCalledWith({ videoAssetId: "asset-1" });
  });

  it("refuses an unknown asset without throwing", async () => {
    mockPrisma.visionVideoAsset.findUnique.mockResolvedValue(null);
    const result = await service.addMembers(VERSION, ["asset-1"]);
    expect(result.rejected[0]?.reason).toBe("unknown_asset");
  });

  it("reads the assets once and asks about their rights once, however many are added", async () => {
    mockPrisma.visionVideoAsset.findUnique.mockImplementation(({ where }: never) => Promise.resolve((where as { id: string }).id === "gone" ? null : eligibleAsset({ id: (where as { id: string }).id })));
    mockPrisma.visionDatasetMember.findMany.mockResolvedValue([{ videoAssetId: "in-already" }]);
    const result = await service.addMembers(VERSION, ["a-1", "a-2", "a-3", "gone", "in-already", "a-1"]);
    expect(result.added).toBe(3);
    expect(result.rejected.map((r) => `${r.videoAssetId}:${r.reason}`).sort()).toEqual(["gone:unknown_asset", "in-already:already_member"]);
    expect(mockPrisma.visionVideoAsset.findMany).toHaveBeenCalledTimes(1);
    // Not the one already a member, and no asset twice.
    expect(mockPrisma.visionVideoAsset.findMany.mock.calls[0]![0].where).toEqual({ id: { in: ["a-1", "a-2", "a-3", "gone"] } });
    expect(mockRights.canTrainMany).toHaveBeenCalledTimes(1);
    // Rights are asked about the assets that exist.
    expect(mockRights.canTrainMany.mock.calls[0]![0]).toEqual(["a-1", "a-2", "a-3"]);
  });

  it("admits the eligible and reports the rest, rather than failing the batch", async () => {
    // An operator adding 200 assets needs the 198 that qualify plus a list of the
    // two that did not, not an all-or-nothing failure with no explanation.
    mockPrisma.visionVideoAsset.findUnique.mockImplementation(({ where }: never) => {
      const id = (where as { id: string }).id;
      return Promise.resolve(
        id === "bad" ? eligibleAsset({ id, corpus: "research_only" }) : eligibleAsset({ id })
      );
    });

    const result = await service.addMembers(VERSION, ["good-1", "bad", "good-2"]);
    expect(result.added).toBe(2);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.videoAssetId).toBe("bad");
  });

  it("records the refusals in the audit log", async () => {
    // The record that footage was offered to a corpus and declined, and why, is the
    // evidence a rights question is answered with later.
    mockPrisma.visionVideoAsset.findUnique.mockResolvedValue(
      eligibleAsset({ corpus: "research_only" })
    );
    await service.addMembers(VERSION, ["asset-1"]);

    const entry = mockAudit.record.mock.calls[0]?.[0];
    expect(entry.action).toBe("dataset.member.added");
    expect(entry.data.rejections[0].reason).toBe("wrong_corpus");
  });

  it("does not add the same asset twice", async () => {
    mockPrisma.visionDatasetMember.findMany.mockResolvedValue([{ videoAssetId: "asset-1" }]);
    const result = await service.addMembers(VERSION, ["asset-1"]);
    expect(result.rejected[0]?.reason).toBe("already_member");
  });

  it("de-duplicates the request itself", async () => {
    const result = await service.addMembers(VERSION, ["asset-1", "asset-1", "asset-1"]);
    expect(result.added).toBe(1);
  });

  it("refuses to add to a frozen version", async () => {
    mockPrisma.visionDatasetVersion.findUnique.mockResolvedValue(
      unfrozenVersion({ frozenAt: new Date("2026-01-01") })
    );
    await expect(service.addMembers(VERSION, ["asset-1"])).rejects.toThrow(ConflictException);
  });

  it("stores the checksum on the member, not just a pointer to the asset", async () => {
    // Denormalised so a frozen manifest still proves which bytes it holds even if
    // the asset row is later touched.
    await service.addMembers(VERSION, ["asset-1"]);
    const rows = mockPrisma.visionDatasetMember.createMany.mock.calls[0]?.[0].data;
    expect(rows[0]).toMatchObject({ checksumSha256: "a".repeat(64), groupKey: "match:match-1" });
  });
});

describe("leakage checker", () => {
  it("passes when every group sits in one split", async () => {
    mockPrisma.visionDatasetMember.findMany.mockResolvedValue([
      member("a", "match:1", "train"),
      member("b", "match:1", "train"),
      member("c", "match:2", "test"),
    ]);

    const report = await service.checkLeakage(VERSION);
    expect(report.ok).toBe(true);
    expect(report.groups).toBe(2);
    expect(report.splitSizes).toEqual({ train: 2, test: 1 });
  });

  it("catches a match that spans train and test", async () => {
    // The failure the whole split policy exists to prevent: a benchmark sharing a
    // match with its training set reports a number nobody should act on.
    mockPrisma.visionDatasetMember.findMany.mockResolvedValue([
      member("a", "match:1", "train"),
      member("b", "match:1", "test"),
    ]);

    const report = await service.checkLeakage(VERSION);
    expect(report.ok).toBe(false);
    expect(report.offendingGroups).toEqual([
      { groupKey: "match:1", splits: ["test", "train"], videoAssetIds: ["a", "b"] },
    ]);
  });

  it("names every offending group, not just the first", async () => {
    mockPrisma.visionDatasetMember.findMany.mockResolvedValue([
      member("a", "match:1", "train"),
      member("b", "match:1", "val"),
      member("c", "match:2", "train"),
      member("d", "match:2", "gold"),
    ]);
    const report = await service.checkLeakage(VERSION);
    expect(report.offendingGroups).toHaveLength(2);
  });

  it("treats an empty version as clean rather than erroring", async () => {
    const report = await service.checkLeakage(VERSION);
    expect(report).toMatchObject({ ok: true, groups: 0, members: 0 });
  });
});

describe("split generation", () => {
  it("assigns whole groups, so generated splits never leak", async () => {
    // The generator and the checker are tested against each other on purpose: the
    // property that matters is that generation cannot produce a state the checker
    // rejects.
    const members = Array.from({ length: 40 }, (_, i) =>
      member(`a${i}`, `match:${i % 8}`, "train")
    );
    mockPrisma.visionDatasetMember.findMany.mockResolvedValue(members);

    const assigned = new Map<string, string>();
    mockPrisma.visionDatasetMember.updateMany.mockImplementation(({ where, data }: never) => {
      for (const g of (where as { groupKey: { in: string[] } }).groupKey.in) {
        assigned.set(g, (data as { split: string }).split);
      }
      return Promise.resolve({ count: 0 });
    });
    mockPrisma.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));

    // The leakage check inside generateSplits re-reads members; reflect the
    // assignment so the report describes the state that was written.
    mockPrisma.visionDatasetMember.findMany.mockImplementation(() =>
      Promise.resolve(
        members.map((m) => ({ ...m, split: assigned.get(m.groupKey) ?? m.split }))
      )
    );

    const result = await service.generateSplits(VERSION);
    expect(result.groups).toBe(8);
    expect(result.leakage.ok).toBe(true);
  });

  it("refuses to split a version with no members", async () => {
    await expect(service.generateSplits(VERSION)).rejects.toThrow(BadRequestException);
  });

  it("refuses to split a frozen version", async () => {
    mockPrisma.visionDatasetVersion.findUnique.mockResolvedValue(
      unfrozenVersion({ frozenAt: new Date() })
    );
    await expect(service.generateSplits(VERSION)).rejects.toThrow(ConflictException);
  });

  it("rejects a stored policy that is no longer valid", async () => {
    // A policy edited in the database directly must fail loudly, not fall through
    // to per-asset grouping.
    mockPrisma.visionDatasetVersion.findUnique.mockResolvedValue(
      unfrozenVersion({ splitPolicy: { ...DEFAULT_SPLIT_POLICY, groupBy: [] } })
    );
    await expect(service.generateSplits(VERSION)).rejects.toThrow(BadRequestException);
  });
});

describe("freeze", () => {
  const cleanMembers = [member("a", "match:1", "train"), member("b", "match:2", "test")];

  function splitsGenerated(count = cleanMembers.length) {
    return {
      ok: true,
      checkedAt: new Date().toISOString(),
      groups: count,
      members: count,
      offendingGroups: [],
      splitSizes: {},
    };
  }

  beforeEach(() => {
    membersAre(cleanMembers);
    mockPrisma.visionDatasetVersion.findUnique.mockResolvedValue(
      unfrozenVersion({ leakageReport: splitsGenerated() })
    );
  });

  it("re-checks every member's rights with one question", async () => {
    // It asked about one member at a time, three queries each, in sequence.
    await service.freeze(VERSION);
    expect(mockRights.canTrainMany).toHaveBeenCalledTimes(1);
    expect(mockRights.canTrainMany.mock.calls[0]![0]).toHaveLength(cleanMembers.length);
  });

  it("freezes a clean version and writes a manifest", async () => {
    const result = await service.freeze(VERSION);
    expect(result.manifestKey).toContain(VERSION);

    // `derived`, not `master`: the manifest is a projection of the members table,
    // regenerable from it, so it is not an irreplaceable object. It is exempt from
    // lifecycle expiry all the same — see docs/vision/05-STORAGE.md.
    const raw = await store.getSmallObject("derived", result.manifestKey);
    const manifest = JSON.parse(raw!.toString("utf8"));
    expect(manifest.members).toHaveLength(2);
    expect(manifest.members[0].checksumSha256).toBe("a".repeat(64));
    expect(manifest.leakage.ok).toBe(true);
  });

  it("re-checks rights at freeze rather than trusting the grant from insertion", async () => {
    // A scope can be withdrawn between adding a member and freezing. Freezing a
    // dataset that has since lost its training right is the mistake that cannot be
    // undone afterwards.
    mockRights.canTrain.mockResolvedValue({
      allowed: false,
      reason: "partner_agreement_expired",
      remediation: "Renew the agreement.",
    });

    await expect(service.freeze(VERSION)).rejects.toThrow(ForbiddenException);
    expect(mockPrisma.visionDatasetVersion.update).not.toHaveBeenCalled();
  });

  it("refuses to freeze while any group spans two splits", async () => {
    membersAre([member("a", "match:1", "train"), member("b", "match:1", "test")]);
    mockPrisma.visionDatasetVersion.findUnique.mockResolvedValue(
      unfrozenVersion({ leakageReport: splitsGenerated(2) })
    );

    await expect(service.freeze(VERSION)).rejects.toThrow(ConflictException);
    expect(mockPrisma.visionDatasetVersion.update).not.toHaveBeenCalled();
  });

  it("refuses to freeze before splits have ever been generated", async () => {
    // Otherwise the version is 100% train: one split, so the leakage check passes
    // trivially and the result is a corpus with no test set that looks validated.
    mockPrisma.visionDatasetVersion.findUnique.mockResolvedValue(
      unfrozenVersion({ leakageReport: null })
    );
    await expect(service.freeze(VERSION)).rejects.toThrow(ConflictException);
  });

  it("refuses to freeze when members were added after splits were generated", async () => {
    // The same bug arriving more quietly: the new members are all in the default
    // split, and nothing re-ran the assignment.
    mockPrisma.visionDatasetVersion.findUnique.mockResolvedValue(
      unfrozenVersion({ leakageReport: splitsGenerated(1) })
    );
    await expect(service.freeze(VERSION)).rejects.toThrow(ConflictException);
  });

  it("refuses to freeze an empty version", async () => {
    membersAre([]);
    await expect(service.freeze(VERSION)).rejects.toThrow(BadRequestException);
  });

  it("refuses to freeze twice", async () => {
    mockPrisma.visionDatasetVersion.findUnique.mockResolvedValue(
      unfrozenVersion({ frozenAt: new Date(), leakageReport: splitsGenerated() })
    );
    await expect(service.freeze(VERSION)).rejects.toThrow(ConflictException);
  });

  it("audits the freeze", async () => {
    await service.freeze(VERSION);
    const actions = mockAudit.record.mock.calls.map((c) => c[0].action);
    expect(actions).toContain("dataset.frozen");
  });
});

describe("revocation", () => {
  it("flags every version holding a revoked asset without rewriting history", async () => {
    // A frozen dataset is not edited. The flag blocks new training runs; deleting
    // the record to look clean would make DTP unable to answer which datasets were
    // affected, which is the question that actually gets asked.
    mockPrisma.visionDatasetMember.findMany.mockResolvedValue([
      { datasetVersionId: "dsv-1" },
      { datasetVersionId: "dsv-2" },
      { datasetVersionId: "dsv-1" },
    ]);
    mockPrisma.visionDatasetVersion.updateMany.mockResolvedValue({ count: 2 });

    const result = await service.flagVersionsContaining(["asset-1"], "guardian withdrawal");
    expect(result.datasetVersions).toEqual(["dsv-1", "dsv-2"]);
    expect(mockPrisma.visionDatasetVersion.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["dsv-1", "dsv-2"] } },
      data: { containsRevokedMembers: true },
    });
  });

  it("is a no-op when the asset is in no dataset", async () => {
    mockPrisma.visionDatasetMember.findMany.mockResolvedValue([]);
    const result = await service.flagVersionsContaining(["asset-1"], "guardian withdrawal");
    expect(result.datasetVersions).toEqual([]);
    expect(mockPrisma.visionDatasetVersion.updateMany).not.toHaveBeenCalled();
  });

  it("resolves a partner-wide withdrawal to that partner's assets", async () => {
    mockPrisma.visionVideoAsset.findMany.mockResolvedValue([{ id: "asset-1" }]);
    mockPrisma.visionDatasetMember.findMany.mockResolvedValue([{ datasetVersionId: "dsv-1" }]);
    mockPrisma.visionDatasetVersion.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.flagVersionsForRevokedScope(
      { partnerId: "partner-1" },
      "agreement ended"
    );
    expect(result.datasetVersions).toEqual(["dsv-1"]);
    expect(mockPrisma.visionVideoAsset.findMany).toHaveBeenCalledWith({
      where: { sourceVideoRecord: { partnerId: "partner-1" } },
      select: { id: true },
    });
  });

  it("prefers the narrower source record when a scope names both", async () => {
    mockPrisma.visionVideoAsset.findMany.mockResolvedValue([]);
    await service.flagVersionsForRevokedScope(
      { partnerId: "partner-1", sourceVideoRecordId: "rec-1" },
      "one match withdrawn"
    );
    // Revoking one match must not flag every dataset holding that partner's footage.
    expect(mockPrisma.visionVideoAsset.findMany).toHaveBeenCalledWith({
      where: { sourceVideoRecordId: "rec-1" },
      select: { id: true },
    });
  });

  it("reports a player-level withdrawal as unresolved rather than as affecting nothing", async () => {
    // Resolving a player to assets needs the identity graph, which is Phase 4.
    // Returning an empty list would be a lie in the shape of a success.
    const result = await service.flagVersionsForRevokedScope(
      { playerId: "player-1" },
      "guardian withdrawal"
    );
    expect(result).toEqual({ datasetVersions: [], unresolvedPlayerScope: true });
  });
});
