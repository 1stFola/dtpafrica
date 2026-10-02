import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { AdminAuthContext } from "../../admin/auth/admin-auth.types";
import { PrismaService } from "../../prisma/prisma.service";
import { VisionAuditService } from "../audit/vision-audit.service";
import { clockAt, halfInfo, sortAnchors, type ClockAnchor, type Half } from "./match-clock";

/**
 * Anchoring the match clock to the footage.
 *
 * One current anchor per half per asset: the source millisecond a person marked
 * as that half's kick-off, and, when they marked it, the whistle that ended it.
 * A new anchor for a half supersedes the current one; nothing is edited. The
 * operator key is refused, as everywhere a person's judgement is filed.
 *
 * Halves must be in order: the second half's kick-off after the first half's
 * kick-off and, if marked, its end. A clock that runs backwards is not a clock.
 */
@Injectable()
export class VisionClockService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(VisionAuditService) private readonly audit: VisionAuditService
  ) {}

  async anchor(videoAssetId: string, input: { half: number; sourceMs: number; endMs?: number | null }, actor?: AdminAuthContext) {
    const person = requirePerson(actor, "anchor the match clock");
    const asset = await this.prisma.visionVideoAsset.findUnique({ where: { id: videoAssetId }, select: { id: true, durationMs: true } });
    if (!asset) throw new NotFoundException(`Unknown video asset ${videoAssetId}`);
    const half = input.half as Half;
    if (![1, 2, 3, 4].includes(input.half)) {
      throw new ConflictException({ statusCode: 409, error: "HalfUnknown", message: `There is no half ${input.half}.`, remediation: "1 and 2, or 3 and 4 for extra time." });
    }
    const endMs = input.endMs ?? null;
    if (input.sourceMs < 0 || (asset.durationMs !== null && input.sourceMs > asset.durationMs) || (endMs !== null && asset.durationMs !== null && endMs > asset.durationMs)) {
      throw new ConflictException({ statusCode: 409, error: "AnchorOutsideAsset", message: `The footage is ${asset.durationMs ?? "?"}ms long.`, remediation: "Anchor inside the footage." });
    }
    if (endMs !== null && endMs <= input.sourceMs) {
      throw new ConflictException({ statusCode: 409, error: "HalfEndsBeforeItStarts", message: `The ${halfInfo(half).name} cannot end at ${endMs}ms having kicked off at ${input.sourceMs}ms.`, remediation: "The end whistle comes after kick-off." });
    }
    const current = await this.currentAnchors(videoAssetId);
    for (const other of current) {
      if (other.half < half && (other.endMs ?? other.sourceMs) >= input.sourceMs) {
        throw new ConflictException({
          statusCode: 409,
          error: "HalfOutOfOrder",
          message: `The ${halfInfo(half).name} cannot kick off at ${input.sourceMs}ms; the ${halfInfo(other.half).name} ${other.endMs !== null ? "ends" : "kicks off"} at ${other.endMs ?? other.sourceMs}ms.`,
          remediation: "Halves are in order. Re-anchor the earlier half first if it was wrong.",
        });
      }
      if (other.half > half && other.sourceMs <= (endMs ?? input.sourceMs)) {
        throw new ConflictException({
          statusCode: 409,
          error: "HalfOutOfOrder",
          message: `The ${halfInfo(half).name} cannot run to ${endMs ?? input.sourceMs}ms; the ${halfInfo(other.half).name} kicks off at ${other.sourceMs}ms.`,
          remediation: "Halves are in order. Re-anchor the later half first if it was wrong.",
        });
      }
    }
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.visionClockAnchor.create({ data: { videoAssetId, half, sourceMs: input.sourceMs, endMs, decidedBy: person.userId } });
      await tx.visionClockAnchor.updateMany({ where: { videoAssetId, half, supersededBy: null, id: { not: created.id } }, data: { supersededBy: created.id } });
      return created;
    });
    await this.audit.record({ action: "clock.anchored", targetKind: "vision_video_asset", targetId: videoAssetId, data: { half, sourceMs: input.sourceMs, endMs, anchorId: row.id } }, actor);
    return row;
  }

  /** The current anchors of an asset, in half order. */
  async currentAnchors(videoAssetId: string): Promise<ClockAnchor[]> {
    const rows = await this.prisma.visionClockAnchor.findMany({ where: { videoAssetId, supersededBy: null }, select: { half: true, sourceMs: true, endMs: true } });
    return sortAnchors(rows.map((r) => ({ half: r.half as Half, sourceMs: r.sourceMs, endMs: r.endMs })));
  }

  /** The anchors, and where a given source millisecond falls on the clock. */
  async read(videoAssetId: string, sourceMs?: number) {
    const asset = await this.prisma.visionVideoAsset.findUnique({ where: { id: videoAssetId }, select: { id: true } });
    if (!asset) throw new NotFoundException(`Unknown video asset ${videoAssetId}`);
    const anchors = await this.currentAnchors(videoAssetId);
    return {
      videoAssetId,
      anchored: anchors.length > 0,
      anchors: anchors.map((a) => ({ ...a, name: halfInfo(a.half).name })),
      at: sourceMs === undefined ? null : { sourceMs, ...clockAt(anchors, sourceMs) },
    };
  }
}

function requirePerson(actor: AdminAuthContext | undefined, what: string): { userId: string } {
  if (!actor?.userId) {
    throw new ForbiddenException({
      statusCode: 403,
      error: "ClockNeedsAPerson",
      message: `Only a signed-in person may ${what}.`,
      detail: "Which whistle was kick-off is a judgement about the footage with a name on it; the shared operator key has none.",
      remediation: "Sign in as yourself.",
    });
  }
  return { userId: actor.userId };
}
