import { Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from "@nestjs/common";
import { IsBoolean, IsEmail, IsIn, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { AdminAuth } from "../../admin/decorators/admin-auth.decorator";
import { RequirePermissions } from "../../admin/decorators/require-permissions.decorator";
import { AdminAuthGuard } from "../../admin/guards/admin-auth.guard";
import { PermissionsGuard } from "../../admin/guards/permissions.guard";
import type { AdminAuthContext } from "../../admin/auth/admin-auth.types";
import { jsonSafe } from "../shared/json-safe";
import { VisionEventGoldService } from "./event-gold.service";

export class CreateEventGoldDto {
  @IsString() @MaxLength(120) label!: string;
  @IsString() @MaxLength(200) videoAssetId!: string;
  @IsInt() @Min(0) windowStartMs!: number;
  @IsInt() @Min(1) windowEndMs!: number;
  @IsInt() @Min(0) @Max(10000) toleranceMs!: number;
  @IsEmail() reviewerAEmail!: string;
  @IsEmail() reviewerBEmail!: string;
}
export class SubmitEventGoldDto { @IsObject() labels!: unknown; @IsBoolean() complete!: boolean; }
export class ReconcileEventGoldDto { @IsObject() labels!: unknown; @IsString() @MaxLength(2000) reason!: string; }
export class FreezeEventGoldDto { @IsString() @MaxLength(200) proposalId!: string; }
export class EventBenchmarkDto {
  @IsOptional() @IsIn(["all_current_candidates", "model_original_candidates", "complete_event_run"]) scope?: "all_current_candidates" | "model_original_candidates" | "complete_event_run";
  @IsOptional() @IsString() @MaxLength(200) modelVersionId?: string;
  @IsOptional() @IsString() @MaxLength(200) jobId?: string;
}

@Controller("vision/event-gold")
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class VisionEventGoldController {
  constructor(@Inject(VisionEventGoldService) private readonly gold: VisionEventGoldService) {}

  @Get()
  @RequirePermissions("vision.review")
  async list(@AdminAuth() auth: AdminAuthContext, @Query("assetId") assetId?: string) { return jsonSafe(await this.gold.list(auth, assetId)); }

  @Post()
  @RequirePermissions("vision.review")
  async create(@Body() dto: CreateEventGoldDto, @AdminAuth() auth: AdminAuthContext) { return jsonSafe(await this.gold.create(dto, auth)); }

  @Get(":id")
  @RequirePermissions("vision.review")
  async get(@Param("id") id: string, @AdminAuth() auth: AdminAuthContext) { return jsonSafe(await this.gold.get(id, auth)); }

  @Post(":id/submissions")
  @RequirePermissions("vision.review")
  async submit(@Param("id") id: string, @Body() dto: SubmitEventGoldDto, @AdminAuth() auth: AdminAuthContext) { return jsonSafe(await this.gold.submit(id, dto, auth)); }

  @Post(":id/reconciliations")
  @RequirePermissions("vision.review")
  async reconcile(@Param("id") id: string, @Body() dto: ReconcileEventGoldDto, @AdminAuth() auth: AdminAuthContext) { return jsonSafe(await this.gold.reconcile(id, dto, auth)); }

  @Post(":id/freeze")
  @RequirePermissions("vision.review")
  async freeze(@Param("id") id: string, @Body() dto: FreezeEventGoldDto, @AdminAuth() auth: AdminAuthContext) { return jsonSafe(await this.gold.freeze(id, dto, auth)); }

  @Post(":id/benchmarks")
  @RequirePermissions("vision.review")
  async benchmark(@Param("id") id: string, @AdminAuth() auth: AdminAuthContext, @Body() dto?: EventBenchmarkDto) { return jsonSafe(await this.gold.benchmark(id, auth, dto)); }

  @Get(":id/benchmarks/:runId")
  @RequirePermissions("vision.review")
  async report(@Param("id") id: string, @Param("runId") runId: string, @AdminAuth() auth: AdminAuthContext) { return jsonSafe(await this.gold.report(id, runId, auth)); }
}
