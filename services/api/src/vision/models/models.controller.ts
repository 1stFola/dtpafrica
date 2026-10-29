import { Body, Controller, Get, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { AdminAuth } from "../../admin/decorators/admin-auth.decorator";
import { RequirePermissions } from "../../admin/decorators/require-permissions.decorator";
import { AdminAuthGuard } from "../../admin/guards/admin-auth.guard";
import { PermissionsGuard } from "../../admin/guards/permissions.guard";
import type { AdminAuthContext } from "../../admin/auth/admin-auth.types";
import { jsonSafe } from "../shared/json-safe";
import { VisionBenchmarksService } from "./benchmarks.service";
import {
  ApprovePromotionDto,
  CreateModelDto,
  RegisterFromTrainingDto,
  RegisterModelVersionDto,
  RejectPromotionDto,
  RequestBenchmarkDto,
  RequestTrainingDto,
} from "./dto/models.dto";
import { VisionModelsService } from "./models.service";
import { VisionTrainingService } from "./training.service";
import { VisionPromotionsService } from "./promotions.service";

/**
 * The model registry's endpoints.
 *
 * Registration needs `vision.models.train`; reads need `vision.read`. A version's
 * `stage` moves only through the promotion routes: a trainer requests, a second
 * person with `vision.models.promote` approves or rejects, and rollback is one
 * operation. Nobody PATCHes a stage.
 */
@Controller("vision/models")
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class VisionModelsController {
  constructor(
    @Inject(VisionModelsService) private readonly models: VisionModelsService,
    @Inject(VisionBenchmarksService) private readonly benchmarks: VisionBenchmarksService,
    @Inject(VisionPromotionsService) private readonly promotions: VisionPromotionsService,
    @Inject(VisionTrainingService) private readonly training: VisionTrainingService
  ) {}

  @Get()
  @RequirePermissions("vision.read")
  async list() {
    return jsonSafe(await this.models.listModels());
  }

  @Get("versions/:id")
  @RequirePermissions("vision.read")
  async getVersion(@Param("id") id: string) {
    return jsonSafe(await this.models.getVersion(id));
  }

  @Get("versions/:id/benchmarks")
  @RequirePermissions("vision.read")
  async benchmarksFor(@Param("id") id: string) {
    return jsonSafe(await this.benchmarks.listForVersion(id));
  }

  /** A run with its metrics per slice. The dashboard never shows a headline without them. */
  @Get("benchmarks/:id")
  @RequirePermissions("vision.read")
  async benchmark(@Param("id") id: string) {
    return jsonSafe(await this.benchmarks.get(id));
  }

  /**
   * Score a version against a frozen gold version. `vision.models.train`, like the
   * registration it follows: measuring is the trainer's job. Judging the measurement
   * worthy of production is somebody else's: the promotion routes below.
   */
  @Post("versions/:id/benchmark")
  @RequirePermissions("vision.models.train")
  async requestBenchmark(
    @Param("id") id: string,
    @Body() dto: RequestBenchmarkDto,
    @AdminAuth() auth: AdminAuthContext
  ) {
    return jsonSafe(await this.benchmarks.request(id, dto.datasetVersionId, auth));
  }

  @Get("versions/:id/promotions")
  @RequirePermissions("vision.read")
  async promotionsFor(@Param("id") id: string) {
    return jsonSafe(await this.promotions.listForVersion(id));
  }

  @Get("promotions/:id")
  @RequirePermissions("vision.read")
  async promotion(@Param("id") id: string) {
    return jsonSafe(await this.promotions.get(id));
  }

  /** The trainer asks. The gate runs now and the findings are stored on the request. */
  @Post("versions/:id/promotion-request")
  @RequirePermissions("vision.models.train")
  async requestPromotion(@Param("id") id: string, @AdminAuth() auth: AdminAuthContext) {
    return jsonSafe(await this.promotions.request(id, auth));
  }

  /** A second person decides. The gate runs again; the version is promoted on today's facts. */
  @Post("versions/:id/promote")
  @RequirePermissions("vision.models.promote")
  async promote(@Param("id") id: string, @Body() dto: ApprovePromotionDto, @AdminAuth() auth: AdminAuthContext) {
    return jsonSafe(await this.promotions.approve(id, auth, dto.note));
  }

  @Post("promotions/:id/reject")
  @RequirePermissions("vision.models.promote")
  async rejectPromotion(@Param("id") id: string, @Body() dto: RejectPromotionDto, @AdminAuth() auth: AdminAuthContext) {
    return jsonSafe(await this.promotions.reject(id, dto.reason, auth));
  }

  /** One operation: restore what this version replaced when it was promoted. */
  @Post("versions/:id/rollback")
  @RequirePermissions("vision.models.promote")
  async rollback(@Param("id") id: string, @AdminAuth() auth: AdminAuthContext) {
    return jsonSafe(await this.promotions.rollback(id, auth));
  }

  @Post()
  @RequirePermissions("vision.models.train")
  async create(@Body() dto: CreateModelDto, @AdminAuth() auth: AdminAuthContext) {
    return jsonSafe(await this.models.createModel(dto, auth));
  }

  /** This month's training spend against its cap: spent, held by open runs, and left. */
  @Get("training/budget")
  @RequirePermissions("vision.read")
  async trainingBudget() {
    return this.training.monthToDate();
  }

  /** A fine-tuning run on a frozen dataset (docs/vision/102); its budget is approved with the request. */
  @Post("training")
  @RequirePermissions("vision.models.train")
  async requestTraining(@Body() dto: RequestTrainingDto, @AdminAuth() auth: AdminAuthContext) {
    return jsonSafe(await this.training.request(dto, auth));
  }

  /** A candidate version from a succeeded run: weights, checksum, dataset and config come from the run. */
  @Post(":id/versions/from-training")
  @RequirePermissions("vision.models.train")
  async registerFromTraining(@Param("id") id: string, @Body() dto: RegisterFromTrainingDto, @AdminAuth() auth: AdminAuthContext) {
    return jsonSafe(await this.training.registerFromRun(id, dto, auth));
  }

  @Post(":id/versions")
  @RequirePermissions("vision.models.train")
  async registerVersion(
    @Param("id") id: string,
    @Body() dto: RegisterModelVersionDto,
    @AdminAuth() auth: AdminAuthContext
  ) {
    return jsonSafe(await this.models.registerVersion(id, dto, auth));
  }
}
