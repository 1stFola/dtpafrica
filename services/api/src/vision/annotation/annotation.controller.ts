import { Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from "@nestjs/common";
import { AdminAuth } from "../../admin/decorators/admin-auth.decorator";
import { RequirePermissions } from "../../admin/decorators/require-permissions.decorator";
import { AdminAuthGuard } from "../../admin/guards/admin-auth.guard";
import { PermissionsGuard } from "../../admin/guards/permissions.guard";
import type { AdminAuthContext } from "../../admin/auth/admin-auth.types";
import { jsonSafe } from "../shared/json-safe";
import { VisionAnnotationService } from "./annotation.service";
import {
  AbandonTaskDto,
  ClaimTaskDto,
  ConvertQueueItemDto,
  CreateLabelSchemaDto,
  CreateTaskDto,
  EnqueueDto,
  ReviewDto,
  SubmitAnnotationDto,
} from "./dto/annotation.dto";

/**
 * Annotation endpoints.
 *
 * The permission split is the point, and it mirrors the roles that already exist:
 *
 *   - `vision.annotate` claims and submits. It does **not** review, and
 *     `vision_annotator` deliberately lacks `vision.media.raw.read`, so nothing
 *     here hands an annotator the master — only a presigned proxy.
 *   - `vision.review` records verdicts, and the service additionally refuses a
 *     reviewer who is the annotator. Holding the permission is not enough.
 *   - `vision.datasets.manage` publishes label schemas and creates work, because
 *     deciding what gets labelled is a corpus decision, not a labelling one.
 */
@Controller("vision/annotation")
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class VisionAnnotationController {
  constructor(
    @Inject(VisionAnnotationService) private readonly annotation: VisionAnnotationService
  ) {}

  // ── Label schema ─────────────────────────────────────────────────────────

  @Get("schemas")
  @RequirePermissions("vision.read")
  async listSchemas() {
    return jsonSafe(await this.annotation.listLabelSchemas());
  }

  @Post("schemas")
  @RequirePermissions("vision.datasets.manage")
  async createSchema(@Body() dto: CreateLabelSchemaDto, @AdminAuth() auth: AdminAuthContext) {
    return jsonSafe(await this.annotation.createLabelSchema(dto, auth));
  }

  @Post("schemas/:id/supersede")
  @RequirePermissions("vision.datasets.manage")
  async supersedeSchema(@Param("id") id: string, @AdminAuth() auth: AdminAuthContext) {
    return jsonSafe(await this.annotation.supersedeLabelSchema(id, auth));
  }

  // ── Tasks ────────────────────────────────────────────────────────────────

  @Post("tasks")
  @RequirePermissions("vision.datasets.manage")
  async createTask(@Body() dto: CreateTaskDto, @AdminAuth() auth: AdminAuthContext) {
    return jsonSafe(await this.annotation.createTask(dto, auth));
  }

  /** Atomic: two annotators cannot be handed the same window. */
  @Post("tasks/claim")
  @RequirePermissions("vision.annotate")
  async claim(@Body() dto: ClaimTaskDto) {
    return jsonSafe(
      await this.annotation.claimNextTask(dto.annotatorId, {
        samplingStrategy: dto.samplingStrategy,
      })
    );
  }

  @Get("tasks/:id")
  @RequirePermissions("vision.read")
  async getTask(@Param("id") id: string) {
    return jsonSafe(await this.annotation.getTask(id));
  }

  @Post("tasks/:id/submit")
  @RequirePermissions("vision.annotate")
  async submit(
    @Param("id") id: string,
    @Body() dto: SubmitAnnotationDto,
    @AdminAuth() auth: AdminAuthContext
  ) {
    return jsonSafe(await this.annotation.submit(id, dto, auth));
  }

  @Post("tasks/:id/abandon")
  @RequirePermissions("vision.datasets.manage")
  async abandon(
    @Param("id") id: string,
    @Body() dto: AbandonTaskDto,
    @AdminAuth() auth: AdminAuthContext
  ) {
    return jsonSafe(await this.annotation.abandonTask(id, dto.reason, auth));
  }

  // ── Submissions and review ───────────────────────────────────────────────

  @Get("versions/:id")
  @RequirePermissions("vision.read")
  async readVersion(@Param("id") id: string) {
    return jsonSafe(await this.annotation.readSubmission(id));
  }

  @Post("versions/:id/review")
  @RequirePermissions("vision.review")
  async review(
    @Param("id") id: string,
    @Body() dto: ReviewDto,
    @AdminAuth() auth: AdminAuthContext
  ) {
    return jsonSafe(await this.annotation.review(id, dto, auth));
  }

  // ── Active learning ──────────────────────────────────────────────────────

  @Get("queue")
  @RequirePermissions("vision.read")
  async queue(@Query("limit") limit?: string) {
    return jsonSafe(await this.annotation.listQueue(limit ? Number(limit) : undefined));
  }

  @Post("queue")
  @RequirePermissions("vision.datasets.manage")
  async enqueue(@Body() dto: EnqueueDto, @AdminAuth() auth: AdminAuthContext) {
    return jsonSafe(await this.annotation.enqueue(dto, auth));
  }

  @Post("queue/:id/convert")
  @RequirePermissions("vision.datasets.manage")
  async convert(
    @Param("id") id: string,
    @Body() dto: ConvertQueueItemDto,
    @AdminAuth() auth: AdminAuthContext
  ) {
    return jsonSafe(await this.annotation.convertQueueItem(id, dto, auth));
  }

  /** The hard-case share, and whether pre-labelling is saving anyone time. */
  @Get("mix")
  @RequirePermissions("vision.read")
  async mix() {
    return jsonSafe(await this.annotation.mixReport());
  }
}
