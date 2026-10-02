import { Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from "@nestjs/common";
import { IsInt, IsOptional, Max, Min } from "class-validator";
import { AdminAuth } from "../../admin/decorators/admin-auth.decorator";
import { RequirePermissions } from "../../admin/decorators/require-permissions.decorator";
import { AdminAuthGuard } from "../../admin/guards/admin-auth.guard";
import { PermissionsGuard } from "../../admin/guards/permissions.guard";
import type { AdminAuthContext } from "../../admin/auth/admin-auth.types";
import { jsonSafe } from "../shared/json-safe";
import { VisionClockService } from "./clock.service";

export class AnchorClockDto {
  @IsInt()
  @Min(1)
  @Max(4)
  half!: number;

  /** Source millisecond of this half's kick-off. */
  @IsInt()
  @Min(0)
  sourceMs!: number;

  /** Source millisecond of the whistle ending this half, when known. */
  @IsOptional()
  @IsInt()
  @Min(1)
  endMs?: number;
}

/** The match clock, anchored to the footage by a person and read by anyone. */
@Controller("vision/review")
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class VisionClockController {
  constructor(@Inject(VisionClockService) private readonly clock: VisionClockService) {}

  @Get(":assetId/clock")
  @RequirePermissions("vision.read")
  async read(@Param("assetId") assetId: string, @Query("sourceMs") sourceMs?: string) {
    const at = sourceMs === undefined || sourceMs === "" ? undefined : Number(sourceMs);
    return jsonSafe(await this.clock.read(assetId, Number.isFinite(at) ? at : undefined));
  }

  @Post(":assetId/clock")
  @RequirePermissions("vision.review")
  async anchor(@Param("assetId") assetId: string, @Body() dto: AnchorClockDto, @AdminAuth() auth: AdminAuthContext) {
    return jsonSafe(await this.clock.anchor(assetId, dto, auth));
  }
}
