-- AlterTable
ALTER TABLE "vision_dataset_versions" ADD COLUMN     "label_schema_version_id" TEXT,
ADD COLUMN     "leakage_report" JSONB,
ADD COLUMN     "representation_report" JSONB;

-- AlterTable
ALTER TABLE "vision_dataset_members" ADD COLUMN     "group_key" TEXT NOT NULL,
ADD COLUMN     "sb_match_id" TEXT;

-- CreateTable
CREATE TABLE "vision_label_schema_versions" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "definitions" JSONB NOT NULL,
    "handbook_key" TEXT,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "superseded_at" TIMESTAMP(3),
    "authored_by" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vision_label_schema_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vision_annotation_tasks" (
    "id" TEXT NOT NULL,
    "video_asset_id" TEXT NOT NULL,
    "label_schema_version_id" TEXT NOT NULL,
    "sampling_strategy" TEXT NOT NULL,
    "start_ms" INTEGER NOT NULL,
    "end_ms" INTEGER NOT NULL,
    "assigned_to" TEXT,
    "state" TEXT NOT NULL,
    "external_task_ref" TEXT,
    "pre_labelled" BOOLEAN NOT NULL DEFAULT false,
    "pre_label_model_version_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vision_annotation_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vision_annotation_versions" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "payload_key" TEXT NOT NULL,
    "payload_checksum" TEXT NOT NULL,
    "annotator_id" TEXT,
    "supersedes_id" TEXT,
    "effort_minutes" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vision_annotation_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vision_review_decisions" (
    "id" TEXT NOT NULL,
    "annotation_version_id" TEXT,
    "target_kind" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "rejection_reason" TEXT,
    "reviewer_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vision_review_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vision_active_learning_items" (
    "id" TEXT NOT NULL,
    "video_asset_id" TEXT NOT NULL,
    "start_ms" INTEGER NOT NULL,
    "end_ms" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'queued',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vision_active_learning_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vision_label_schema_versions_version_key" ON "vision_label_schema_versions"("version");

-- CreateIndex
CREATE INDEX "vision_annotation_tasks_video_asset_id_state_idx" ON "vision_annotation_tasks"("video_asset_id", "state");

-- CreateIndex
CREATE INDEX "vision_annotation_tasks_assigned_to_state_idx" ON "vision_annotation_tasks"("assigned_to", "state");

-- CreateIndex
CREATE INDEX "vision_annotation_tasks_sampling_strategy_idx" ON "vision_annotation_tasks"("sampling_strategy");

-- CreateIndex
CREATE UNIQUE INDEX "vision_annotation_versions_supersedes_id_key" ON "vision_annotation_versions"("supersedes_id");

-- CreateIndex
CREATE INDEX "vision_annotation_versions_task_id_created_at_idx" ON "vision_annotation_versions"("task_id", "created_at");

-- CreateIndex
CREATE INDEX "vision_review_decisions_target_kind_target_id_idx" ON "vision_review_decisions"("target_kind", "target_id");

-- CreateIndex
CREATE INDEX "vision_review_decisions_reviewer_id_created_at_idx" ON "vision_review_decisions"("reviewer_id", "created_at");

-- CreateIndex
CREATE INDEX "vision_active_learning_items_state_score_idx" ON "vision_active_learning_items"("state", "score");

-- CreateIndex
CREATE INDEX "vision_dataset_members_dataset_version_id_group_key_idx" ON "vision_dataset_members"("dataset_version_id", "group_key");

-- AddForeignKey
ALTER TABLE "vision_dataset_versions" ADD CONSTRAINT "vision_dataset_versions_label_schema_version_id_fkey" FOREIGN KEY ("label_schema_version_id") REFERENCES "vision_label_schema_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_annotation_tasks" ADD CONSTRAINT "vision_annotation_tasks_video_asset_id_fkey" FOREIGN KEY ("video_asset_id") REFERENCES "vision_video_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_annotation_tasks" ADD CONSTRAINT "vision_annotation_tasks_label_schema_version_id_fkey" FOREIGN KEY ("label_schema_version_id") REFERENCES "vision_label_schema_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_annotation_versions" ADD CONSTRAINT "vision_annotation_versions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "vision_annotation_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_annotation_versions" ADD CONSTRAINT "vision_annotation_versions_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "vision_annotation_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_review_decisions" ADD CONSTRAINT "vision_review_decisions_annotation_version_id_fkey" FOREIGN KEY ("annotation_version_id") REFERENCES "vision_annotation_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_active_learning_items" ADD CONSTRAINT "vision_active_learning_items_video_asset_id_fkey" FOREIGN KEY ("video_asset_id") REFERENCES "vision_video_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

