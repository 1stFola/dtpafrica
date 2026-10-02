-- The benchmark ledger. A run is the unit of evidence a promotion rests on; its
-- metrics are stored per slice, never only as a headline.

-- CreateTable
CREATE TABLE "vision_benchmark_runs" (
    "id" TEXT NOT NULL,
    "model_version_id" TEXT NOT NULL,
    "dataset_version_id" TEXT NOT NULL,
    "job_id" TEXT,
    "state" TEXT NOT NULL DEFAULT 'queued',
    "thresholds_version" TEXT NOT NULL,
    "iou_threshold" DOUBLE PRECISION NOT NULL,
    "verdict" TEXT,
    "verdict_detail" JSONB,
    "summary" JSONB,
    "report_key" TEXT,
    "requested_by" TEXT,
    "failure_reason" TEXT,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vision_benchmark_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vision_metric_results" (
    "id" TEXT NOT NULL,
    "benchmark_run_id" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "slice" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "support" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vision_metric_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vision_benchmark_runs_model_version_id_created_at_idx" ON "vision_benchmark_runs"("model_version_id", "created_at");

-- CreateIndex
CREATE INDEX "vision_benchmark_runs_dataset_version_id_idx" ON "vision_benchmark_runs"("dataset_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "vision_metric_results_benchmark_run_id_metric_slice_key" ON "vision_metric_results"("benchmark_run_id", "metric", "slice");

-- AddForeignKey
ALTER TABLE "vision_benchmark_runs" ADD CONSTRAINT "vision_benchmark_runs_model_version_id_fkey" FOREIGN KEY ("model_version_id") REFERENCES "vision_model_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_benchmark_runs" ADD CONSTRAINT "vision_benchmark_runs_dataset_version_id_fkey" FOREIGN KEY ("dataset_version_id") REFERENCES "vision_dataset_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_metric_results" ADD CONSTRAINT "vision_metric_results_benchmark_run_id_fkey" FOREIGN KEY ("benchmark_run_id") REFERENCES "vision_benchmark_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
