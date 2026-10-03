import { Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";
import { RequirePermissions } from "../../admin/decorators/require-permissions.decorator";
import { AdminAuthGuard } from "../../admin/guards/admin-auth.guard";
import { PermissionsGuard } from "../../admin/guards/permissions.guard";
import { PrismaService } from "../../prisma/prisma.service";
import { jsonSafe } from "../shared/json-safe";

/**
 * Every copy under DTP control, across sources: the Footage page of the Vision
 * environment. One row per asset with its source, its match, whether the review
 * proxy exists, and the latest run of each stage, so an operator sees where
 * every piece of footage is in the pipeline without opening each source.
 */
@Controller("vision/assets")
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class VisionAssetsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions("vision.read")
  async list(@Query("ingestState") ingestState?: string, @Query("partnerId") partnerId?: string, @Query("q") q?: string) {
    const assets = await this.prisma.visionVideoAsset.findMany({
      where: {
        ...(ingestState ? { ingestState } : {}),
        ...(partnerId ? { sourceVideoRecord: { partnerId } } : {}),
        ...(q ? { sourceVideoRecord: { title: { contains: q, mode: "insensitive" } } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        ingestState: true,
        ingestError: true,
        corpus: true,
        durationMs: true,
        width: true,
        height: true,
        videoCodec: true,
        bytes: true,
        createdAt: true,
        sbMatchId: true,
        sourceVideoRecord: { select: { id: true, title: true, partner: { select: { id: true, name: true } } } },
        sbMatch: { select: { id: true, slug: true, homeTeam: { select: { name: true } }, awayTeam: { select: { name: true } } } },
        variants: { where: { kind: "proxy" }, select: { kind: true, durationMs: true }, take: 1 },
        jobs: { orderBy: { queuedAt: "desc" }, select: { id: true, type: true, state: true, queuedAt: true, finishedAt: true, error: true } },
        _count: { select: { tracks: true, cameraSegments: true, eventCandidates: true } },
      },
    });
    return jsonSafe({
      assets: assets.map((a) => {
        const latest = new Map<string, (typeof a.jobs)[number]>();
        for (const j of [...a.jobs].reverse()) latest.set(j.type, j);
        return {
          ...a,
          jobs: undefined,
          hasProxy: a.variants.length > 0,
          stages: [...latest.values()].map((j) => ({ type: j.type, state: j.state, finishedAt: j.finishedAt, error: j.error })),
          counts: a._count,
          _count: undefined,
        };
      }),
    });
  }
}
