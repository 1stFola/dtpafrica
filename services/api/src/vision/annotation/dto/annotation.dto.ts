import {
  IsIn, IsInt, IsISO8601, IsNumber, IsObject, IsOptional, IsString,
  IsUUID, Max, MaxLength, Min, MinLength,
} from "class-validator";
import {
  ACTIVE_LEARNING_REASONS,
  ANNOTATION_TASK_STATES,
  REJECTION_REASONS,
  REVIEW_DECISIONS,
  SAMPLING_STRATEGIES,
} from "@dtp/vision-contracts";

export class CreateLabelSchemaDto {
  /** Free-form but short, e.g. "2026.1" or "events-v3". Unique, and never reused. */
  @IsString() @MinLength(1) @MaxLength(40) version!: string;
  /** Classes, event taxonomy, required attributes. Shape is the taxonomy's business. */
  @IsObject() definitions!: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(512) handbookKey?: string;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;
  @IsOptional() @IsISO8601() effectiveFrom?: string;
}

export class CreateTaskDto {
  @IsUUID() videoAssetId!: string;
  @IsUUID() labelSchemaVersionId!: string;

  /**
   * Required, with no default. A default would be `uniform_random`, and silently
   * recording the control group for a window somebody chose deliberately is exactly
   * the drift that makes the mix report meaningless.
   */
  @IsIn(SAMPLING_STRATEGIES as unknown as string[])
  samplingStrategy!: (typeof SAMPLING_STRATEGIES)[number];

  @IsInt() @Min(0) startMs!: number;
  @IsInt() @Min(1) endMs!: number;
  @IsOptional() @IsString() @MaxLength(64) assignedTo?: string;
  /** Present when a model produced the starting labels; the task is then marked pre-labelled. */
  @IsOptional() @IsUUID() preLabelModelVersionId?: string;
}

export class ClaimTaskDto {
  @IsString() @MinLength(1) @MaxLength(64) annotatorId!: string;
  @IsOptional() @IsIn(SAMPLING_STRATEGIES as unknown as string[]) samplingStrategy?: string;
}

export class SubmitAnnotationDto {
  /** The labels. Validated against the schema by the annotation tool, not here. */
  @IsObject() payload!: Record<string, unknown>;
  /**
   * Minutes spent. Not required, but the metric that answers whether a
   * pre-labelling model actually saves anyone time — 5% more accurate while
   * doubling correction time is a worse model for DTP.
   */
  @IsOptional() @IsNumber() @Min(0) @Max(480) effortMinutes?: number;
  @IsOptional() @IsString() @MaxLength(64) annotatorId?: string;
}

export class ReviewDto {
  @IsIn(REVIEW_DECISIONS as unknown as string[])
  decision!: (typeof REVIEW_DECISIONS)[number];

  /** Required for "corrected" and "rejected" — the service enforces which. */
  @IsOptional() @IsIn(REJECTION_REASONS as unknown as string[])
  rejectionReason?: (typeof REJECTION_REASONS)[number];

  @IsOptional() @IsString() @MaxLength(4000) notes?: string;
}

export class EnqueueDto {
  @IsUUID() videoAssetId!: string;
  @IsInt() @Min(0) startMs!: number;
  @IsInt() @Min(1) endMs!: number;

  /**
   * No `uniform_random` here, deliberately: an active-learning item exists because
   * something about it is *not* routine, so the control group would be a
   * contradiction.
   */
  @IsIn(ACTIVE_LEARNING_REASONS as unknown as string[]) reason!: string;

  @IsNumber() @Min(0) @Max(1) score!: number;
}

export class ConvertQueueItemDto {
  @IsUUID() labelSchemaVersionId!: string;
  @IsOptional() @IsString() @MaxLength(64) assignedTo?: string;
}

export class AbandonTaskDto {
  @IsString() @MinLength(3) @MaxLength(2000) reason!: string;
}

export class TaskListFiltersDto {
  @IsOptional() @IsIn(ANNOTATION_TASK_STATES as unknown as string[]) state?: string;
  @IsOptional() @IsIn(SAMPLING_STRATEGIES as unknown as string[]) samplingStrategy?: string;
  @IsOptional() @IsString() @MaxLength(64) assignedTo?: string;
}
