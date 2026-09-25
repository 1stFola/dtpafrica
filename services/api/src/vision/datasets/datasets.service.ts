import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ACQUIRED_STATUS, TRAINABLE_CORPUS, visionKeys } from "@dtp/vision-contracts";
import type { AdminAuthContext } from "../../admin/auth/admin-auth.types";
import { PrismaService } from "../../prisma/prisma.service";
import { VisionAuditService } from "../audit/vision-audit.service";
import { RightsPolicyService } from "../rights/rights-policy.service";
import { OBJECT_STORE, type ObjectStore } from "../storage/object-store";
import {
  DATASET_SPLITS,
  InvalidSplitPolicyError,
  groupKeyFor,
  pickSplit,
  resolvePolicy,
  type DatasetSplit,
  type SplitPolicy,
} from "./split-policy";

/**
 * The dataset factory.
 *
 * Two jobs, and both of them are refusals. Membership eligibility stops footage
 * DTP has no right to train on reaching a corpus, and the leakage checker stops a
 * benchmark being quietly inflated by the same match appearing on both sides of a
 * split. Annotation tooling built on top of a dataset that cannot be trusted is
 * wasted work, which is why these come first.
 *
 * See docs/vision/09-ML-PIPELINE.md, docs/vision/10-EVALUATION-AND-GATES.md and
 * docs/vision/22-PHASE-2-INCREMENT-1.md.
 */

export type EligibilityFailure = {
  videoAssetId: string;
  reason:
    | "unknown_asset"
    | "wrong_corpus"
    | "not_acquired"
    | "no_checksum"
    | "rights_denied"
    | "already_member";
  detail: string;
};

export type LeakageReport = {
  ok: boolean;
  checkedAt: string;
  groups: number;
  members: number;
  /** Groups whose members landed in more than one split. Must be empty to freeze. */
  offendingGroups: { groupKey: string; splits: string[]; videoAssetIds: string[] }[];
  splitSizes: Record<string, number>;
};

@Injectable()
export class VisionDatasetsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    @Inject(RightsPolicyService) private readonly rights: RightsPolicyService,
    @Inject(VisionAuditService) private readonly audit: VisionAuditService
  ) {}

  // ── Versions ─────────────────────────────────────────────────────────────

  async createVersion(
    dto: { label: string; description?: string; labelSchemaVersionId?: string; splitPolicy?: Partial<SplitPolicy> },
    actor?: AdminAuthContext
  ) {
    const policy = toPolicy(dto.splitPolicy);

    if (dto.labelSchemaVersionId) {
      const schema = await this.prisma.visionLabelSchemaVersion.findUnique({
        where: { id: dto.labelSchemaVersionId },
        select: { id: true },
      });
      if (!schema) throw new NotFoundException(`Unknown label schema ${dto.labelSchemaVersionId}`);
    }

    const version = await this.prisma.visionDatasetVersion.create({
      data: {
        label: dto.label,
        description: dto.description ?? null,
        labelSchemaVersionId: dto.labelSchemaVersionId ?? null,
        splitPolicy: policy as never,
      },
    });

    await this.audit.record(
      {
        action: "dataset.version.created",
        targetKind: "vision_dataset_version",
        targetId: version.id,
        data: { label: version.label, splitPolicy: policy },
      },
      actor
    );
    return version;
  }

  async listVersions() {
    const versions = await this.prisma.visionDatasetVersion.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { members: true, modelVersions: true } } },
    });
    return { versions };
  }

  async getVersion(id: string) {
    const version = await this.prisma.visionDatasetVersion.findUnique({
      where: { id },
      include: {
        labelSchemaVersion: { select: { id: true, version: true } },
        _count: { select: { members: true, modelVersions: true } },
      },
    });
    if (!version) throw new NotFoundException(`Unknown dataset version ${id}`);

    const bySplit = await this.prisma.visionDatasetMember.groupBy({
      by: ["split"],
      where: { datasetVersionId: id },
      _count: { _all: true },
    });

    return {
      version,
      splitSizes: Object.fromEntries(bySplit.map((r) => [r.split, r._count._all])),
    };
  }

  // ── Membership ───────────────────────────────────────────────────────────

  /**
   * Add assets, refusing every one that is not eligible.
   *
   * Four conditions, all of them, every time, in a transaction: a DTP-owned
   * corpus, an acquired copy, a real checksum, and `canTrain` granted **right
   * now**. This is the firewall — research-only footage and catalogued URLs are
   * structurally incapable of entering a corpus, rather than merely discouraged.
   *
   * Partial success is deliberate: an operator adding 200 assets should get the
   * 198 that qualify plus a list of the two that did not, not an all-or-nothing
   * failure with no explanation.
   */
  async addMembers(
    datasetVersionId: string,
    videoAssetIds: string[],
    actor?: AdminAuthContext
  ): Promise<{ added: number; rejected: EligibilityFailure[] }> {
    const version = await this.requireUnfrozen(datasetVersionId);
    const policy = toPolicy(version.splitPolicy as Partial<SplitPolicy> | null);

    const existing = new Set(
      (
        await this.prisma.visionDatasetMember.findMany({
          where: { datasetVersionId: version.id },
          select: { videoAssetId: true },
        })
      ).map((m) => m.videoAssetId)
    );

    const rejected: EligibilityFailure[] = [];
    const eligible: { videoAssetId: string; checksum: string; groupKey: string; sbMatchId: string | null }[] = [];

    for (const videoAssetId of [...new Set(videoAssetIds)]) {
      if (existing.has(videoAssetId)) {
        rejected.push({ videoAssetId, reason: "already_member", detail: "already in this version" });
        continue;
      }

      const asset = await this.prisma.visionVideoAsset.findUnique({
        where: { id: videoAssetId },
        select: {
          id: true,
          corpus: true,
          checksumSha256: true,
          duplicateClusterId: true,
          sbMatchId: true,
          sbMatch: { select: { competitionId: true } },
          sourceVideoRecord: { select: { acquisitionStatus: true } },
        },
      });

      if (!asset) {
        rejected.push({ videoAssetId, reason: "unknown_asset", detail: "no such asset" });
        continue;
      }
      if (asset.corpus !== TRAINABLE_CORPUS) {
        rejected.push({
          videoAssetId,
          reason: "wrong_corpus",
          detail: `corpus is "${asset.corpus}"; only "${TRAINABLE_CORPUS}" may be trained on`,
        });
        continue;
      }
      if (asset.sourceVideoRecord?.acquisitionStatus !== ACQUIRED_STATUS) {
        rejected.push({
          videoAssetId,
          reason: "not_acquired",
          detail: `acquisition status is "${asset.sourceVideoRecord?.acquisitionStatus ?? "none"}"`,
        });
        continue;
      }
      // A placeholder is what an in-flight upload leaves behind. Without a real
      // checksum a dataset cannot prove which bytes it was built from.
      if (!asset.checksumSha256 || asset.checksumSha256.length !== 64) {
        rejected.push({
          videoAssetId,
          reason: "no_checksum",
          detail: "no SHA-256 recorded; run the fingerprint stage first",
        });
        continue;
      }

      const decision = await this.rights.canTrain({ videoAssetId });
      if (!decision.allowed) {
        rejected.push({
          videoAssetId,
          reason: "rights_denied",
          detail: `${decision.reason}: ${decision.remediation}`,
        });
        continue;
      }

      eligible.push({
        videoAssetId,
        checksum: asset.checksumSha256,
        groupKey: groupKeyFor(
          {
            id: asset.id,
            duplicateClusterId: asset.duplicateClusterId,
            sbMatchId: asset.sbMatchId,
            competitionId: asset.sbMatch?.competitionId ?? null,
          },
          policy
        ),
        sbMatchId: asset.sbMatchId,
      });
    }

    if (eligible.length) {
      await this.prisma.visionDatasetMember.createMany({
        data: eligible.map((e) => ({
          datasetVersionId: version.id,
          videoAssetId: e.videoAssetId,
          // Denormalised on purpose: if the asset row is ever touched, the dataset
          // can still prove which bytes it was built from.
          checksumSha256: e.checksum,
          groupKey: e.groupKey,
          sbMatchId: e.sbMatchId,
          split: "train",
        })),
        skipDuplicates: true,
      });
    }

    await this.audit.record(
      {
        action: "dataset.member.added",
        targetKind: "vision_dataset_version",
        targetId: version.id,
        data: {
          added: eligible.length,
          rejected: rejected.length,
          // The refusals are the audit value: this is the record that footage was
          // offered to a corpus and declined, and why.
          rejections: rejected.slice(0, 50),
        },
      },
      actor
    );

    return { added: eligible.length, rejected };
  }

  // ── Splits ───────────────────────────────────────────────────────────────

  /**
   * Assign splits by **group**, never by member.
   *
   * Frames from the same match leak appearance into validation and make metrics
   * look strong while the model has learned nothing generalisable. So the unit of
   * assignment is the group — a duplicate cluster, else a match, else the asset
   * itself — and a whole group lands in one split.
   *
   * Deterministic: the assignment is a hash of `(seed, groupKey)`, so the same
   * corpus and policy produce the same splits on any machine. A random shuffle
   * would make a dataset version unreproducible, which defeats the point of
   * versioning it.
   */
  async generateSplits(datasetVersionId: string, actor?: AdminAuthContext) {
    const version = await this.requireUnfrozen(datasetVersionId);
    const policy = toPolicy(version.splitPolicy as Partial<SplitPolicy> | null);

    const members = await this.prisma.visionDatasetMember.findMany({
      where: { datasetVersionId: version.id },
      select: { id: true, groupKey: true },
    });
    if (!members.length) {
      throw new BadRequestException("This version has no members to split");
    }

    const groups = [...new Set(members.map((m) => m.groupKey))].sort();
    const assignment = new Map<string, DatasetSplit>();
    for (const groupKey of groups) {
      assignment.set(groupKey, pickSplit(groupKey, policy));
    }

    // One update per split rather than per member: a 500-match corpus is four
    // statements, not two thousand.
    await this.prisma.$transaction(
      DATASET_SPLITS.map((split) =>
        this.prisma.visionDatasetMember.updateMany({
          where: {
            datasetVersionId: version.id,
            groupKey: { in: groups.filter((g) => assignment.get(g) === split) },
          },
          data: { split },
        })
      )
    );

    const report = await this.checkLeakage(version.id);
    await this.prisma.visionDatasetVersion.update({
      where: { id: version.id },
      data: { leakageReport: report as never },
    });

    await this.audit.record(
      {
        action: "dataset.split.generated",
        targetKind: "vision_dataset_version",
        targetId: version.id,
        data: {
          groups: groups.length,
          members: members.length,
          splitSizes: report.splitSizes,
          leakageOk: report.ok,
        },
      },
      actor
    );

    return { groups: groups.length, members: members.length, leakage: report };
  }

  /**
   * Prove that no group spans more than one split.
   *
   * The assertion the whole split policy exists to support, and the reason a
   * dataset cannot be frozen while it fails: a benchmark that shares a match with
   * its training set reports a number nobody should act on.
   */
  async checkLeakage(datasetVersionId: string): Promise<LeakageReport> {
    const members = await this.prisma.visionDatasetMember.findMany({
      where: { datasetVersionId },
      select: { videoAssetId: true, groupKey: true, split: true },
    });

    const byGroup = new Map<string, { splits: Set<string>; assets: string[] }>();
    const splitSizes: Record<string, number> = {};

    for (const member of members) {
      splitSizes[member.split] = (splitSizes[member.split] ?? 0) + 1;
      const entry = byGroup.get(member.groupKey) ?? { splits: new Set<string>(), assets: [] };
      entry.splits.add(member.split);
      entry.assets.push(member.videoAssetId);
      byGroup.set(member.groupKey, entry);
    }

    const offendingGroups = [...byGroup.entries()]
      .filter(([, entry]) => entry.splits.size > 1)
      .map(([groupKey, entry]) => ({
        groupKey,
        splits: [...entry.splits].sort(),
        videoAssetIds: entry.assets,
      }));

    return {
      ok: offendingGroups.length === 0,
      checkedAt: new Date().toISOString(),
      groups: byGroup.size,
      members: members.length,
      offendingGroups,
      splitSizes,
    };
  }

  /**
   * Distribution across the axes a model is judged on.
   *
   * This is how a corpus quietly dominated by one competition in daylight gets
   * caught before a model trained on it fails everywhere else.
   */
  async representation(datasetVersionId: string) {
    const members = await this.prisma.visionDatasetMember.findMany({
      where: { datasetVersionId },
      select: {
        split: true,
        videoAsset: {
          select: {
            width: true,
            height: true,
            isVariableFrameRate: true,
            sbMatch: { select: { competitionId: true, competition: { select: { name: true } } } },
            sourceVideoRecord: { select: { sourceQualityRank: true, partnerId: true } },
          },
        },
      },
    });

    const tally = (values: (string | null)[]) => {
      const counts: Record<string, number> = {};
      for (const value of values) counts[value ?? "unknown"] = (counts[value ?? "unknown"] ?? 0) + 1;
      return counts;
    };

    return {
      members: members.length,
      bySplit: tally(members.map((m) => m.split)),
      byCompetition: tally(members.map((m) => m.videoAsset.sbMatch?.competition?.name ?? null)),
      byPartner: tally(members.map((m) => m.videoAsset.sourceVideoRecord?.partnerId ?? null)),
      // A benchmark slice in its own right: platform compression destroys exactly
      // the small-object detail the engine depends on.
      bySourceQuality: tally(members.map((m) => m.videoAsset.sourceVideoRecord?.sourceQualityRank ?? null)),
      byResolution: tally(
        members.map((m) =>
          m.videoAsset.height ? `${m.videoAsset.height}p` : null
        )
      ),
      variableFrameRate: members.filter((m) => m.videoAsset.isVariableFrameRate).length,
    };
  }

  // ── Freeze ───────────────────────────────────────────────────────────────

  /**
   * Make a version immutable, after proving it is fit to be.
   *
   * Every gate runs again here rather than being trusted from when a member was
   * added: a rights scope can be withdrawn in between, and freezing a dataset that
   * has since lost its training right is exactly the mistake that is impossible to
   * undo afterwards.
   */
  async freeze(datasetVersionId: string, actor?: AdminAuthContext) {
    const version = await this.requireUnfrozen(datasetVersionId);

    const members = await this.prisma.visionDatasetMember.findMany({
      where: { datasetVersionId: version.id },
      select: { videoAssetId: true, checksumSha256: true, split: true, groupKey: true, sbMatchId: true },
    });
    if (!members.length) throw new BadRequestException("Cannot freeze an empty dataset version");

    // 1. Splits must have been generated for *this* membership.
    //
    //    Without this a version frozen straight after `addMembers` is 100% train:
    //    one split, so the leakage check passes trivially and the result is a
    //    corpus with no test set that looks fully validated. Comparing the stored
    //    report's member count against the live one also catches members added
    //    after generation, which is the same bug arriving more quietly.
    const storedLeakage = version.leakageReport as LeakageReport | null;
    if (!storedLeakage || storedLeakage.members !== members.length) {
      throw new ConflictException({
        statusCode: 409,
        error: "SplitsNotGenerated",
        message: storedLeakage
          ? `Splits were generated for ${storedLeakage.members} member(s) but this version now has ${members.length}.`
          : "Splits have never been generated for this version.",
        remediation: "POST /vision/datasets/:id/splits, then freeze.",
      });
    }

    // 2. Rights, re-checked now.
    const lostRights: { videoAssetId: string; reason: string }[] = [];
    for (const member of members) {
      const decision = await this.rights.canTrain({ videoAssetId: member.videoAssetId });
      if (!decision.allowed) {
        lostRights.push({ videoAssetId: member.videoAssetId, reason: decision.reason });
      }
    }
    if (lostRights.length) {
      throw new ForbiddenException({
        statusCode: 403,
        error: "RightsDenied",
        message: `${lostRights.length} member(s) no longer carry training rights.`,
        reason: lostRights[0]!.reason,
        members: lostRights.slice(0, 20),
        remediation:
          "Remove the affected members or restore the grant. A frozen dataset cannot be edited afterwards.",
      });
    }

    // 3. Checksums, still real.
    const missingChecksum = members.filter((m) => m.checksumSha256.length !== 64);
    if (missingChecksum.length) {
      throw new BadRequestException(
        `${missingChecksum.length} member(s) have no usable checksum; a frozen dataset must prove which bytes it holds`
      );
    }

    // 4. Leakage, re-run rather than trusted from the stored report.
    const leakage = await this.checkLeakage(version.id);
    if (!leakage.ok) {
      throw new ConflictException({
        statusCode: 409,
        error: "LeakageDetected",
        message: `${leakage.offendingGroups.length} group(s) span more than one split.`,
        offendingGroups: leakage.offendingGroups.slice(0, 20),
        remediation: "Re-run split generation, which assigns whole groups, then freeze again.",
      });
    }

    const representation = await this.representation(version.id);

    // 5. The manifest: what makes the version reproducible from object storage
    //    alone, without reading the database.
    const manifest = {
      datasetVersionId: version.id,
      label: version.label,
      labelSchemaVersionId: version.labelSchemaVersionId,
      splitPolicy: version.splitPolicy,
      frozenAt: new Date().toISOString(),
      leakage,
      representation,
      members: members
        .map((m) => ({
          videoAssetId: m.videoAssetId,
          checksumSha256: m.checksumSha256,
          split: m.split,
          groupKey: m.groupKey,
          sbMatchId: m.sbMatchId,
        }))
        .sort((a, b) => a.videoAssetId.localeCompare(b.videoAssetId)),
    };

    const ref = visionKeys.datasetManifest(version.id);
    await this.store.putSmallObject(
      ref.bucket,
      ref.key,
      JSON.stringify(manifest, null, 2),
      "application/json"
    );

    const frozen = await this.prisma.visionDatasetVersion.update({
      where: { id: version.id },
      data: {
        frozenAt: new Date(),
        frozenBy: actor?.userId ?? null,
        manifestKey: ref.key,
        leakageReport: leakage as never,
        representationReport: representation as never,
      },
    });

    await this.audit.record(
      {
        action: "dataset.frozen",
        targetKind: "vision_dataset_version",
        targetId: version.id,
        data: { members: members.length, manifestKey: ref.key, splits: leakage.splitSizes },
      },
      actor
    );

    return { version: frozen, leakage, representation, manifestKey: ref.key };
  }

  /**
   * Flag every version holding one of these assets.
   *
   * A frozen dataset is **not** rewritten: history stays as it was, and the flag is
   * what blocks new training runs. Deleting the rows to look clean would leave DTP
   * unable to answer which datasets were affected — which is precisely the question
   * a partner or a regulator asks.
   */
  async flagVersionsContaining(
    videoAssetIds: string[],
    reason: string,
    actor?: AdminAuthContext
  ): Promise<{ datasetVersions: string[] }> {
    if (!videoAssetIds.length) return { datasetVersions: [] };

    const affected = await this.prisma.visionDatasetMember.findMany({
      where: { videoAssetId: { in: videoAssetIds } },
      select: { datasetVersionId: true },
    });
    const ids = [...new Set(affected.map((m) => m.datasetVersionId))];
    if (!ids.length) return { datasetVersions: [] };

    await this.prisma.visionDatasetVersion.updateMany({
      where: { id: { in: ids } },
      data: { containsRevokedMembers: true },
    });

    await this.audit.record(
      {
        action: "rights.scope.revoked",
        targetKind: "vision_dataset_version",
        targetId: ids.join(","),
        reason,
        data: { videoAssets: videoAssetIds.length, datasetVersions: ids },
      },
      actor
    );
    return { datasetVersions: ids };
  }

  /**
   * The dataset consequence of withdrawing a rights grant.
   *
   * Without this, revoking a training right left every frozen dataset unflagged and
   * a later training run would happily use footage whose consent was gone — the
   * exact failure `containsRevokedMembers` exists to prevent.
   *
   * **A player-level withdrawal cannot be resolved to assets yet.** That needs the
   * identity graph, which arrives in Phase 4; until then such a scope is reported
   * back as unresolved rather than silently treated as affecting nothing. Returning
   * `{ datasetVersions: [] }` for it would be a lie in the shape of a success.
   */
  async flagVersionsForRevokedScope(
    scope: { partnerId?: string | null; sourceVideoRecordId?: string | null; playerId?: string | null },
    reason: string,
    actor?: AdminAuthContext
  ): Promise<{ datasetVersions: string[]; unresolvedPlayerScope: boolean }> {
    const recordFilter = scope.sourceVideoRecordId
      ? { sourceVideoRecordId: scope.sourceVideoRecordId }
      : scope.partnerId
        ? { sourceVideoRecord: { partnerId: scope.partnerId } }
        : null;

    if (!recordFilter) {
      return { datasetVersions: [], unresolvedPlayerScope: Boolean(scope.playerId) };
    }

    const assets = await this.prisma.visionVideoAsset.findMany({
      where: recordFilter,
      select: { id: true },
    });
    const result = await this.flagVersionsContaining(
      assets.map((a) => a.id),
      reason,
      actor
    );
    return { ...result, unresolvedPlayerScope: false };
  }

  private async requireUnfrozen(id: string) {
    const version = await this.prisma.visionDatasetVersion.findUnique({ where: { id } });
    if (!version) throw new NotFoundException(`Unknown dataset version ${id}`);
    if (version.frozenAt) {
      throw new ConflictException(
        `Dataset version ${version.label} was frozen on ${version.frozenAt.toISOString()} and is immutable. Create a new version.`
      );
    }
    return version;
  }
}

/**
 * A stored or submitted policy, as a validated one.
 *
 * `InvalidSplitPolicyError` is domain-level and carries no HTTP meaning, so it is
 * translated here — the policy module stays free of Nest, and a bad policy is a 400
 * rather than an unhandled 500.
 */
function toPolicy(partial: Partial<SplitPolicy> | null | undefined): SplitPolicy {
  try {
    return resolvePolicy(partial);
  } catch (error) {
    if (error instanceof InvalidSplitPolicyError) {
      throw new BadRequestException(error.message);
    }
    throw error;
  }
}
