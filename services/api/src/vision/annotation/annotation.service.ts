import { createHash, randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import {
  ACTIVE_LEARNING_REASONS,
  ANNOTATION_TASK_STATES,
  OPEN_ANNOTATION_TASK_STATES,
  REASON_REQUIRED_REVIEW_DECISIONS,
  REJECTION_REASONS,
  REVIEW_DECISIONS,
  SAMPLING_STRATEGIES,
  visionKeys,
  type AnnotationTaskState,
  type RejectionReason,
  type ReviewDecision,
  type SamplingStrategy,
  validateAnnotationBoxes,
} from "@dtp/vision-contracts";
import type { AdminAuthContext } from "../../admin/auth/admin-auth.types";
import { PrismaService } from "../../prisma/prisma.service";
import { VisionAuditService } from "../audit/vision-audit.service";
import { RightsPolicyService } from "../rights/rights-policy.service";
import { VISION_CONFIG, type VisionConfig } from "../config/vision.config";
import { OBJECT_STORE, type ObjectStore } from "../storage/object-store";
import { notFound, refusal } from "../shared/refusals";
import { readHardFrames } from "./hard-frames-artifact";

/**
 * Annotation: the human work that produces DTP's only irreplaceable training data.
 *
 * Models can be retrained. Labelled Nigerian youth football, corrected by someone
 * who knows what they are looking at, cannot be bought. So this module is built
 * around never losing it and never trusting it blindly:
 *
 *   - **Submissions supersede, they never overwrite.** The correction is the
 *     signal. An UPDATE on a labels row would destroy exactly the data worth most.
 *   - **A reviewer may not approve their own work.** The same separation of duty
 *     the model registry already has between training and promoting.
 *   - **An annotator never receives raw footage.** They get a presigned proxy,
 *     because `vision_annotator` deliberately lacks `vision.media.raw.read` and a
 *     service that handed out the master would silently undo that.
 *   - **A pre-label is always marked as one.** An unmarked model suggestion is an
 *     anchoring-bias machine: the human agrees with it and the error becomes
 *     ground truth.
 *
 * See docs/vision/09-ML-PIPELINE.md and docs/vision/23-PHASE-2-INCREMENT-2.md.
 */

export type LabelSchemaInput = {
  version: string;
  definitions: Record<string, unknown>;
  handbookKey?: string;
  notes?: string;
  effectiveFrom?: string;
};

export type TaskInput = {
  videoAssetId: string;
  labelSchemaVersionId: string;
  samplingStrategy: SamplingStrategy;
  startMs: number;
  endMs: number;
  assignedTo?: string;
  preLabelModelVersionId?: string;
  /** The hard_frames job whose artifact holds the pre-labels, when the task came from one. */
  preLabelJobId?: string;
};

/**
 * Closed vocabularies, enforced **here** and not only in the DTOs.
 *
 * The DTOs do carry `@IsIn`, and in production that fires — but the dev server runs
 * under a transpiler that does not emit decorator metadata, so Nest's
 * ValidationPipe sees no type to validate against and passes every body straight
 * through. A guard that only exists in one environment is a guard nothing can
 * verify, and every gate script runs against dev.
 *
 * These are domain invariants in any case: "a sampling strategy is one of these
 * seven" is a fact about the corpus, not about HTTP.
 */
function assertOneOf<T extends string>(
  value: string,
  allowed: readonly T[],
  field: string
): T {
  if (!allowed.includes(value as T)) {
    throw refusal(400, "ValueNotAllowed", `${field} must be one of: ${allowed.join(", ")} — got ${JSON.stringify(value)}`, "Send one of the values listed.");
  }
  return value as T;
}

/** The summary a job's completion logged, or nothing. */
const summaryOf = (progress: unknown) => ((progress as { summary?: Record<string, unknown> } | null)?.summary ?? {}) as Record<string, unknown>;

/** The middle value, or null when there is none; minutes to one decimal. */
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return Math.round(value * 10) / 10;
}

/** The longest window a single task may cover. */
const MAX_TASK_WINDOW_MS = 10 * 60 * 1000;

/**
 * The suffix `vision:seed-demo` puts on its label schema ("demo-2026.1 (demo)").
 *
 * Claiming skips tasks under such a schema. The seed's tasks are older than any real
 * queue, so oldest-first handed a labeller the five-second test pattern before a
 * single real frame (20 Oct 2026, with 3,436 real frames waiting).
 */
export const DEMO_SCHEMA_SUFFIX = "(demo)";

@Injectable()
export class VisionAnnotationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    @Inject(RightsPolicyService) private readonly rights: RightsPolicyService,
    @Inject(VisionAuditService) private readonly audit: VisionAuditService,
    @Inject(VISION_CONFIG) private readonly config: VisionConfig
  ) {}

  // ── Label schema ─────────────────────────────────────────────────────────

  /**
   * Publish a label taxonomy version.
   *
   * Versioned rather than edited because changing what counts as a "pass" changes
   * what every existing label means. Two annotators working to different
   * definitions of the same word produce disagreement that looks like noise, and
   * the fix — re-reading a handbook nobody versioned — is unavailable after the
   * fact. Superseding the previous version is explicit, and old tasks keep
   * pointing at the definitions they were actually labelled under.
   */
  async createLabelSchema(dto: LabelSchemaInput, actor?: AdminAuthContext) {
    const existing = await this.prisma.visionLabelSchemaVersion.findUnique({
      where: { version: dto.version },
      select: { id: true },
    });
    if (existing) {
      throw refusal(409, "LabelSchemaExists", `Label schema ${dto.version} already exists. Publish a new version rather than changing it: existing annotations were made under the old definitions.`, "Publish it under a new version identifier.");
    }
    if (!dto.version?.trim()) {
      throw refusal(400, "LabelSchemaVersionRequired", "A label schema needs a version identifier", "Give the schema a version, such as 2026.2.");
    }
    // `Object.keys("text").length` is 4, so a string would have sailed through a
    // bare emptiness check and become a taxonomy made of character indices.
    if (
      typeof dto.definitions !== "object" ||
      dto.definitions === null ||
      Array.isArray(dto.definitions)
    ) {
      throw refusal(400, "LabelDefinitionsInvalid", "definitions must be an object of label definitions", "Send definitions as an object: one key per label, its meaning as the value.");
    }
    if (Object.keys(dto.definitions).length === 0) {
      throw refusal(400, "LabelDefinitionsEmpty", "A label schema needs definitions. An empty taxonomy cannot tell two annotators apart.", "Define at least one label.");
    }

    const created = await this.prisma.visionLabelSchemaVersion.create({
      data: {
        version: dto.version,
        definitions: dto.definitions as never,
        handbookKey: dto.handbookKey ?? null,
        notes: dto.notes ?? null,
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date(),
        authoredBy: actor?.userId ?? null,
      },
    });

    await this.audit.record(
      {
        action: "annotation.schema.published",
        targetKind: "vision_label_schema_version",
        targetId: created.id,
        data: { version: created.version, classes: Object.keys(dto.definitions).length },
      },
      actor
    );
    return created;
  }

  /**
   * Retire a schema version.
   *
   * It is not deleted, and tasks already labelled under it keep pointing at it.
   * Deleting would leave existing labels meaning nothing in particular.
   */
  async supersedeLabelSchema(id: string, actor?: AdminAuthContext) {
    const schema = await this.prisma.visionLabelSchemaVersion.findUnique({ where: { id } });
    if (!schema) throw notFound("label schema", id);
    if (schema.supersededAt) {
      throw refusal(409, "LabelSchemaSuperseded", `Label schema ${schema.version} is already superseded.`, "Nothing to do: it was superseded already.");
    }

    const open = await this.prisma.visionAnnotationTask.count({
      where: { labelSchemaVersionId: id, state: { in: [...OPEN_ANNOTATION_TASK_STATES] } },
    });
    if (open > 0) {
      // Otherwise an annotator is mid-task against definitions that have just been
      // retired, and nobody tells them.
      throw new ConflictException({
        statusCode: 409,
        error: "OpenTasksAgainstSchema",
        message: `${open} task(s) are still open against ${schema.version}.`,
        remediation: "Finish or abandon them first, then supersede.",
      });
    }

    return this.prisma.visionLabelSchemaVersion.update({
      where: { id },
      data: { supersededAt: new Date() },
    });
  }

  async listLabelSchemas() {
    return {
      schemas: await this.prisma.visionLabelSchemaVersion.findMany({
        orderBy: { effectiveFrom: "desc" },
        include: { _count: { select: { annotationTasks: true } } },
      }),
    };
  }

  // ── Tasks ────────────────────────────────────────────────────────────────

  /**
   * Create one unit of annotation work.
   *
   * Rights are checked here rather than at submission: the refusal has to happen
   * before a human is shown the footage, because by then the disclosure has
   * already occurred and no later check can undo it.
   *
   * The scope is `canAnalyze`, not `canTrain`. Annotation *is* internal analysis;
   * whether the resulting labels may train a model is a separate question the
   * dataset factory asks at membership time, against the state of the grants then
   * rather than now. Checking `canTrain` here would also block perfectly legitimate
   * analysis-only labelling.
   */
  async createTask(dto: TaskInput, actor?: AdminAuthContext) {
    const samplingStrategy = assertOneOf(
      dto.samplingStrategy,
      SAMPLING_STRATEGIES,
      "samplingStrategy"
    );
    if (!Number.isInteger(dto.startMs) || !Number.isInteger(dto.endMs)) {
      throw refusal(400, "WindowNotWholeMilliseconds", "Window bounds must be whole milliseconds", "Send startMs and endMs as integers.");
    }
    if (dto.endMs <= dto.startMs) {
      throw refusal(400, "WindowEndsBeforeStart", "A task window must end after it starts", "Make endMs greater than startMs.");
    }
    if (dto.endMs - dto.startMs > MAX_TASK_WINDOW_MS) {
      throw refusal(400, "WindowTooLong", `A task window may not exceed ${MAX_TASK_WINDOW_MS / 60000} minutes. Split it: a task nobody can finish in one sitting gets abandoned half-done.`, "Split the window into shorter tasks.");
    }

    const schema = await this.prisma.visionLabelSchemaVersion.findUnique({
      where: { id: dto.labelSchemaVersionId },
      select: { id: true, version: true, supersededAt: true },
    });
    if (!schema) throw notFound("label schema", dto.labelSchemaVersionId);
    if (schema.supersededAt) {
      throw refusal(400, "LabelSchemaSuperseded", `Label schema ${schema.version} was superseded on ${schema.supersededAt.toISOString()}. New work uses the current definitions.`, "Create the task under the current label schema.");
    }

    const asset = await this.prisma.visionVideoAsset.findUnique({
      where: { id: dto.videoAssetId },
      select: {
        id: true,
        durationMs: true,
        variants: { where: { kind: "proxy" }, select: { id: true }, take: 1 },
      },
    });
    if (!asset) throw notFound("video asset", dto.videoAssetId);

    // No proxy, no task. An annotator has no route to the master by design, so a
    // task on an asset without a proxy is work nobody can open.
    if (asset.variants.length === 0) {
      throw new ConflictException({
        statusCode: 409,
        error: "NoProxyAvailable",
        message: "This asset has no proxy, and annotators are never given the master.",
        remediation: "Run the transcode stage first, then create the task.",
      });
    }
    if (asset.durationMs !== null && dto.endMs > asset.durationMs) {
      throw refusal(400, "WindowPastAsset", `The window ends at ${dto.endMs}ms but the asset is ${asset.durationMs}ms long`, "End the window inside the footage.");
    }

    const decision = await this.rights.canAnalyze({ videoAssetId: dto.videoAssetId });
    if (!decision.allowed) {
      throw new ForbiddenException({
        statusCode: 403,
        error: "RightsDenied",
        message: "This footage may not be analysed, so it may not be put in front of an annotator.",
        reason: decision.reason,
        detail: decision.detail,
        remediation: decision.remediation,
      });
    }

    const task = await this.prisma.visionAnnotationTask.create({
      data: {
        videoAssetId: dto.videoAssetId,
        labelSchemaVersionId: dto.labelSchemaVersionId,
        samplingStrategy,
        startMs: dto.startMs,
        endMs: dto.endMs,
        assignedTo: dto.assignedTo ?? null,
        state: dto.assignedTo ? "assigned" : "queued",
        // A model produced the starting labels, and the reviewer must be able to see
        // that. An unmarked pre-label is an anchoring-bias machine.
        preLabelled: Boolean(dto.preLabelModelVersionId),
        preLabelModelVersionId: dto.preLabelModelVersionId ?? null,
        preLabelJobId: dto.preLabelJobId ?? null,
      },
    });

    await this.audit.record(
      {
        action: "annotation.task.created",
        targetKind: "vision_annotation_task",
        targetId: task.id,
        data: {
          videoAssetId: task.videoAssetId,
          samplingStrategy: task.samplingStrategy,
          windowMs: task.endMs - task.startMs,
          preLabelled: task.preLabelled,
        },
      },
      actor
    );
    return task;
  }

  /**
   * Claim the next open task, atomically.
   *
   * `FOR UPDATE SKIP LOCKED`, the same as the job queue: two annotators opening the
   * tool at once must not be handed the same window, or one of them wastes an hour
   * and the disagreement metric is polluted by work that was never independent.
   */
  async claimNextTask(annotatorId: string, filters: { samplingStrategy?: string } = {}) {
    const strategy = filters.samplingStrategy ?? null;

    // ONE statement, exactly as the job queue does it. A separate SELECT … FOR
    // UPDATE followed by an UPDATE would release the row lock the moment the SELECT
    // returned, so two annotators opening the tool together could be handed the same
    // window — one of them wastes an hour, and the disagreement metric is polluted
    // by work that was never independent.
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE vision_annotation_tasks SET
        assigned_to = ${annotatorId},
        state = 'assigned',
        updated_at = now()
      WHERE id = (
        SELECT id FROM vision_annotation_tasks
        WHERE (
              -- Work already theirs, including a rejected pass coming back for
              -- another go, before anything from the open pool.
              (assigned_to = ${annotatorId} AND state IN ('assigned', 'rejected'))
           OR (assigned_to IS NULL AND state = 'queued')
        )
          AND (${strategy}::text IS NULL OR sampling_strategy = ${strategy}::text)
          -- Only real work under live definitions: never a demo-seed task, and never
          -- one whose schema was retired. A subquery rather than a join, because
          -- FOR UPDATE would lock the joined schema row too, and SKIP LOCKED would
          -- then hand the second of two simultaneous claimers nothing at all.
          AND label_schema_version_id IN (
            SELECT id FROM vision_label_schema_versions
            WHERE superseded_at IS NULL
              AND version NOT LIKE ${"%" + DEMO_SCHEMA_SUFFIX}
          )
        ORDER BY (assigned_to IS NOT NULL) DESC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id
    `;
    if (!rows.length) return { task: null as null };

    // Already claimed above; this only loads what the annotator needs to work.
    const task = await this.prisma.visionAnnotationTask.findUniqueOrThrow({
      where: { id: rows[0]!.id },
      include: {
        labelSchemaVersion: { select: { id: true, version: true, definitions: true } },
        videoAsset: {
          select: {
            id: true,
            durationMs: true,
            variants: {
              where: { kind: "proxy" },
              // The newest proxy, the one inference used: after a transcode retry
              // there are two (docs/vision/50, appendix A).
              orderBy: { createdAt: "desc" },
              select: { objectKey: true, sourceOffsetMs: true, fps: true },
              take: 1,
            },
          },
        },
      },
    });

    return { task, media: await this.proxyForTask(task) };
  }

  /**
   * A presigned URL for the task's window — always the proxy, never the master.
   *
   * The window is translated by the proxy's `sourceOffsetMs`. A proxy that does not
   * start at source zero would otherwise put every label a few seconds out, which
   * is the kind of error that survives review because the labels look internally
   * consistent.
   */
  private async proxyForTask(task: {
    id: string;
    startMs: number;
    endMs: number;
    videoAsset: { id: string; variants: { objectKey: string; sourceOffsetMs: number; fps: number | null }[] };
  }) {
    // Checked when the task was created, and again every time the footage is handed
    // out: a withdrawn grant stops annotation of it from the next request on.
    const decision = await this.rights.canAnalyze({ videoAssetId: task.videoAsset.id });
    if (!decision.allowed) {
      throw new ForbiddenException({
        statusCode: 403,
        error: "RightsDenied",
        message: decision.detail,
        reason: decision.reason,
        remediation: decision.remediation,
      });
    }
    const proxy = task.videoAsset.variants[0];
    if (!proxy) {
      throw refusal(409, "ProxyMissing", "This task's asset no longer has a proxy. Re-run transcode; the master is not an option.", "Run transcode for the asset again, then claim the task.");
    }
    return {
      url: await this.store.presignGet(
        "derived",
        proxy.objectKey,
        this.config.playback.urlTtlSeconds
      ),
      // In proxy time, which is what a player seeks to.
      windowStartMs: task.startMs - proxy.sourceOffsetMs,
      windowEndMs: task.endMs - proxy.sourceOffsetMs,
      fps: proxy.fps,
      expiresInSeconds: this.config.playback.urlTtlSeconds,
    };
  }

  async getTask(id: string) {
    const task = await this.prisma.visionAnnotationTask.findUnique({
      where: { id },
      include: {
        labelSchemaVersion: { select: { id: true, version: true, definitions: true } },
        videoAsset: {
          select: {
            id: true,
            durationMs: true,
            variants: {
              where: { kind: "proxy" },
              // The newest proxy, the one inference used: after a transcode retry
              // there are two (docs/vision/50, appendix A).
              orderBy: { createdAt: "desc" },
              select: { objectKey: true, sourceOffsetMs: true, fps: true },
              take: 1,
            },
          },
        },
        versions: {
          orderBy: { createdAt: "desc" },
          include: { reviews: { orderBy: { createdAt: "desc" } } },
        },
      },
    });
    if (!task) throw notFound("annotation task", id);
    return { task, media: await this.proxyForTask(task) };
  }

  async abandonTask(id: string, reason: string, actor?: AdminAuthContext) {
    const task = await this.requireTask(id);
    if (task.state === "approved") {
      throw refusal(409, "TaskApproved", "An approved task cannot be abandoned.", "Leave it: an approved task is finished work that datasets may reference.");
    }
    const updated = await this.prisma.visionAnnotationTask.update({
      where: { id },
      data: { state: "abandoned" },
    });
    await this.audit.record(
      {
        action: "annotation.task.abandoned",
        targetKind: "vision_annotation_task",
        targetId: id,
        reason,
      },
      actor
    );
    return updated;
  }

  // ── Submission ───────────────────────────────────────────────────────────

  /**
   * Submit labels as a **new version**.
   *
   * Nothing is ever updated in place. The second attempt supersedes the first and
   * both survive, because the difference between them is what tells DTP where the
   * model and the handbook are weak — and it is the only data here that cannot be
   * regenerated.
   *
   * Effort is recorded because a pre-labelling model that is 5% more accurate and
   * doubles correction time is worse for DTP, and without the minutes nobody can
   * tell.
   */
  async submit(
    taskId: string,
    dto: { payload: unknown; effortMinutes?: number; annotatorId?: string },
    actor?: AdminAuthContext
  ) {
    const task = await this.requireTask(taskId);
    if (task.state === "approved") {
      throw refusal(409, "TaskApproved", "This task is approved. Create a new task rather than resubmitting: an approved annotation is referenced by datasets.", "Create a new task for the window.");
    }
    if (task.state === "abandoned") {
      throw refusal(409, "TaskAbandoned", "This task was abandoned.", "Create a new task for the window.");
    }

    // The signed-in person, never the body's say-so; only the operator key (no
    // person) may name one (docs/vision/50, PR-4).
    if (actor?.userId && dto.annotatorId && dto.annotatorId !== actor.userId) {
      throw new BadRequestException({
        statusCode: 400,
        error: "AnnotatorIsTheSignedInPerson",
        message: "You can only submit as yourself.",
        remediation: "Leave annotatorId out; the signed-in account is used.",
      });
    }
    const annotatorId = actor?.userId ?? dto.annotatorId ?? null;
    if (task.assignedTo && annotatorId && task.assignedTo !== annotatorId) {
      throw refusal(403, "TaskAssignedToAnother", `This task is assigned to someone else. Claim it first, so two people are not labelling the same window unknowingly.`, "Claim a task of your own, or ask for this one to be released.");
    }
    if (dto.payload === null || dto.payload === undefined) {
      throw refusal(400, "PayloadRequired", "A submission needs a payload, even an empty label set", "Send the labels as payload; an empty set is { boxes: [] }.");
    }
    this.assertBoxesAreValid(dto.payload, task);
    if (dto.effortMinutes !== undefined && (!(dto.effortMinutes >= 0) || dto.effortMinutes > 480)) {
      throw refusal(400, "EffortOutOfRange", "effortMinutes must be between 0 and 480", "Send effortMinutes between 0 and 480, or leave it out.");
    }

    const previous = await this.prisma.visionAnnotationVersion.findFirst({
      where: { taskId },
      orderBy: { createdAt: "desc" },
      select: { id: true, supersedesId: true },
    });

    // Labels live in object storage; the row keeps the pointer and a checksum, so a
    // payload that changed underneath is detectable rather than silently trusted.
    const body = JSON.stringify(dto.payload);
    const checksum = createHash("sha256").update(body).digest("hex");
    const versionId = randomUUID();
    const ref = visionKeys.annotationPayload(taskId, versionId);
    await this.store.putSmallObject(ref.bucket, ref.key, body, "application/json");

    const version = await this.prisma.visionAnnotationVersion.create({
      data: {
        id: versionId,
        taskId,
        payloadKey: ref.key,
        payloadChecksum: checksum,
        annotatorId,
        effortMinutes: dto.effortMinutes ?? null,
        supersedesId: previous?.id ?? null,
      },
    });

    await this.prisma.visionAnnotationTask.update({
      where: { id: taskId },
      data: { state: "submitted", assignedTo: annotatorId ?? task.assignedTo },
    });

    await this.audit.record(
      {
        action: "annotation.submitted",
        targetKind: "vision_annotation_version",
        targetId: version.id,
        data: {
          taskId,
          supersedes: previous?.id ?? null,
          effortMinutes: dto.effortMinutes ?? null,
          // Kept so the anchoring question is answerable later: were the labels the
          // annotator started from produced by a model?
          preLabelled: task.preLabelled,
        },
      },
      actor
    );
    return version;
  }

  /**
   * Boxes are checked at the door, against the task's own window and pre-label
   * provenance, with the same rule the export applies (`validateAnnotationBoxes`
   * in the contracts). A payload without `boxes` is a Phase 2 payload and passes.
   *
   * Refused, not trimmed: a submission with one box outside the window is a
   * submission the annotator should look at again, and silently dropping the box
   * would make the rest look complete.
   */
  private assertBoxesAreValid(
    payload: unknown,
    task: { startMs: number; endMs: number; preLabelModelVersionId: string | null }
  ) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
    const raw = (payload as Record<string, unknown>).boxes;
    const result = validateAnnotationBoxes(
      raw,
      { startMs: task.startMs, endMs: task.endMs },
      { preLabelModelVersionId: task.preLabelModelVersionId }
    );
    if (result.problems.length) {
      throw new BadRequestException({
        statusCode: 400,
        error: "InvalidBoxes",
        message: `${result.problems.length} problem(s) with the submitted boxes.`,
        problems: result.problems.slice(0, 20),
        remediation:
          "Every box needs an integer sourceTimeMs inside the task's window, a contract class, " +
          "normalised geometry inside [0, 1], and may credit only the model that pre-labelled this task.",
      });
    }
  }

  /** The labels themselves, verified against the checksum recorded at submission. */
  async readSubmission(versionId: string) {
    const version = await this.prisma.visionAnnotationVersion.findUnique({
      where: { id: versionId },
      select: { id: true, payloadKey: true, payloadChecksum: true, taskId: true },
    });
    if (!version) throw notFound("annotation version", versionId);

    const raw = await this.store.getSmallObject("derived", version.payloadKey);
    if (!raw) {
      throw refusal(404, "LabelsMissing", `The labels for ${versionId} are missing from storage. The row survives so the gap is visible rather than silent.`, "The labels cannot be recovered from here. Have the window annotated again.");
    }
    const actual = createHash("sha256").update(raw).digest("hex");
    if (actual !== version.payloadChecksum) {
      throw new ConflictException({
        statusCode: 409,
        error: "PayloadChecksumMismatch",
        message: "The stored labels do not match the checksum recorded when they were submitted.",
        remediation: "Do not train on this version. Investigate the object store.",
      });
    }
    return { version, payload: JSON.parse(raw.toString("utf8")) as unknown };
  }

  // ── Review ───────────────────────────────────────────────────────────────

  /**
   * Record a verdict. Append-only, and never by the person who did the work.
   *
   * Self-approval is refused for the same reason the model registry separates
   * training from promotion: a second pair of eyes is the entire control, and an
   * annotator under deadline pressure approving their own batch removes it while
   * leaving every dashboard looking green.
   */
  async review(
    annotationVersionId: string,
    dto: { decision: ReviewDecision; rejectionReason?: RejectionReason; notes?: string },
    actor?: AdminAuthContext
  ) {
    const decisionKind = assertOneOf(dto.decision, REVIEW_DECISIONS, "decision");
    if (dto.rejectionReason !== undefined) {
      assertOneOf(dto.rejectionReason, REJECTION_REASONS, "rejectionReason");
    }

    const version = await this.prisma.visionAnnotationVersion.findUnique({
      where: { id: annotationVersionId },
      select: { id: true, annotatorId: true, taskId: true },
    });
    if (!version) throw notFound("annotation version", annotationVersionId);

    const reviewerId = actor?.userId ?? null;

    /**
     * Self-review is detectable only between identified users, and that is the whole
     * of where annotators live: `api_key` auth is a single shared full-access
     * credential with no user id, held by operators rather than by the people doing
     * the labelling.
     *
     * So rather than pretend the control covers a case it cannot see, an
     * unattributable verdict is recorded as one. "Who approved this?" has to be
     * answerable, and a silent null in the actor column answers it with nothing.
     */
    const unattributed = !reviewerId;
    if (reviewerId && version.annotatorId && reviewerId === version.annotatorId) {
      throw new ForbiddenException({
        statusCode: 403,
        error: "SelfReviewRefused",
        message: "You cannot review your own annotation.",
        remediation: "Ask another reviewer. A second pair of eyes is the whole control.",
      });
    }

    if (REASON_REQUIRED_REVIEW_DECISIONS.includes(decisionKind) && !dto.rejectionReason) {
      throw refusal(400, "ReviewReasonRequired", `A "${dto.decision}" verdict needs a structured reason: these drive which windows are sampled next, and free text cannot be counted.`, "Give one of the listed reasons with the verdict.");
    }

    const decision = await this.prisma.visionReviewDecision.create({
      data: {
        annotationVersionId,
        targetKind: "vision_annotation_version",
        targetId: annotationVersionId,
        decision: dto.decision,
        rejectionReason: dto.rejectionReason ?? null,
        reviewerId,
        notes: dto.notes ?? null,
      },
    });

    // The verdict moves the task; the decision row itself is never revised.
    const nextState: AnnotationTaskState =
      dto.decision === "rejected" ? "rejected" : "approved";
    await this.prisma.visionAnnotationTask.update({
      where: { id: version.taskId },
      data: { state: nextState },
    });

    // A rejection is a signal about the footage, not just about the annotator, so it
    // feeds the queue that decides what gets looked at next.
    if (dto.decision === "rejected" && dto.rejectionReason) {
      await this.enqueueFromRejection(version.taskId, dto.rejectionReason);
    }

    await this.audit.record(
      {
        action: dto.decision === "approved" ? "annotation.approved" : "annotation.reviewed",
        targetKind: "vision_annotation_version",
        targetId: annotationVersionId,
        data: {
          decision: dto.decision,
          rejectionReason: dto.rejectionReason ?? null,
          // Visible rather than implied: this verdict has no human behind it, so the
          // second-pair-of-eyes control could not have been applied to it.
          unattributed,
          actorMethod: actor?.method ?? null,
        },
      },
      actor
    );
    return decision;
  }

  // ── Active learning ──────────────────────────────────────────────────────

  /**
   * Queue a window because something about it is not routine.
   *
   * This is the loop that stops the corpus filling up with easy midfield frames:
   * what the model got wrong, or was unsure about, comes back to a human.
   */
  async enqueue(
    dto: { videoAssetId: string; startMs: number; endMs: number; reason: string; score: number },
    actor?: AdminAuthContext
  ) {
    assertOneOf(dto.reason, ACTIVE_LEARNING_REASONS, "reason");
    if (dto.endMs <= dto.startMs) {
      throw refusal(400, "WindowEndsBeforeStart", "A queued window must end after it starts", "Make endMs greater than startMs.");
    }
    if (!(dto.score >= 0 && dto.score <= 1)) {
      throw refusal(400, "ScoreOutOfRange", "score must be between 0 and 1", "Send a score from 0 to 1.");
    }
    // Rights again, at this door too: the queue is a list of footage humans will be
    // shown, so it must not contain anything they may not see.
    const decision = await this.rights.canAnalyze({ videoAssetId: dto.videoAssetId });
    if (!decision.allowed) {
      throw new ForbiddenException({
        statusCode: 403,
        error: "RightsDenied",
        message: "This footage may not be analysed, so it may not be queued for a human.",
        reason: decision.reason,
        remediation: decision.remediation,
      });
    }

    return this.prisma.visionActiveLearningItem.create({
      data: {
        videoAssetId: dto.videoAssetId,
        startMs: dto.startMs,
        endMs: dto.endMs,
        reason: dto.reason,
        score: dto.score,
        state: "queued",
      },
    });
  }

  /**
   * Queue the frames a hard_frames job picked, each as a one-frame window that remembers the
   * job and the detector, so the task made from it opens with the detector's boxes. A
   * deliberate step: picking is the machine's, putting frames in front of people is not.
   * Queueing the same job twice adds nothing (docs/vision/99).
   */
  async queueHardFrames(jobId: string, actor?: AdminAuthContext) {
    const { job, artifact, frames, frameDurationMs } = await readHardFrames(this.prisma, this.store, jobId);
    const videoAssetId = job.videoAssetId!;
    const decision = await this.rights.canAnalyze({ videoAssetId });
    if (!decision.allowed) {
      throw new ForbiddenException({ statusCode: 403, error: "RightsDenied", message: "This footage may not be analysed, so it may not be queued for a human.", reason: decision.reason, remediation: decision.remediation });
    }
    const asset = await this.prisma.visionVideoAsset.findUnique({ where: { id: videoAssetId }, select: { sbMatchId: true } });
    const reserved = await this.prisma.visionEventGoldSet.findFirst({
      where: { OR: [{ videoAssetId }, ...(asset?.sbMatchId ? [{ videoAsset: { sbMatchId: asset.sbMatchId } }] : [])] }, select: { label: true },
    });
    if (reserved) throw refusal(409, "FootageHeldOut", `This match is held out as the answer key "${reserved.label}", so its frames are not labelled for training.`, "Queue frames from training footage: another match.");
    const already = await this.prisma.visionActiveLearningItem.count({ where: { sourceJobId: jobId } });
    if (already) return { jobId, queued: 0, alreadyQueued: already };
    // A second run over the same footage and detect run picks the same frames again, so
    // queueing it would put every one of them in front of people twice (docs/vision/100).
    const twin = (await this.queuedHardFrameRuns([videoAssetId])).find((r) => r.detectJobId === artifact.detectJobId);
    if (twin) {
      throw refusal(409, "HardFramesAlreadyQueued",
        `Frames from hard_frames run ${twin.jobId.slice(0, 8)} over this footage and detect run are already queued, so this run's would be shown to people a second time.`,
        "Label the frames already queued. Queue frames from another clip, or from a new detect run over this one.",
        { queuedJobId: twin.jobId });
    }
    await this.prisma.visionActiveLearningItem.createMany({
      data: frames.map((f) => ({ videoAssetId, startMs: f.sourceTimeMs, endMs: f.sourceTimeMs + frameDurationMs, reason: f.reason, score: f.score,
        state: "queued", sourceJobId: jobId, preLabelModelVersionId: artifact.detectorVersionId })),
    });
    await this.audit.record({ action: "annotation.queue.hard_frames", targetKind: "vision_job", targetId: jobId,
      data: { videoAssetId, frames: frames.length, detectorVersionId: artifact.detectorVersionId } }, actor);
    return { jobId, queued: frames.length, alreadyQueued: 0 };
  }

  /**
   * A task's pre-labels: the detector's boxes on the frames inside its window, each marked
   * with the model that drew it. None for a task that did not come from hard_frames.
   */
  async preLabels(taskId: string) {
    const task = await this.prisma.visionAnnotationTask.findUnique({ where: { id: taskId }, select: { startMs: true, endMs: true, preLabelJobId: true, preLabelModelVersionId: true } });
    if (!task) throw notFound("annotation task", taskId);
    if (!task.preLabelJobId || !task.preLabelModelVersionId) return { taskId, boxes: [] };
    const { frames } = await readHardFrames(this.prisma, this.store, task.preLabelJobId);
    const boxes = frames.filter((f) => f.sourceTimeMs >= task.startMs && f.sourceTimeMs < task.endMs)
      .flatMap((f) => f.boxes.map((b) => ({ sourceTimeMs: f.sourceTimeMs, class: b.class, x: b.x, y: b.y, width: b.width, height: b.height, fromModelVersionId: task.preLabelModelVersionId })));
    return { taskId, boxes };
  }

  /**
   * Succeeded hard_frames runs, newest first, with how many frames each has already queued
   * and, for one that has none, the run over the same footage and detect run that has
   * (`alreadyQueuedAs`): that run's frames are these frames, so this one is not queued.
   */
  async hardFrameRuns(limit = 20) {
    const jobs = await this.prisma.visionJob.findMany({ where: { type: "hard_frames", state: "succeeded" }, orderBy: { finishedAt: "desc" }, take: Math.min(Math.max(limit, 1), 100),
      select: { id: true, videoAssetId: true, finishedAt: true, progress: true } });
    const queuedRuns = await this.queuedHardFrameRuns([...new Set(jobs.flatMap((j) => (j.videoAssetId ? [j.videoAssetId] : [])))]);
    const byJob = new Map(queuedRuns.map((q) => [q.jobId, q.queued]));
    return { runs: jobs.map((j) => {
      const s = summaryOf(j.progress);
      const queued = byJob.get(j.id) ?? 0;
      const twin = queued ? undefined : queuedRuns.find((q) => q.videoAssetId === j.videoAssetId && q.detectJobId !== null && q.detectJobId === s.detectJobId);
      return { jobId: j.id, videoAssetId: j.videoAssetId, finishedAt: j.finishedAt, frames: typeof s.frames === "number" ? s.frames : null, causes: s.causes ?? null, queued,
        alreadyQueuedAs: twin?.jobId ?? null };
    }) };
  }

  /**
   * Submitted work waiting for a second person, oldest submission first. Work whose latest
   * attempt is the caller's own is counted but not listed: they may not review it.
   */
  async reviewQueue(actor?: AdminAuthContext, limit = 50) {
    const take = Math.min(Math.max(Number.isFinite(limit) ? limit : 50, 1), 200);
    const tasks = await this.prisma.visionAnnotationTask.findMany({
      where: { state: "submitted" },
      orderBy: { updatedAt: "asc" },
      select: { id: true, videoAssetId: true, startMs: true, endMs: true, samplingStrategy: true, preLabelled: true, updatedAt: true,
        videoAsset: { select: { sourceVideoRecord: { select: { title: true } } } },
        versions: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, annotatorId: true, createdAt: true } } },
    });
    const userId = actor?.userId ?? null;
    const own = tasks.filter((t) => userId && t.versions[0]?.annotatorId === userId);
    const others = tasks.filter((t) => !own.includes(t)).slice(0, take);
    const annotatorIds = [...new Set(others.flatMap((t) => (t.versions[0]?.annotatorId ? [t.versions[0].annotatorId] : [])))];
    const people = annotatorIds.length ? await this.prisma.adminUser.findMany({ where: { id: { in: annotatorIds } }, select: { id: true, name: true, email: true } }) : [];
    const who = new Map(people.map((p) => [p.id, p.name || p.email]));
    return {
      waiting: tasks.length - own.length,
      yours: own.length,
      tasks: others.map((t) => ({
        taskId: t.id, videoAssetId: t.videoAssetId, source: t.videoAsset.sourceVideoRecord?.title ?? null,
        startMs: t.startMs, endMs: t.endMs, samplingStrategy: t.samplingStrategy, preLabelled: t.preLabelled,
        versionId: t.versions[0]?.id ?? null, submittedAt: t.versions[0]?.createdAt ?? t.updatedAt,
        annotator: t.versions[0]?.annotatorId ? (who.get(t.versions[0].annotatorId) ?? t.versions[0].annotatorId) : null,
      })),
    };
  }

  /**
   * Each labeller's output, pace and how often their work came back.
   *
   * What a team of labellers is run on: who is fast, who is careful, and whether pace
   * improves after the first hour. Minutes are medians, because one frame left open over
   * lunch would drag an average for a week. The recent median covers the latest 20
   * attempts, so a learning curve shows.
   */
  async labellerProgress() {
    const [versions, held] = await Promise.all([
      this.prisma.visionAnnotationVersion.findMany({
        // An abandoned window's work was thrown away, so it is nobody's output.
        where: { annotatorId: { not: null }, task: { state: { not: "abandoned" } } },
        orderBy: { createdAt: "desc" },
        select: { annotatorId: true, effortMinutes: true, createdAt: true, taskId: true, reviews: { select: { decision: true } } },
      }),
      // Claimed and not yet submitted, or sent back and waiting for them to fix it.
      this.prisma.visionAnnotationTask.groupBy({ by: ["assignedTo", "state"], where: { assignedTo: { not: null }, state: { in: ["assigned", "rejected"] } }, _count: { _all: true } }),
    ]);
    const taskIds = [...new Set(versions.map((v) => v.taskId))];
    const tasks = taskIds.length
      ? await this.prisma.visionAnnotationTask.findMany({ where: { id: { in: taskIds } },
          select: { id: true, state: true, versions: { orderBy: { createdAt: "desc" }, take: 1, select: { annotatorId: true } } } })
      : [];

    type Row = { attempts: number; frames: Set<string>; approved: number; awaitingReview: number; sentBack: number; claimed: number; toFix: number; minutes: number[]; lastSubmittedAt: Date | null };
    const rows = new Map<string, Row>();
    const row = (id: string) => {
      let r = rows.get(id);
      if (!r) rows.set(id, (r = { attempts: 0, frames: new Set(), approved: 0, awaitingReview: 0, sentBack: 0, claimed: 0, toFix: 0, minutes: [], lastSubmittedAt: null }));
      return r;
    };
    for (const v of versions) {
      const r = row(v.annotatorId!);
      r.attempts += 1;
      r.frames.add(v.taskId);
      r.sentBack += v.reviews.filter((x) => x.decision === "rejected").length;
      if (v.effortMinutes !== null) r.minutes.push(v.effortMinutes);
      if (!r.lastSubmittedAt || v.createdAt > r.lastSubmittedAt) r.lastSubmittedAt = v.createdAt;
    }
    // A frame counts for whoever made its latest attempt: a correction by someone else is theirs.
    for (const t of tasks) {
      const by = t.versions[0]?.annotatorId;
      if (!by) continue;
      if (t.state === "approved") row(by).approved += 1;
      if (t.state === "submitted") row(by).awaitingReview += 1;
    }
    for (const h of held) {
      if (h.state === "assigned") row(h.assignedTo!).claimed += h._count._all;
      else row(h.assignedTo!).toFix += h._count._all;
    }

    const people = rows.size ? await this.prisma.adminUser.findMany({ where: { id: { in: [...rows.keys()] } }, select: { id: true, name: true, email: true } }) : [];
    const who = new Map(people.map((p) => [p.id, p.name || p.email]));
    return {
      labellers: [...rows.entries()]
        .map(([id, r]) => ({
          annotatorId: id,
          name: who.get(id) ?? `Removed account (${id.slice(0, 8)})`,
          frames: r.frames.size,
          attempts: r.attempts,
          approved: r.approved,
          awaitingReview: r.awaitingReview,
          sentBack: r.sentBack,
          claimed: r.claimed,
          toFix: r.toFix,
          // versions are newest first, so the first 20 timed attempts are the latest.
          medianMinutes: median(r.minutes),
          recentMedianMinutes: median(r.minutes.slice(0, 20)),
          lastSubmittedAt: r.lastSubmittedAt,
        }))
        .sort((a, b) => b.frames - a.frames || a.name.localeCompare(b.name)),
    };
  }

  /** The hard_frames runs over this footage whose frames are queued (in any state), with the detect run each picked from. */
  private async queuedHardFrameRuns(videoAssetIds: string[]) {
    if (videoAssetIds.length === 0) return [];
    const queued = await this.prisma.visionActiveLearningItem.groupBy({ by: ["sourceJobId"], where: { videoAssetId: { in: videoAssetIds }, sourceJobId: { not: null } }, _count: { _all: true } });
    const counts = new Map(queued.map((q) => [q.sourceJobId!, q._count._all]));
    const jobs = await this.prisma.visionJob.findMany({ where: { id: { in: [...counts.keys()] }, type: "hard_frames" }, orderBy: { finishedAt: "asc" },
      select: { id: true, videoAssetId: true, progress: true } });
    return jobs.map((j) => {
      const detectJobId = summaryOf(j.progress).detectJobId;
      return { jobId: j.id, videoAssetId: j.videoAssetId, detectJobId: typeof detectJobId === "string" ? detectJobId : null, queued: counts.get(j.id) ?? 0 };
    });
  }

  /** Highest-scoring queued windows first. */
  async listQueue(limit = 50) {
    return {
      items: await this.prisma.visionActiveLearningItem.findMany({
        where: { state: "queued" },
        orderBy: [{ score: "desc" }, { createdAt: "asc" }],
        take: Math.min(Math.max(limit, 1), 200),
      }),
    };
  }

  /**
   * Turn a queued window into real annotation work.
   *
   * The item is marked converted rather than deleted, so the queue keeps a record
   * of what was acted on and what was merely noticed.
   */
  async convertQueueItem(
    itemId: string,
    dto: { labelSchemaVersionId: string; assignedTo?: string },
    actor?: AdminAuthContext
  ) {
    const item = await this.prisma.visionActiveLearningItem.findUnique({ where: { id: itemId } });
    if (!item) throw notFound("queue item", itemId);
    if (item.state !== "queued") {
      throw refusal(409, "QueueItemDecided", `This item is already ${item.state}.`, "Nothing to do: the item has left the queue.");
    }

    const task = await this.createTask(
      {
        videoAssetId: item.videoAssetId,
        labelSchemaVersionId: dto.labelSchemaVersionId,
        // The queue's reason IS the sampling strategy. Recording "uniform_random"
        // here would erase the fact that this window was deliberately chosen.
        samplingStrategy: item.reason as SamplingStrategy,
        startMs: item.startMs,
        endMs: item.endMs,
        assignedTo: dto.assignedTo,
        // A window hard_frames picked carries the detector's boxes: the task opens on them,
        // marked as a model's (docs/vision/99).
        ...(item.sourceJobId && item.preLabelModelVersionId ? { preLabelJobId: item.sourceJobId, preLabelModelVersionId: item.preLabelModelVersionId } : {}),
      },
      actor
    );

    await this.prisma.visionActiveLearningItem.update({
      where: { id: itemId },
      data: { state: "converted" },
    });
    return { task, item: itemId };
  }

  /**
   * The mix report.
   *
   * The number this module exists to keep honest: what fraction of DTP's labels
   * came from hard cases rather than from whatever was easy to sample. A corpus
   * that is 95% uniform random looks productive and teaches little.
   */
  async mixReport() {
    const byStrategy = await this.prisma.visionAnnotationTask.groupBy({
      by: ["samplingStrategy"],
      _count: { _all: true },
    });
    const byState = await this.prisma.visionAnnotationTask.groupBy({
      by: ["state"],
      _count: { _all: true },
    });
    const reviews = await this.prisma.visionReviewDecision.groupBy({
      by: ["decision"],
      _count: { _all: true },
    });
    const rejections = await this.prisma.visionReviewDecision.groupBy({
      by: ["rejectionReason"],
      where: { rejectionReason: { not: null } },
      _count: { _all: true },
    });
    const effort = await this.prisma.visionAnnotationVersion.aggregate({
      _avg: { effortMinutes: true },
      _sum: { effortMinutes: true },
      _count: { _all: true },
    });

    /** groupBy rows to a plain count map, typed so the arithmetic below is real. */
    const tally = <K extends string>(
      rows: ({ _count: { _all: number } } & Partial<Record<K, string | null>>)[],
      key: K
    ): Record<string, number> =>
      Object.fromEntries(rows.map((r) => [r[key] ?? "unknown", r._count._all]));

    const strategies = tally(byStrategy, "samplingStrategy");
    const total = Object.values(strategies).reduce((a, b) => a + b, 0);
    const random = strategies.uniform_random ?? 0;

    return {
      tasks: total,
      bySamplingStrategy: strategies,
      /** The headline: everything that was not the control group. */
      hardCaseShare: total ? Number(((total - random) / total).toFixed(3)) : null,
      byState: tally(byState, "state"),
      reviewDecisions: tally(reviews, "decision"),
      rejectionReasons: tally(rejections, "rejectionReason"),
      effort: {
        submissions: effort._count._all,
        averageMinutes: effort._avg.effortMinutes,
        totalMinutes: effort._sum.effortMinutes,
      },
    };
  }

  private async enqueueFromRejection(taskId: string, reason: RejectionReason) {
    const task = await this.prisma.visionAnnotationTask.findUnique({
      where: { id: taskId },
      select: { videoAssetId: true, startMs: true, endMs: true },
    });
    if (!task) return;

    // A rights failure spotted during review is not a sampling signal — it is a
    // governance problem, and re-queueing the footage would be exactly wrong.
    if (reason === "rights_issue") return;

    await this.prisma.visionActiveLearningItem.create({
      data: {
        videoAssetId: task.videoAssetId,
        startMs: task.startMs,
        endMs: task.endMs,
        reason: "reviewer_disagreement",
        score: 0.9,
        state: "queued",
      },
    });
  }

  private async requireTask(id: string) {
    const task = await this.prisma.visionAnnotationTask.findUnique({ where: { id } });
    if (!task) throw notFound("annotation task", id);
    if (!ANNOTATION_TASK_STATES.includes(task.state as AnnotationTaskState)) {
      throw refusal(409, "TaskStateUnrecognised", `Task ${id} is in an unrecognised state "${task.state}".`, "The row was written outside the service. Check it by hand before acting on it.");
    }
    return task;
  }
}
