import { Inject, Injectable } from "@nestjs/common";
import {
  ACQUIRED_STATUS,
  RIGHTS_DENIAL_REMEDIATION,
  RIGHTS_GRANT_LEVEL_SPECIFICITY,
  TRAINABLE_CORPUS,
  type RightsDecision,
  type RightsDenialReason,
  type RightsGrantLevel,
  type RightsScopeKey,
} from "@dtp/vision-contracts";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * The rights gate.
 *
 * Rights are a runtime constraint, not a policy document: if the code does not
 * enforce it, it is not a rule. Every pipeline entry point calls this and
 * refuses on failure. See docs/vision/03-RIGHTS-AND-GOVERNANCE.md.
 *
 * Two behaviours carry the whole design:
 *
 *   - The four scopes are independent. A partner may permit internal analysis
 *     but not public clips.
 *   - Resolution is most-specific-wins, deny-beats-allow. That is what makes a
 *     guardian's player-level withdrawal override a partner-wide grant, and it
 *     is the single most important rule in the module.
 */

export type RightsSubject = {
  videoAssetId?: string;
  sourceVideoRecordId?: string;
  /** Narrows the decision to one player, for publication and scout sharing. */
  playerId?: string;
};

type ScopeRow = {
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
};

type ResolvedContext = {
  partnerId: string | null;
  sourceVideoRecordId: string | null;
  corpus: string | null;
  acquisitionStatus: string | null;
  scopes: ScopeRow[];
};

@Injectable()
export class RightsPolicyService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  canAnalyze(subject: RightsSubject, now = new Date()): Promise<RightsDecision> {
    return this.decide("canAnalyze", subject, now);
  }

  /**
   * The strictest gate: training additionally requires a DTP-owned corpus and an
   * acquired, checksummed copy. A catalogued URL can never satisfy it.
   */
  canTrain(subject: RightsSubject, now = new Date()): Promise<RightsDecision> {
    return this.decide("canTrain", subject, now, { requireTrainableAsset: true });
  }

  canPublishHighlight(subject: RightsSubject, now = new Date()): Promise<RightsDecision> {
    return this.decide("canPublishHighlight", subject, now);
  }

  canShareWithScout(subject: RightsSubject, now = new Date()): Promise<RightsDecision> {
    return this.decide("canShareWithScout", subject, now);
  }

  /** All four at once, for a UI that shows the whole rights position. */
  async describe(
    subject: RightsSubject,
    now = new Date()
  ): Promise<Record<RightsScopeKey, RightsDecision>> {
    const [analyze, train, publish, share] = await Promise.all([
      this.canAnalyze(subject, now),
      this.canTrain(subject, now),
      this.canPublishHighlight(subject, now),
      this.canShareWithScout(subject, now),
    ]);
    return {
      canAnalyze: analyze,
      canTrain: train,
      canPublishHighlight: publish,
      canShareWithScout: share,
    };
  }

  private async decide(
    scope: RightsScopeKey,
    subject: RightsSubject,
    now: Date,
    opts: { requireTrainableAsset?: boolean } = {}
  ): Promise<RightsDecision> {
    if (!subject.videoAssetId && !subject.sourceVideoRecordId) {
      return deny("no_scope", "No asset or source record was supplied.");
    }

    const context = await this.loadContext(subject);
    if (!context) {
      return deny("no_scope", "The asset or source record does not exist.");
    }

    // The corpus firewall. Checked before any grant, because no amount of
    // paperwork makes research-only footage trainable.
    if (opts.requireTrainableAsset) {
      if (context.corpus !== null && context.corpus !== TRAINABLE_CORPUS) {
        return deny(
          "research_corpus",
          `Asset corpus is "${context.corpus}"; only "${TRAINABLE_CORPUS}" may back a dataset member.`
        );
      }
      if (!subject.videoAssetId) {
        return deny(
          "pending_acquisition",
          "Training requires an acquired DTP copy; only a source record was supplied."
        );
      }
      if (context.acquisitionStatus !== null && context.acquisitionStatus !== ACQUIRED_STATUS) {
        return deny(
          "pending_acquisition",
          `Acquisition status is "${context.acquisitionStatus}", not "${ACQUIRED_STATUS}".`
        );
      }
    }

    const applicable = context.scopes.filter((row) => this.appliesTo(row, subject, context));
    if (!applicable.length) {
      return deny("no_scope", `No grant of ${scope} exists at partner, source or player level.`);
    }

    // Most specific wins. Within one level, deny beats allow — so one withdrawn
    // grant cannot be outvoted by a sibling that is still live.
    const byLevel = new Map<RightsGrantLevel, ScopeRow[]>();
    for (const row of applicable) {
      const level = normaliseLevel(row.grantLevel);
      if (!level) continue;
      const bucket = byLevel.get(level);
      if (bucket) bucket.push(row);
      else byLevel.set(level, [row]);
    }

    const levels = [...byLevel.keys()].sort(
      (a, b) => RIGHTS_GRANT_LEVEL_SPECIFICITY[b] - RIGHTS_GRANT_LEVEL_SPECIFICITY[a]
    );

    for (const level of levels) {
      const rows = byLevel.get(level) ?? [];
      const granting = rows.filter((row) => row[scope]);
      if (!granting.length) {
        // This level speaks to the subject but does not grant the scope. That is
        // a decision, not a reason to fall through to a broader grant.
        const reason = this.denialReasonFor(rows, scope, now);
        return deny(
          reason,
          `A ${level}-level grant applies but does not currently allow ${scope}.`
        );
      }

      const live = granting.filter((row) => this.isLive(row, now));
      if (!live.length) {
        return deny(
          this.denialReasonFor(granting, scope, now),
          `Every ${level}-level grant of ${scope} is expired or revoked.`
        );
      }

      // Deny beats allow: if any applicable grant at this level is revoked, the
      // withdrawal wins even though a sibling is still live.
      const revoked = granting.find((row) => row.revokedAt !== null);
      if (revoked) {
        return deny("revoked", `A ${level}-level grant of ${scope} was withdrawn.`);
      }

      const restricted = live.find((row) => hasBlockingRestriction(row.restrictions, scope));
      if (restricted) {
        return deny(
          "restriction_violated",
          `A restriction on the ${level}-level grant forbids ${scope}.`
        );
      }

      const chosen = live.reduce((best, row) => (row.grantedAt > best.grantedAt ? row : best));
      return {
        allowed: true,
        scopeId: chosen.id,
        grantLevel: level,
        expiresAt: chosen.expiresAt ? chosen.expiresAt.toISOString() : null,
      };
    }

    return deny("no_scope", `No usable grant of ${scope} was found.`);
  }

  private async loadContext(subject: RightsSubject): Promise<ResolvedContext | null> {
    let partnerId: string | null = null;
    let sourceVideoRecordId: string | null = subject.sourceVideoRecordId ?? null;
    let corpus: string | null = null;
    let acquisitionStatus: string | null = null;

    if (subject.videoAssetId) {
      const asset = await this.prisma.visionVideoAsset.findUnique({
        where: { id: subject.videoAssetId },
        select: {
          corpus: true,
          sourceVideoRecordId: true,
          sourceVideoRecord: { select: { partnerId: true, acquisitionStatus: true } },
        },
      });
      if (!asset) return null;
      corpus = asset.corpus;
      sourceVideoRecordId = asset.sourceVideoRecordId ?? sourceVideoRecordId;
      partnerId = asset.sourceVideoRecord?.partnerId ?? null;
      acquisitionStatus = asset.sourceVideoRecord?.acquisitionStatus ?? null;
    }

    if (!partnerId && sourceVideoRecordId) {
      const record = await this.prisma.visionSourceVideoRecord.findUnique({
        where: { id: sourceVideoRecordId },
        select: { partnerId: true, acquisitionStatus: true },
      });
      if (!record) return null;
      partnerId = record.partnerId;
      acquisitionStatus ??= record.acquisitionStatus;
    }

    const scopes = (await this.prisma.visionRightsScope.findMany({
      where: {
        OR: [
          ...(partnerId ? [{ partnerId }] : []),
          ...(sourceVideoRecordId ? [{ sourceVideoRecordId }] : []),
          ...(subject.playerId ? [{ playerId: subject.playerId }] : []),
        ],
      },
    })) as unknown as ScopeRow[];

    return { partnerId, sourceVideoRecordId, corpus, acquisitionStatus, scopes };
  }

  private appliesTo(row: ScopeRow, subject: RightsSubject, context: ResolvedContext): boolean {
    const level = normaliseLevel(row.grantLevel);
    if (!level) return false;
    if (level === "player") {
      return Boolean(subject.playerId) && row.playerId === subject.playerId;
    }
    if (level === "source") {
      return Boolean(context.sourceVideoRecordId) && row.sourceVideoRecordId === context.sourceVideoRecordId;
    }
    return Boolean(context.partnerId) && row.partnerId === context.partnerId;
  }

  private isLive(row: ScopeRow, now: Date): boolean {
    if (row.revokedAt !== null) return false;
    if (row.grantedAt > now) return false;
    if (row.expiresAt !== null && row.expiresAt <= now) return false;
    return true;
  }

  /** Picks the most useful reason to show, so the UI can tell the operator what to fix. */
  private denialReasonFor(rows: ScopeRow[], scope: RightsScopeKey, now: Date): RightsDenialReason {
    const granting = rows.filter((row) => row[scope]);
    if (!granting.length) return "no_scope";
    if (granting.some((row) => row.revokedAt !== null)) return "revoked";
    if (granting.some((row) => row.expiresAt !== null && row.expiresAt <= now)) return "expired";
    if (granting.some((row) => hasBlockingRestriction(row.restrictions, scope))) {
      return "restriction_violated";
    }
    return "no_scope";
  }
}

function normaliseLevel(value: string): RightsGrantLevel | null {
  return value === "partner" || value === "source" || value === "player" ? value : null;
}

function deny(reason: RightsDenialReason, detail: string): RightsDecision {
  return { allowed: false, reason, detail, remediation: RIGHTS_DENIAL_REMEDIATION[reason] };
}

/**
 * Structured restrictions, e.g. `{ "deny": ["canPublishHighlight"] }` or
 * `{ "noIdentifiableMinors": true }`.
 *
 * Unrecognised restriction shapes deny rather than being ignored: a restriction
 * the code does not understand is not a restriction that can be waived.
 */
function hasBlockingRestriction(restrictions: unknown, scope: RightsScopeKey): boolean {
  if (restrictions === null || restrictions === undefined) return false;
  if (typeof restrictions !== "object" || Array.isArray(restrictions)) return true;

  const record = restrictions as Record<string, unknown>;
  const deny = record.deny;
  if (Array.isArray(deny)) {
    return deny.includes(scope);
  }
  if (deny !== undefined) return true;
  return false;
}
