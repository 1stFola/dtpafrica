import { Body, Controller, Get, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { AdminAuth } from "../../admin/decorators/admin-auth.decorator";
import { RequirePermissions } from "../../admin/decorators/require-permissions.decorator";
import { AdminAuthGuard } from "../../admin/guards/admin-auth.guard";
import { PermissionsGuard } from "../../admin/guards/permissions.guard";
import type { AdminAuthContext } from "../../admin/auth/admin-auth.types";
import { jsonSafe } from "../shared/json-safe";
import { AddMembersDto, CreateDatasetVersionDto } from "./dto/datasets.dto";
import { VisionDatasetsService } from "./datasets.service";

/**
 * The dataset factory's endpoints.
 *
 * Note what is absent: no route edits a frozen version, and none forces a freeze
 * past a failed leakage check. An operator under deadline pressure cannot reach for
 * an override that was never built.
 *
 * Reads are `vision.read` so anyone can inspect a corpus's composition; every
 * mutation needs `vision.datasets.manage`.
 */
@Controller("vision/datasets")
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class VisionDatasetsController {
  constructor(@Inject(VisionDatasetsService) private readonly datasets: VisionDatasetsService) {}

  @Get()
  @RequirePermissions("vision.read")
  async list() {
    return jsonSafe(await this.datasets.listVersions());
  }

  @Get(":id")
  @RequirePermissions("vision.read")
  async get(@Param("id") id: string) {
    return jsonSafe(await this.datasets.getVersion(id));
  }

  /** Read-only, so the leakage position can be seen before a freeze is attempted. */
  @Get(":id/leakage")
  @RequirePermissions("vision.read")
  async leakage(@Param("id") id: string) {
    return jsonSafe(await this.datasets.checkLeakage(id));
  }

  /**
   * Whether the gold subset could be frozen, and what is missing if not.
   *
   * Read-only on purpose: the answer is what a reviewer needs before starting,
   * not something to discover at the moment the freeze is refused.
   */
  @Get(":id/gold")
  @RequirePermissions("vision.read")
  async gold(@Param("id") id: string) {
    return jsonSafe(await this.datasets.goldStatus(id));
  }

  @Get(":id/representation")
  @RequirePermissions("vision.read")
  async representation(@Param("id") id: string) {
    return jsonSafe(await this.datasets.representation(id));
  }

  @Post()
  @RequirePermissions("vision.datasets.manage")
  async create(@Body() dto: CreateDatasetVersionDto, @AdminAuth() auth: AdminAuthContext) {
    return jsonSafe(await this.datasets.createVersion(dto, auth));
  }

  /** Partial success by design: the rejections are the useful half of the response. */
  @Post(":id/members")
  @RequirePermissions("vision.datasets.manage")
  async addMembers(
    @Param("id") id: string,
    @Body() dto: AddMembersDto,
    @AdminAuth() auth: AdminAuthContext
  ) {
    return jsonSafe(await this.datasets.addMembers(id, dto.videoAssetIds, auth));
  }

  @Post(":id/splits")
  @RequirePermissions("vision.datasets.manage")
  async generateSplits(@Param("id") id: string, @AdminAuth() auth: AdminAuthContext) {
    return jsonSafe(await this.datasets.generateSplits(id, auth));
  }

  @Post(":id/freeze")
  @RequirePermissions("vision.datasets.manage")
  async freeze(@Param("id") id: string, @AdminAuth() auth: AdminAuthContext) {
    return jsonSafe(await this.datasets.freeze(id, auth));
  }
}
