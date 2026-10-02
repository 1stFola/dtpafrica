import { Controller, Get, Inject, NotFoundException, Param, Query, UseGuards } from "@nestjs/common";
import { RequirePermissions } from "../../admin/decorators/require-permissions.decorator";
import { AdminAuthGuard } from "../../admin/guards/admin-auth.guard";
import { PermissionsGuard } from "../../admin/guards/permissions.guard";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * Tracks, as a reviewer or a later stage reads them: one row per track with its
 * window, class, size and the two models that made it. The positions are in the
 * artifact each row names; this never proxies them.
 */
@Controller("vision/assets")
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class VisionTracksController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get(":id/tracks")
  @RequirePermissions("vision.read")
  async list(@Param("id") videoAssetId: string, @Query("jobId") jobId?: string, @Query("class") cls?: string) {
    const asset = await this.prisma.visionVideoAsset.findUnique({ where: { id: videoAssetId }, select: { id: true } });
    if (!asset) throw new NotFoundException(`Unknown video asset ${videoAssetId}`);

    const tracks = await this.prisma.visionTrack.findMany({
      where: { videoAssetId, ...(jobId ? { inferenceJobId: jobId } : {}), ...(cls ? { class: cls } : {}) },
      orderBy: [{ inferenceJobId: "desc" }, { startMs: "asc" }, { localTrackId: "asc" }],
      take: 2000,
    });
    const byClass: Record<string, number> = {};
    for (const t of tracks) byClass[t.class] = (byClass[t.class] ?? 0) + 1;
    return { tracks, count: tracks.length, byClass };
  }
}
