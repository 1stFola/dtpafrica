import { Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";
import { RequirePermissions } from "../../admin/decorators/require-permissions.decorator";
import { AdminAuthGuard } from "../../admin/guards/admin-auth.guard";
import { PermissionsGuard } from "../../admin/guards/permissions.guard";
import { Prisma } from "@prisma/client";
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
    /* The latest job of each stage for each listed asset, picked by the database. The list
       loaded every job every asset ever had, with its error, to keep one per stage; an asset
       re-run a few hundred times made the page slow for everyone (docs/vision/50, PR-10). */
    const stagesOf = await latestStageJobs(this.prisma, assets.map((a) => a.id));
    return jsonSafe({
      assets: assets.map((a) => {
        return {
          ...a,
          hasProxy: a.variants.length > 0,
          stages: stagesOf.get(a.id) ?? [],
          counts: a._count,
          _count: undefined,
        };
      }),
    });
  }
}

export type StageJob = { type: string; state: string; finishedAt: Date | null; error: unknown };

/**
 * For each asset, its most recently queued job of each type, oldest stage first.
 * `DISTINCT ON` walks the `(video_asset_id, type)` index and keeps one row per pair.
 */
export async function latestStageJobs(prisma: Pick<PrismaService, "$queryRaw">, videoAssetIds: readonly string[]): Promise<Map<string, StageJob[]>> {
  const out = new Map<string, StageJob[]>();
  if (!videoAssetIds.length) return out;
  const rows = await prisma.$queryRaw<{ video_asset_id: string; type: string; state: string; queued_at: Date; finished_at: Date | null; error: unknown }[]>(Prisma.sql`
    SELECT DISTINCT ON (video_asset_id, type) video_asset_id, type, state, queued_at, finished_at, error
    FROM vision_jobs
    WHERE video_asset_id IN (${Prisma.join([...videoAssetIds])})
    ORDER BY video_asset_id, type, queued_at DESC, id DESC
  `);
  rows.sort((a, b) => a.queued_at.getTime() - b.queued_at.getTime());
  for (const r of rows) {
    const list = out.get(r.video_asset_id) ?? [];
    list.push({ type: r.type, state: r.state, finishedAt: r.finished_at, error: r.error });
    out.set(r.video_asset_id, list);
  }
  return out;
}
