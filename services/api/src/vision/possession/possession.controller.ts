import { Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from "@nestjs/common";
import { IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";
import { AdminAuth } from "../../admin/decorators/admin-auth.decorator";
import { RequirePermissions } from "../../admin/decorators/require-permissions.decorator";
import { AdminAuthGuard } from "../../admin/guards/admin-auth.guard";
import { PermissionsGuard } from "../../admin/guards/permissions.guard";
import type { AdminAuthContext } from "../../admin/auth/admin-auth.types";
import { jsonSafe } from "../shared/json-safe";
import { VisionPossessionService } from "./possession.service";

export class ImportPossessionDto { @IsUUID() jobId!: string; }
export class DecidePossessionDto {
  @IsIn(["accepted", "rejected"]) decision!: string;
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}
export class CorrectPossessionDto {
  @IsUUID() parentKey!: string;
  @IsInt() startMs!: number;
  @IsInt() endMs!: number;
  @IsIn(["candidate", "unknown"]) state!: string;
  @IsOptional() @IsUUID() actorTrackId?: string | null;
  @IsString() @MaxLength(1000) reason!: string;
}

@Controller("vision/review")
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class VisionPossessionController {
  constructor(@Inject(VisionPossessionService) private readonly possession: VisionPossessionService) {}
  @Get(":assetId/possession")
  @RequirePermissions("vision.read")
  async forAsset(@Param("assetId") id: string) { return jsonSafe(await this.possession.forAsset(id)); }
  @Post(":assetId/possession/import")
  @RequirePermissions("vision.review")
  async importRun(@Param("assetId") id: string, @Body() dto: ImportPossessionDto, @AdminAuth() actor: AdminAuthContext) { return this.possession.importRun(id, dto.jobId, actor); }
  @Get("possession/runs/:id")
  @RequirePermissions("vision.read")
  async get(@Param("id") id: string, @Query("cursor") cursor?: string) { return jsonSafe(await this.possession.get(id, cursor === undefined ? 0 : Number(cursor))); }
  @Post("possession/segments/:id/decision")
  @RequirePermissions("vision.review")
  async decide(@Param("id") id: string, @Body() dto: DecidePossessionDto, @AdminAuth() actor: AdminAuthContext) { return jsonSafe(await this.possession.decide(id, dto, actor)); }
  @Get("possession/segments/:id/correction-tracks")
  @RequirePermissions("vision.read")
  async correctionTracks(@Param("id") id: string) { return this.possession.correctionTracks(id); }
  @Post("possession/segments/:id/corrections")
  @RequirePermissions("vision.review")
  async correct(@Param("id") id: string, @Body() dto: CorrectPossessionDto, @AdminAuth() actor: AdminAuthContext) { return jsonSafe(await this.possession.correct(id, dto, actor)); }
  @Post("possession/corrections/:id/decision")
  @RequirePermissions("vision.review")
  async decideCorrection(@Param("id") id: string, @Body() dto: DecidePossessionDto, @AdminAuth() actor: AdminAuthContext) { return jsonSafe(await this.possession.decideCorrection(id, dto, actor)); }
}
