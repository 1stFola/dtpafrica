import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AdminAcademiesService } from "./admin-academies.service";
import { AcademyChangeRequestsService } from "../academy-dashboard/academy-change-requests.service";
import { AdminBlogService } from "./admin-blog.service";
import { AdminCalibrationService } from "./admin-calibration.service";
import { AdminContentService } from "./admin-content.service";
import { AdminInboxService } from "./admin-inbox.service";
import { AdminPlayersService } from "./admin-players.service";
import { CalibrationPreviewDto, CalibratePlayerDto, CreateCalibratedPlayerDto } from "./dto/calibration-run.dto";
import {
  UpdateContactMessageArchiveDto,
  UpdateContactMessageReadDto,
} from "./dto/update-contact-message.dto";
import { QuickEditPlayerDto } from "./dto/quick-edit-player.dto";
import { BulkUpdatePlayersDto } from "./dto/bulk-update-players.dto";
import { RunDatabaseSeedDto } from "./dto/run-database-seed.dto";
import { UpdatePlayerAdminDto } from "./dto/update-player-admin.dto";
import { PublishBlogDto } from "./dto/publish-blog.dto";
import { UpsertAcademyDto } from "./dto/upsert-academy.dto";
import { ReviewAcademyChangeRequestDto } from "../academy-dashboard/dto/academy-change-request.dto";
import { UpsertStaticContentDto } from "./dto/upsert-static-content.dto";
import { UpsertBlogPostDto } from "./dto/upsert-blog-post.dto";
import { AdminAuthGuard } from "./guards/admin-auth.guard";
import { PermissionsGuard } from "./guards/permissions.guard";
import { RequirePermissions } from "./decorators/require-permissions.decorator";
import { AdminAuth } from "./decorators/admin-auth.decorator";
import type { AdminAuthContext } from "./auth/admin-auth.types";
import { AdminSeedService } from "./admin-seed.service";
import { AdsConfigService } from "../ads/ads-config.service";
import { PatchAdsConfigDto } from "../ads/dto/patch-ads-config.dto";

@Controller("admin")
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminPlayersService) private readonly players: AdminPlayersService,
    @Inject(AdminInboxService) private readonly inbox: AdminInboxService,
    @Inject(AdminAcademiesService) private readonly academies: AdminAcademiesService,
    @Inject(AcademyChangeRequestsService)
    private readonly academyChangeRequests: AcademyChangeRequestsService,
    @Inject(AdminBlogService) private readonly blog: AdminBlogService,
    @Inject(AdminContentService) private readonly content: AdminContentService,
    @Inject(AdminCalibrationService) private readonly calibration: AdminCalibrationService,
    @Inject(AdsConfigService) private readonly ads: AdsConfigService,
    @Inject(AdminSeedService) private readonly seed: AdminSeedService
  ) {}

  @Get("session")
  @RequirePermissions("admin.session.read")
  session(@AdminAuth() auth: AdminAuthContext) {
    return { ok: true, ...auth };
  }

  @Get("stats")
  @RequirePermissions("admin.stats.read")
  async stats() {
    const [
      players,
      pending,
      featured,
      publicCount,
      blogDrafts,
      blogPublished,
      contactUnread,
      contactArchived,
      academyPublished,
    ] =
      await Promise.all([
        this.prisma.player.count(),
        this.prisma.player.count({ where: { registrationStatus: "pending" } }),
        this.prisma.player.count({ where: { isFeatured: true } }),
        this.prisma.player.count({ where: { isPublic: true } }),
        this.prisma.blogPost.count({ where: { isPublished: false } }),
        this.prisma.blogPost.count({ where: { isPublished: true } }),
        this.prisma.contactMessage.count({
          where: { readAt: null, archivedAt: null },
        }),
        this.prisma.contactMessage.count({ where: { archivedAt: { not: null } } }),
        this.prisma.academy.count({ where: { isPublished: true } }),
      ]);
    return {
      players,
      pendingRegistrations: pending,
      featuredPlayers: featured,
      publicProfiles: publicCount,
      blogDrafts,
      blogPublished,
      contactUnread,
      contactArchived,
      academyPublished,
    };
  }

  @Get("players")
  @RequirePermissions("players.read")
  listPlayers(
    @Query("id") id?: string,
    @Query("q") q?: string,
    @Query("status") status?: string,
    @Query("academyId") academyId?: string,
    @Query("position") position?: string,
    @Query("featured") featured?: string,
    @Query("hasMedia") hasMedia?: string,
    @Query("sort") sort?: string,
    @Query("sortDir") sortDir?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string
  ) {
    return this.players.list({
      id,
      q,
      status,
      academyId,
      position,
      featured,
      hasMedia,
      sort,
      sortDir,
      limit: limit != null ? Number(limit) : undefined,
      offset: offset != null ? Number(offset) : undefined,
    });
  }

  @Patch("players/bulk")
  @RequirePermissions("players.write")
  bulkUpdatePlayers(@Body() dto: BulkUpdatePlayersDto) {
    return this.players.bulkUpdate(dto);
  }

  @Get("players/slug-preview")
  @RequirePermissions("players.read")
  previewPlayerSlug(
    @Query("name") name?: string,
    @Query("excludeId") excludeId?: string
  ) {
    return this.players.previewSlug(name ?? "", excludeId);
  }

  @Patch("players/:id")
  @RequirePermissions("players.write")
  updatePlayer(@Param("id") id: string, @Body() dto: UpdatePlayerAdminDto) {
    return this.players.update(id, dto);
  }

  @Get("players/:id/quick-edit")
  @RequirePermissions("players.read")
  getPlayerQuickEdit(@Param("id") id: string) {
    return this.players.getQuickEditContext(id);
  }

  @Patch("players/:id/quick-edit")
  @RequirePermissions("players.write")
  quickEditPlayer(@Param("id") id: string, @Body() dto: QuickEditPlayerDto) {
    return this.players.quickEdit(id, dto);
  }

  @Get("calibration/players/:id")
  @RequirePermissions("players.read", "calibration.run")
  getCalibrationContext(@Param("id") id: string) {
    return this.calibration.getPlayerMetrics(id);
  }

  @Post("calibration/preview")
  @RequirePermissions("calibration.run")
  previewCalibration(@Body() body: CalibrationPreviewDto) {
    if (body.playerId) {
      return this.calibration.runForPlayer(body.playerId, {
        save: false,
        metricsOverride: body.metrics,
        playerInfo: body.player,
        primaryBenchmarkIndex: body.primaryBenchmarkIndex,
      });
    }
    return this.calibration.runAdhoc(
      body.player,
      body.metrics,
      false,
      body.primaryBenchmarkIndex,
    );
  }

  @Post("calibration/players")
  @RequirePermissions("calibration.create")
  createCalibratedPlayer(@Body() body: CreateCalibratedPlayerDto) {
    return this.calibration.createPlayerFromCalibration(
      body.player,
      body.metrics,
      body.primaryBenchmarkIndex,
    );
  }

  @Post("players/:id/calibrate")
  @RequirePermissions("players.calibrate")
  calibratePlayer(@Param("id") id: string, @Body() body: CalibratePlayerDto) {
    return this.calibration.runForPlayer(id, {
      save: body.save !== false,
      metricsOverride: body.metrics,
      playerInfo: body.player,
      primaryBenchmarkIndex: body.primaryBenchmarkIndex,
    });
  }

  @Get("inbox")
  @RequirePermissions("inbox.read")
  listInbox(
    @Query("status") status?: string,
    @Query("q") q?: string,
    @Query("source") source?: string,
    @Query("limit") limit?: string
  ) {
    return this.inbox.list({
      status,
      q,
      source,
      limit: limit != null ? Number(limit) : undefined,
    });
  }

  @Get("inbox/:id")
  @RequirePermissions("inbox.read")
  getInboxMessage(@Param("id") id: string) {
    return this.inbox.get(id);
  }

  @Patch("inbox/:id/read")
  @RequirePermissions("inbox.write")
  setInboxRead(@Param("id") id: string, @Body() body: UpdateContactMessageReadDto) {
    return this.inbox.setRead(id, body.read !== false);
  }

  @Patch("inbox/:id/archive")
  @RequirePermissions("inbox.write")
  setInboxArchived(
    @Param("id") id: string,
    @Body() body: UpdateContactMessageArchiveDto
  ) {
    return this.inbox.setArchived(id, body.archived !== false);
  }

  @Delete("inbox/:id")
  @RequirePermissions("inbox.write")
  deleteInboxMessage(@Param("id") id: string) {
    return this.inbox.remove(id);
  }

  @Get("academies")
  @RequirePermissions("academies.read")
  listAcademies() {
    return this.academies.list();
  }

  @Get("academies/:id")
  @RequirePermissions("academies.read")
  getAcademy(@Param("id") id: string) {
    return this.academies.get(id);
  }

  @Post("academies")
  @RequirePermissions("academies.write")
  createAcademy(@Body() dto: UpsertAcademyDto) {
    return this.academies.create(dto);
  }

  @Put("academies/:id")
  @RequirePermissions("academies.write")
  updateAcademy(@Param("id") id: string, @Body() dto: UpsertAcademyDto) {
    return this.academies.update(id, dto);
  }

  @Delete("academies/:id")
  @RequirePermissions("academies.write")
  deleteAcademy(@Param("id") id: string) {
    return this.academies.remove(id);
  }

  @Get("academy-change-requests")
  @RequirePermissions("academies.read")
  listAcademyChangeRequests(@Query("status") status?: string) {
    return this.academyChangeRequests.list(status);
  }

  @Patch("academy-change-requests/:id/approve")
  @RequirePermissions("academies.write")
  approveAcademyChangeRequest(
    @Param("id") id: string,
    @Body() dto: ReviewAcademyChangeRequestDto
  ) {
    return this.academyChangeRequests.approve(id, dto.adminNotes);
  }

  @Patch("academy-change-requests/:id/reject")
  @RequirePermissions("academies.write")
  rejectAcademyChangeRequest(
    @Param("id") id: string,
    @Body() dto: ReviewAcademyChangeRequestDto
  ) {
    return this.academyChangeRequests.reject(id, dto.adminNotes);
  }

  @Get("blog")
  @RequirePermissions("blog.read")
  listBlog() {
    return this.blog.list();
  }

  @Get("blog/:id")
  @RequirePermissions("blog.read")
  getBlog(@Param("id") id: string) {
    return this.blog.get(id);
  }

  @Post("blog")
  @RequirePermissions("blog.write")
  createBlog(@Body() dto: UpsertBlogPostDto) {
    return this.blog.create(dto);
  }

  @Put("blog/:id")
  @RequirePermissions("blog.write")
  updateBlog(@Param("id") id: string, @Body() dto: UpsertBlogPostDto) {
    return this.blog.update(id, dto);
  }

  @Patch("blog/:id/publish")
  @RequirePermissions("blog.write")
  publishBlog(@Param("id") id: string, @Body() body: PublishBlogDto) {
    return this.blog.setPublished(id, body.isPublished);
  }

  @Delete("blog/:id")
  @RequirePermissions("blog.write")
  deleteBlog(@Param("id") id: string) {
    return this.blog.remove(id);
  }

  @Get("content")
  @RequirePermissions("content.read")
  listContent() {
    return this.content.list();
  }

  @Put("content/:key")
  @RequirePermissions("content.write")
  upsertContent(@Param("key") key: string, @Body() dto: UpsertStaticContentDto) {
    return this.content.upsert(key, dto);
  }

  @Get("ads")
  @RequirePermissions("ads.write")
  getAdsConfig() {
    return this.ads.getConfig();
  }

  @Patch("ads")
  @RequirePermissions("ads.write")
  patchAdsConfig(@Body() dto: PatchAdsConfigDto) {
    return this.ads.updateConfig(dto);
  }

  @Get("database/seed/status")
  @RequirePermissions("database.seed")
  getDatabaseSeedStatus() {
    return this.seed.getStatus();
  }

  @Post("database/seed")
  @RequirePermissions("database.seed")
  runDatabaseSeed(@Body() _dto: RunDatabaseSeedDto) {
    // Only one mode exists; the DTO is validated purely to reject a "full"
    // request rather than silently treating it as incremental.
    return this.seed.run();
  }
}
