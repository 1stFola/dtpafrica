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
import { UpsertStaticContentDto } from "./dto/upsert-static-content.dto";
import { UpsertBlogPostDto } from "./dto/upsert-blog-post.dto";
import { AdminApiKeyGuard } from "./guards/admin-api-key.guard";
import { AdminSeedService } from "./admin-seed.service";
import { AdsConfigService } from "../ads/ads-config.service";
import { PatchAdsConfigDto } from "../ads/dto/patch-ads-config.dto";

@Controller("admin")
@UseGuards(AdminApiKeyGuard)
export class AdminController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminPlayersService) private readonly players: AdminPlayersService,
    @Inject(AdminInboxService) private readonly inbox: AdminInboxService,
    @Inject(AdminAcademiesService) private readonly academies: AdminAcademiesService,
    @Inject(AdminBlogService) private readonly blog: AdminBlogService,
    @Inject(AdminContentService) private readonly content: AdminContentService,
    @Inject(AdminCalibrationService) private readonly calibration: AdminCalibrationService,
    @Inject(AdsConfigService) private readonly ads: AdsConfigService,
    @Inject(AdminSeedService) private readonly seed: AdminSeedService
  ) {}

  @Get("session")
  session() {
    return { ok: true, role: "admin" };
  }

  @Get("stats")
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
  bulkUpdatePlayers(@Body() dto: BulkUpdatePlayersDto) {
    return this.players.bulkUpdate(dto);
  }

  @Get("players/slug-preview")
  previewPlayerSlug(
    @Query("name") name?: string,
    @Query("excludeId") excludeId?: string
  ) {
    return this.players.previewSlug(name ?? "", excludeId);
  }

  @Patch("players/:id")
  updatePlayer(@Param("id") id: string, @Body() dto: UpdatePlayerAdminDto) {
    return this.players.update(id, dto);
  }

  @Get("players/:id/quick-edit")
  getPlayerQuickEdit(@Param("id") id: string) {
    return this.players.getQuickEditContext(id);
  }

  @Patch("players/:id/quick-edit")
  quickEditPlayer(@Param("id") id: string, @Body() dto: QuickEditPlayerDto) {
    return this.players.quickEdit(id, dto);
  }

  @Get("calibration/players/:id")
  getCalibrationContext(@Param("id") id: string) {
    return this.calibration.getPlayerMetrics(id);
  }

  @Post("calibration/preview")
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
  createCalibratedPlayer(@Body() body: CreateCalibratedPlayerDto) {
    return this.calibration.createPlayerFromCalibration(
      body.player,
      body.metrics,
      body.primaryBenchmarkIndex,
    );
  }

  @Post("players/:id/calibrate")
  calibratePlayer(@Param("id") id: string, @Body() body: CalibratePlayerDto) {
    return this.calibration.runForPlayer(id, {
      save: body.save !== false,
      metricsOverride: body.metrics,
      playerInfo: body.player,
      primaryBenchmarkIndex: body.primaryBenchmarkIndex,
    });
  }

  @Get("inbox")
  listInbox(
    @Query("status") status?: string,
    @Query("q") q?: string,
    @Query("limit") limit?: string
  ) {
    return this.inbox.list({
      status,
      q,
      limit: limit != null ? Number(limit) : undefined,
    });
  }

  @Get("inbox/:id")
  getInboxMessage(@Param("id") id: string) {
    return this.inbox.get(id);
  }

  @Patch("inbox/:id/read")
  setInboxRead(@Param("id") id: string, @Body() body: UpdateContactMessageReadDto) {
    return this.inbox.setRead(id, body.read !== false);
  }

  @Patch("inbox/:id/archive")
  setInboxArchived(
    @Param("id") id: string,
    @Body() body: UpdateContactMessageArchiveDto
  ) {
    return this.inbox.setArchived(id, body.archived !== false);
  }

  @Delete("inbox/:id")
  deleteInboxMessage(@Param("id") id: string) {
    return this.inbox.remove(id);
  }

  @Get("academies")
  listAcademies() {
    return this.academies.list();
  }

  @Get("academies/:id")
  getAcademy(@Param("id") id: string) {
    return this.academies.get(id);
  }

  @Post("academies")
  createAcademy(@Body() dto: UpsertAcademyDto) {
    return this.academies.create(dto);
  }

  @Put("academies/:id")
  updateAcademy(@Param("id") id: string, @Body() dto: UpsertAcademyDto) {
    return this.academies.update(id, dto);
  }

  @Delete("academies/:id")
  deleteAcademy(@Param("id") id: string) {
    return this.academies.remove(id);
  }

  @Get("blog")
  listBlog() {
    return this.blog.list();
  }

  @Get("blog/:id")
  getBlog(@Param("id") id: string) {
    return this.blog.get(id);
  }

  @Post("blog")
  createBlog(@Body() dto: UpsertBlogPostDto) {
    return this.blog.create(dto);
  }

  @Put("blog/:id")
  updateBlog(@Param("id") id: string, @Body() dto: UpsertBlogPostDto) {
    return this.blog.update(id, dto);
  }

  @Patch("blog/:id/publish")
  publishBlog(@Param("id") id: string, @Body() body: PublishBlogDto) {
    return this.blog.setPublished(id, body.isPublished);
  }

  @Delete("blog/:id")
  deleteBlog(@Param("id") id: string) {
    return this.blog.remove(id);
  }

  @Get("content")
  listContent() {
    return this.content.list();
  }

  @Put("content/:key")
  upsertContent(@Param("key") key: string, @Body() dto: UpsertStaticContentDto) {
    return this.content.upsert(key, dto);
  }

  @Get("ads")
  getAdsConfig() {
    return this.ads.getConfig();
  }

  @Patch("ads")
  patchAdsConfig(@Body() dto: PatchAdsConfigDto) {
    return this.ads.updateConfig(dto);
  }

  @Get("database/seed/status")
  getDatabaseSeedStatus() {
    return this.seed.getStatus();
  }

  @Post("database/seed")
  runDatabaseSeed(@Body() dto: RunDatabaseSeedDto) {
    return this.seed.run(dto.mode ?? "incremental");
  }
}
