-- CreateTable
CREATE TABLE "vision_source_partners" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "academy_id" TEXT,
    "contact_name" TEXT,
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vision_source_partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vision_source_channels" (
    "id" TEXT NOT NULL,
    "partner_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "external_id" TEXT,
    "url" TEXT,
    "title" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vision_source_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vision_partner_authorized_signatories" (
    "id" TEXT NOT NULL,
    "partner_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "authority_evidence_id" TEXT,
    "active_from" TIMESTAMP(3) NOT NULL,
    "active_to" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vision_partner_authorized_signatories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vision_rights_evidence" (
    "id" TEXT NOT NULL,
    "partner_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "document_date" TIMESTAMP(3),
    "uploaded_by" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vision_rights_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vision_rights_scopes" (
    "id" TEXT NOT NULL,
    "partner_id" TEXT,
    "source_video_record_id" TEXT,
    "player_id" TEXT,
    "grant_level" TEXT NOT NULL,
    "can_analyze" BOOLEAN NOT NULL DEFAULT false,
    "can_train" BOOLEAN NOT NULL DEFAULT false,
    "can_publish_highlight" BOOLEAN NOT NULL DEFAULT false,
    "can_share_with_scout" BOOLEAN NOT NULL DEFAULT false,
    "granted_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" TEXT,
    "revoked_by" TEXT,
    "restrictions" JSONB,
    "evidence_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vision_rights_scopes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vision_source_video_records" (
    "id" TEXT NOT NULL,
    "partner_id" TEXT NOT NULL,
    "channel_id" TEXT,
    "external_video_id" TEXT,
    "url" TEXT,
    "title" TEXT,
    "published_at" TIMESTAMP(3),
    "duration_seconds" INTEGER,
    "sb_match_id" TEXT,
    "sb_competition_id" TEXT,
    "rights_owner_name" TEXT,
    "source_quality_rank" TEXT NOT NULL,
    "original_available" BOOLEAN NOT NULL DEFAULT false,
    "acquisition_status" TEXT NOT NULL,
    "acquisition_method" TEXT,
    "acquisition_authorized_by_signatory_id" TEXT,
    "acquisition_authorized_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vision_source_video_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vision_partner_upload_grants" (
    "id" TEXT NOT NULL,
    "partner_id" TEXT NOT NULL,
    "source_video_record_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "max_bytes" BIGINT NOT NULL,
    "allowed_mime_types" TEXT[],
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vision_partner_upload_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vision_deletion_requests" (
    "id" TEXT NOT NULL,
    "video_asset_id" TEXT,
    "player_id" TEXT,
    "reason" TEXT NOT NULL,
    "requested_by" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "state" TEXT NOT NULL,
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "executed_at" TIMESTAMP(3),
    "outcome_notes" TEXT,

    CONSTRAINT "vision_deletion_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vision_duplicate_clusters" (
    "id" TEXT NOT NULL,
    "representative_asset_id" TEXT,
    "method" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vision_duplicate_clusters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vision_video_assets" (
    "id" TEXT NOT NULL,
    "source_video_record_id" TEXT,
    "sb_match_id" TEXT,
    "corpus" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "bytes" BIGINT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "checksum_sha256" TEXT NOT NULL,
    "perceptual_fingerprint" TEXT,
    "duplicate_cluster_id" TEXT,
    "container" TEXT,
    "video_codec" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "fps_numerator" INTEGER,
    "fps_denominator" INTEGER,
    "is_variable_frame_rate" BOOLEAN NOT NULL DEFAULT false,
    "duration_ms" INTEGER,
    "ingest_state" TEXT NOT NULL,
    "ingest_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vision_video_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vision_video_variants" (
    "id" TEXT NOT NULL,
    "video_asset_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "fps" DOUBLE PRECISION,
    "duration_ms" INTEGER,
    "source_offset_ms" INTEGER NOT NULL DEFAULT 0,
    "settings_hash" TEXT,
    "bytes" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vision_video_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vision_camera_segments" (
    "id" TEXT NOT NULL,
    "video_asset_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "start_ms" INTEGER NOT NULL,
    "end_ms" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vision_camera_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vision_upload_sessions" (
    "id" TEXT NOT NULL,
    "video_asset_id" TEXT,
    "grant_id" TEXT,
    "bucket_id" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "provider_upload_id" TEXT NOT NULL,
    "part_size_bytes" INTEGER NOT NULL,
    "expected_bytes" BIGINT,
    "bytes_received" BIGINT NOT NULL DEFAULT 0,
    "received_parts" JSONB NOT NULL DEFAULT '[]',
    "state" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vision_upload_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vision_jobs" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "resource_class" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "video_asset_id" TEXT,
    "dataset_version_id" TEXT,
    "model_version_id" TEXT,
    "input_spec" JSONB NOT NULL,
    "output_prefix" TEXT NOT NULL,
    "attempt_number" INTEGER NOT NULL DEFAULT 1,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "budget_seconds" INTEGER NOT NULL,
    "budget_usd_cents" INTEGER NOT NULL,
    "queued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "heartbeat_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "worker_id" TEXT,
    "provider_ref" TEXT,
    "provider_id" TEXT,
    "progress" JSONB,
    "error" JSONB,
    "idempotency_key" TEXT,
    "contract_version" TEXT NOT NULL,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vision_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vision_job_events" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "stage" TEXT,
    "message" TEXT,
    "data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vision_job_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vision_job_costs" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "gpu_seconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cpu_seconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "wall_clock_seconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bytes_read" BIGINT NOT NULL DEFAULT 0,
    "bytes_written" BIGINT NOT NULL DEFAULT 0,
    "class_a_operations" INTEGER NOT NULL DEFAULT 0,
    "class_b_operations" INTEGER NOT NULL DEFAULT 0,
    "third_party_api_cost_cents" INTEGER NOT NULL DEFAULT 0,
    "estimated_usd_cents" INTEGER NOT NULL DEFAULT 0,
    "from_configured_rate" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vision_job_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vision_workers" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "provider_ref" TEXT,
    "resource_class" TEXT NOT NULL,
    "image" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "token_expires_at" TIMESTAMP(3) NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "jobs_completed" INTEGER NOT NULL DEFAULT 0,
    "retired_at" TIMESTAMP(3),

    CONSTRAINT "vision_workers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vision_dataset_versions" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "manifest_key" TEXT,
    "split_policy" JSONB,
    "frozen_at" TIMESTAMP(3),
    "frozen_by" TEXT,
    "contains_revoked_members" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vision_dataset_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vision_dataset_members" (
    "id" TEXT NOT NULL,
    "dataset_version_id" TEXT NOT NULL,
    "video_asset_id" TEXT NOT NULL,
    "checksum_sha256" TEXT NOT NULL,
    "split" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vision_dataset_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vision_models" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vision_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vision_model_versions" (
    "id" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "dataset_version_id" TEXT,
    "git_commit" TEXT,
    "config_key" TEXT,
    "weights_key" TEXT,
    "weights_checksum" TEXT,
    "worker_image" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'candidate',
    "licence_note" TEXT,
    "promoted_by" TEXT,
    "promoted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vision_model_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vision_audit_logs" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target_kind" TEXT NOT NULL,
    "target_id" TEXT,
    "actor_id" TEXT,
    "actor_email" TEXT,
    "actor_method" TEXT,
    "reason" TEXT,
    "data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vision_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vision_source_partners_academy_id_idx" ON "vision_source_partners"("academy_id");

-- CreateIndex
CREATE INDEX "vision_source_partners_is_active_idx" ON "vision_source_partners"("is_active");

-- CreateIndex
CREATE INDEX "vision_source_channels_partner_id_idx" ON "vision_source_channels"("partner_id");

-- CreateIndex
CREATE UNIQUE INDEX "vision_source_channels_platform_external_id_key" ON "vision_source_channels"("platform", "external_id");

-- CreateIndex
CREATE INDEX "vision_partner_authorized_signatories_partner_id_active_fro_idx" ON "vision_partner_authorized_signatories"("partner_id", "active_from");

-- CreateIndex
CREATE INDEX "vision_rights_evidence_partner_id_kind_idx" ON "vision_rights_evidence"("partner_id", "kind");

-- CreateIndex
CREATE INDEX "vision_rights_scopes_partner_id_revoked_at_idx" ON "vision_rights_scopes"("partner_id", "revoked_at");

-- CreateIndex
CREATE INDEX "vision_rights_scopes_source_video_record_id_revoked_at_idx" ON "vision_rights_scopes"("source_video_record_id", "revoked_at");

-- CreateIndex
CREATE INDEX "vision_rights_scopes_player_id_revoked_at_idx" ON "vision_rights_scopes"("player_id", "revoked_at");

-- CreateIndex
CREATE INDEX "vision_rights_scopes_expires_at_idx" ON "vision_rights_scopes"("expires_at");

-- CreateIndex
CREATE INDEX "vision_source_video_records_partner_id_acquisition_status_idx" ON "vision_source_video_records"("partner_id", "acquisition_status");

-- CreateIndex
CREATE INDEX "vision_source_video_records_sb_match_id_idx" ON "vision_source_video_records"("sb_match_id");

-- CreateIndex
CREATE INDEX "vision_source_video_records_sb_competition_id_idx" ON "vision_source_video_records"("sb_competition_id");

-- CreateIndex
CREATE UNIQUE INDEX "vision_source_video_records_channel_id_external_video_id_key" ON "vision_source_video_records"("channel_id", "external_video_id");

-- CreateIndex
CREATE UNIQUE INDEX "vision_partner_upload_grants_token_hash_key" ON "vision_partner_upload_grants"("token_hash");

-- CreateIndex
CREATE INDEX "vision_partner_upload_grants_partner_id_expires_at_idx" ON "vision_partner_upload_grants"("partner_id", "expires_at");

-- CreateIndex
CREATE INDEX "vision_deletion_requests_state_requested_at_idx" ON "vision_deletion_requests"("state", "requested_at");

-- CreateIndex
CREATE INDEX "vision_deletion_requests_video_asset_id_idx" ON "vision_deletion_requests"("video_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "vision_video_assets_object_key_key" ON "vision_video_assets"("object_key");

-- CreateIndex
CREATE INDEX "vision_video_assets_checksum_sha256_idx" ON "vision_video_assets"("checksum_sha256");

-- CreateIndex
CREATE INDEX "vision_video_assets_perceptual_fingerprint_idx" ON "vision_video_assets"("perceptual_fingerprint");

-- CreateIndex
CREATE INDEX "vision_video_assets_duplicate_cluster_id_idx" ON "vision_video_assets"("duplicate_cluster_id");

-- CreateIndex
CREATE INDEX "vision_video_assets_sb_match_id_idx" ON "vision_video_assets"("sb_match_id");

-- CreateIndex
CREATE INDEX "vision_video_assets_corpus_ingest_state_idx" ON "vision_video_assets"("corpus", "ingest_state");

-- CreateIndex
CREATE INDEX "vision_video_variants_video_asset_id_kind_idx" ON "vision_video_variants"("video_asset_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "vision_video_variants_video_asset_id_kind_object_key_key" ON "vision_video_variants"("video_asset_id", "kind", "object_key");

-- CreateIndex
CREATE INDEX "vision_camera_segments_video_asset_id_start_ms_idx" ON "vision_camera_segments"("video_asset_id", "start_ms");

-- CreateIndex
CREATE INDEX "vision_upload_sessions_state_expires_at_idx" ON "vision_upload_sessions"("state", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "vision_upload_sessions_bucket_id_object_key_provider_upload_key" ON "vision_upload_sessions"("bucket_id", "object_key", "provider_upload_id");

-- CreateIndex
CREATE UNIQUE INDEX "vision_jobs_idempotency_key_key" ON "vision_jobs"("idempotency_key");

-- CreateIndex
CREATE INDEX "vision_jobs_state_resource_class_priority_queued_at_idx" ON "vision_jobs"("state", "resource_class", "priority", "queued_at");

-- CreateIndex
CREATE INDEX "vision_jobs_video_asset_id_type_idx" ON "vision_jobs"("video_asset_id", "type");

-- CreateIndex
CREATE INDEX "vision_jobs_heartbeat_at_idx" ON "vision_jobs"("heartbeat_at");

-- CreateIndex
CREATE INDEX "vision_job_events_job_id_created_at_idx" ON "vision_job_events"("job_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "vision_job_costs_job_id_key" ON "vision_job_costs"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "vision_workers_token_hash_key" ON "vision_workers"("token_hash");

-- CreateIndex
CREATE INDEX "vision_workers_provider_id_resource_class_idx" ON "vision_workers"("provider_id", "resource_class");

-- CreateIndex
CREATE INDEX "vision_workers_last_seen_at_idx" ON "vision_workers"("last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "vision_dataset_versions_label_key" ON "vision_dataset_versions"("label");

-- CreateIndex
CREATE INDEX "vision_dataset_members_dataset_version_id_split_idx" ON "vision_dataset_members"("dataset_version_id", "split");

-- CreateIndex
CREATE UNIQUE INDEX "vision_dataset_members_dataset_version_id_video_asset_id_key" ON "vision_dataset_members"("dataset_version_id", "video_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "vision_models_key_key" ON "vision_models"("key");

-- CreateIndex
CREATE INDEX "vision_model_versions_stage_idx" ON "vision_model_versions"("stage");

-- CreateIndex
CREATE UNIQUE INDEX "vision_model_versions_model_id_version_key" ON "vision_model_versions"("model_id", "version");

-- CreateIndex
CREATE INDEX "vision_audit_logs_action_created_at_idx" ON "vision_audit_logs"("action", "created_at");

-- CreateIndex
CREATE INDEX "vision_audit_logs_target_kind_target_id_idx" ON "vision_audit_logs"("target_kind", "target_id");

-- CreateIndex
CREATE INDEX "vision_audit_logs_actor_id_created_at_idx" ON "vision_audit_logs"("actor_id", "created_at");

-- AddForeignKey
ALTER TABLE "vision_source_partners" ADD CONSTRAINT "vision_source_partners_academy_id_fkey" FOREIGN KEY ("academy_id") REFERENCES "academies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_source_channels" ADD CONSTRAINT "vision_source_channels_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "vision_source_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_partner_authorized_signatories" ADD CONSTRAINT "vision_partner_authorized_signatories_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "vision_source_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_partner_authorized_signatories" ADD CONSTRAINT "vision_partner_authorized_signatories_authority_evidence_i_fkey" FOREIGN KEY ("authority_evidence_id") REFERENCES "vision_rights_evidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_rights_evidence" ADD CONSTRAINT "vision_rights_evidence_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "vision_source_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_rights_scopes" ADD CONSTRAINT "vision_rights_scopes_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "vision_source_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_rights_scopes" ADD CONSTRAINT "vision_rights_scopes_source_video_record_id_fkey" FOREIGN KEY ("source_video_record_id") REFERENCES "vision_source_video_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_rights_scopes" ADD CONSTRAINT "vision_rights_scopes_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_rights_scopes" ADD CONSTRAINT "vision_rights_scopes_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "vision_rights_evidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_source_video_records" ADD CONSTRAINT "vision_source_video_records_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "vision_source_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_source_video_records" ADD CONSTRAINT "vision_source_video_records_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "vision_source_channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_source_video_records" ADD CONSTRAINT "vision_source_video_records_sb_match_id_fkey" FOREIGN KEY ("sb_match_id") REFERENCES "sb_matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_source_video_records" ADD CONSTRAINT "vision_source_video_records_sb_competition_id_fkey" FOREIGN KEY ("sb_competition_id") REFERENCES "sb_competitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_source_video_records" ADD CONSTRAINT "vision_source_video_records_acquisition_authorized_by_sign_fkey" FOREIGN KEY ("acquisition_authorized_by_signatory_id") REFERENCES "vision_partner_authorized_signatories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_partner_upload_grants" ADD CONSTRAINT "vision_partner_upload_grants_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "vision_source_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_partner_upload_grants" ADD CONSTRAINT "vision_partner_upload_grants_source_video_record_id_fkey" FOREIGN KEY ("source_video_record_id") REFERENCES "vision_source_video_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_deletion_requests" ADD CONSTRAINT "vision_deletion_requests_video_asset_id_fkey" FOREIGN KEY ("video_asset_id") REFERENCES "vision_video_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_video_assets" ADD CONSTRAINT "vision_video_assets_source_video_record_id_fkey" FOREIGN KEY ("source_video_record_id") REFERENCES "vision_source_video_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_video_assets" ADD CONSTRAINT "vision_video_assets_sb_match_id_fkey" FOREIGN KEY ("sb_match_id") REFERENCES "sb_matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_video_assets" ADD CONSTRAINT "vision_video_assets_duplicate_cluster_id_fkey" FOREIGN KEY ("duplicate_cluster_id") REFERENCES "vision_duplicate_clusters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_video_variants" ADD CONSTRAINT "vision_video_variants_video_asset_id_fkey" FOREIGN KEY ("video_asset_id") REFERENCES "vision_video_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_camera_segments" ADD CONSTRAINT "vision_camera_segments_video_asset_id_fkey" FOREIGN KEY ("video_asset_id") REFERENCES "vision_video_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_upload_sessions" ADD CONSTRAINT "vision_upload_sessions_video_asset_id_fkey" FOREIGN KEY ("video_asset_id") REFERENCES "vision_video_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_upload_sessions" ADD CONSTRAINT "vision_upload_sessions_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "vision_partner_upload_grants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_jobs" ADD CONSTRAINT "vision_jobs_video_asset_id_fkey" FOREIGN KEY ("video_asset_id") REFERENCES "vision_video_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_jobs" ADD CONSTRAINT "vision_jobs_dataset_version_id_fkey" FOREIGN KEY ("dataset_version_id") REFERENCES "vision_dataset_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_jobs" ADD CONSTRAINT "vision_jobs_model_version_id_fkey" FOREIGN KEY ("model_version_id") REFERENCES "vision_model_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_job_events" ADD CONSTRAINT "vision_job_events_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "vision_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_job_costs" ADD CONSTRAINT "vision_job_costs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "vision_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_dataset_members" ADD CONSTRAINT "vision_dataset_members_dataset_version_id_fkey" FOREIGN KEY ("dataset_version_id") REFERENCES "vision_dataset_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_dataset_members" ADD CONSTRAINT "vision_dataset_members_video_asset_id_fkey" FOREIGN KEY ("video_asset_id") REFERENCES "vision_video_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_model_versions" ADD CONSTRAINT "vision_model_versions_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "vision_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_model_versions" ADD CONSTRAINT "vision_model_versions_dataset_version_id_fkey" FOREIGN KEY ("dataset_version_id") REFERENCES "vision_dataset_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

