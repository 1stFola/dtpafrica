import { Body, Controller, Get, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { AdminAuth } from "../../admin/decorators/admin-auth.decorator";
import { RequirePermissions } from "../../admin/decorators/require-permissions.decorator";
import { AdminAuthGuard } from "../../admin/guards/admin-auth.guard";
import { PermissionsGuard } from "../../admin/guards/permissions.guard";
import type { AdminAuthContext } from "../../admin/auth/admin-auth.types";
import { jsonSafe } from "../shared/json-safe";
import { VisionBenchmarksService } from "./benchmarks.service";
import { CreateModelDto, RegisterModelVersionDto, RequestBenchmarkDto } from "./dto/models.dto";
import { VisionModelsService } from "./models.service";

/**
 * The model registry's endpoints.
 *
 * Registration needs `vision.models.train`; reads need `vision.read`. Note what is
 * absent: no route changes a version's `stage`. Promotion is the two-person act in
 * docs/vision/10-EVALUATION-AND-GATES.md, and it arrives with the benchmark ledger
 * that justifies it -- not as a PATCH anyone with `train` could call.
 */
@Controller("vision/models")
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class VisionModelsController {
  constructor(
    @Inject(VisionModelsService) private readonly models: VisionModelsService,
    @Inject(VisionBenchmarksService) private readonly benchmarks: VisionBenchmarksService
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
   * worthy of production is somebody else's, and has no route yet.
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

  @Post()
  @RequirePermissions("vision.models.train")
  async create(@Body() dto: CreateModelDto, @AdminAuth() auth: AdminAuthContext) {
    return jsonSafe(await this.models.createModel(dto, auth));
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
