-- FairPlay Phase 4: the cloud side. Additive only: new fairplay_* tables, their own
-- constraints and insert-only triggers. No existing table or column changes.

-- CreateTable
CREATE TABLE "fairplay_edge_devices" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "edge_device_id" TEXT,
    "token_hash" TEXT NOT NULL,
    "token_kind" TEXT NOT NULL DEFAULT 'bootstrap',
    "token_expires_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" TEXT,
    "created_by_email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "registered_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3),
    "retired_at" TIMESTAMP(3),
    "retired_by_id" TEXT,

    CONSTRAINT "fairplay_edge_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fairplay_sessions" (
    "id" TEXT NOT NULL,
    "match_id" TEXT,
    "competition_id" TEXT NOT NULL,
    "match_snapshot" JSONB NOT NULL,
    "device_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'shadow',
    "angle_mode" TEXT NOT NULL DEFAULT 'single',
    "created_by_id" TEXT,
    "created_by_email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "edge_version" INTEGER,
    "edge_created_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "last_sync_at" TIMESTAMP(3),

    CONSTRAINT "fairplay_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fairplay_session_members" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "admin_user_id" TEXT NOT NULL,
    "permissions" TEXT[],
    "pin_hash" TEXT,
    "pin_set_at" TIMESTAMP(3),
    "added_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fairplay_session_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fairplay_sync_receipts" (
    "id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fairplay_sync_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fairplay_records" (
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "session_id" TEXT,
    "version" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fairplay_records_pkey" PRIMARY KEY ("entity_type","entity_id")
);

-- CreateTable
CREATE TABLE "fairplay_incidents" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "event_utc" TIMESTAMP(3) NOT NULL,
    "period" TEXT,
    "match_minute" INTEGER,
    "match_second" INTEGER,
    "sheet_event_id" TEXT,
    "payload" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fairplay_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fairplay_reviews" (
    "id" TEXT NOT NULL,
    "incident_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "authority_mode" TEXT NOT NULL DEFAULT 'shadow',
    "result" TEXT,
    "reviewer_id" TEXT NOT NULL,
    "reviewer_name" TEXT NOT NULL,
    "completed_at" TIMESTAMP(3),
    "payload" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fairplay_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fairplay_evidence" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "incident_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "footage_kind" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "bytes" BIGINT NOT NULL,
    "manifest_sha256" TEXT NOT NULL,
    "window_start_utc" TIMESTAMP(3) NOT NULL,
    "window_duration_ms" INTEGER NOT NULL,
    "coverage" TEXT NOT NULL,
    "approved_at" TIMESTAMP(3),
    "payload" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fairplay_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fairplay_evidence_objects" (
    "id" TEXT NOT NULL,
    "evidence_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "bytes" BIGINT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "etag" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "presigned_at" TIMESTAMP(3),
    "stored_at" TIMESTAMP(3),
    "delete_after" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "delete_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fairplay_evidence_objects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fairplay_edge_audit_entries" (
    "id" TEXT NOT NULL,
    "edge_device_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "at_utc" TIMESTAMP(3) NOT NULL,
    "actor_id" TEXT NOT NULL,
    "actor_name" TEXT NOT NULL,
    "actor_kind" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "entity_version" INTEGER,
    "detail" JSONB NOT NULL,
    "prev_hash" TEXT NOT NULL,
    "entry_hash" TEXT NOT NULL,
    "chain_status" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fairplay_edge_audit_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fairplay_audit_logs" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target_kind" TEXT NOT NULL,
    "target_id" TEXT,
    "actor_kind" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_email" TEXT,
    "reason" TEXT,
    "data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fairplay_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fairplay_edge_devices_edge_device_id_key" ON "fairplay_edge_devices"("edge_device_id");

-- CreateIndex
CREATE UNIQUE INDEX "fairplay_edge_devices_token_hash_key" ON "fairplay_edge_devices"("token_hash");

-- CreateIndex
CREATE INDEX "fairplay_sessions_match_id_idx" ON "fairplay_sessions"("match_id");

-- CreateIndex
CREATE INDEX "fairplay_sessions_competition_id_created_at_idx" ON "fairplay_sessions"("competition_id", "created_at");

-- CreateIndex
CREATE INDEX "fairplay_sessions_device_id_idx" ON "fairplay_sessions"("device_id");

-- CreateIndex
CREATE INDEX "fairplay_session_members_admin_user_id_idx" ON "fairplay_session_members"("admin_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "fairplay_session_members_session_id_admin_user_id_key" ON "fairplay_session_members"("session_id", "admin_user_id");

-- CreateIndex
CREATE INDEX "fairplay_sync_receipts_entity_type_entity_id_idx" ON "fairplay_sync_receipts"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "fairplay_sync_receipts_device_id_idempotency_key_key" ON "fairplay_sync_receipts"("device_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "fairplay_records_session_id_entity_type_idx" ON "fairplay_records"("session_id", "entity_type");

-- CreateIndex
CREATE INDEX "fairplay_records_device_id_entity_type_idx" ON "fairplay_records"("device_id", "entity_type");

-- CreateIndex
CREATE INDEX "fairplay_incidents_session_id_event_utc_idx" ON "fairplay_incidents"("session_id", "event_utc");

-- CreateIndex
CREATE INDEX "fairplay_reviews_incident_id_idx" ON "fairplay_reviews"("incident_id");

-- CreateIndex
CREATE INDEX "fairplay_evidence_session_id_idx" ON "fairplay_evidence"("session_id");

-- CreateIndex
CREATE INDEX "fairplay_evidence_incident_id_idx" ON "fairplay_evidence"("incident_id");

-- CreateIndex
CREATE UNIQUE INDEX "fairplay_evidence_objects_key_key" ON "fairplay_evidence_objects"("key");

-- CreateIndex
CREATE INDEX "fairplay_evidence_objects_state_delete_after_idx" ON "fairplay_evidence_objects"("state", "delete_after");

-- CreateIndex
CREATE UNIQUE INDEX "fairplay_evidence_objects_evidence_id_kind_key" ON "fairplay_evidence_objects"("evidence_id", "kind");

-- CreateIndex
CREATE INDEX "fairplay_edge_audit_entries_entity_type_entity_id_idx" ON "fairplay_edge_audit_entries"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "fairplay_edge_audit_entries_edge_device_id_seq_key" ON "fairplay_edge_audit_entries"("edge_device_id", "seq");

-- CreateIndex
CREATE INDEX "fairplay_audit_logs_action_created_at_idx" ON "fairplay_audit_logs"("action", "created_at");

-- CreateIndex
CREATE INDEX "fairplay_audit_logs_target_kind_target_id_idx" ON "fairplay_audit_logs"("target_kind", "target_id");

-- AddForeignKey
ALTER TABLE "fairplay_sessions" ADD CONSTRAINT "fairplay_sessions_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "sb_matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fairplay_sessions" ADD CONSTRAINT "fairplay_sessions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "fairplay_edge_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fairplay_session_members" ADD CONSTRAINT "fairplay_session_members_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "fairplay_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fairplay_session_members" ADD CONSTRAINT "fairplay_session_members_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fairplay_records" ADD CONSTRAINT "fairplay_records_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "fairplay_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fairplay_incidents" ADD CONSTRAINT "fairplay_incidents_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "fairplay_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fairplay_reviews" ADD CONSTRAINT "fairplay_reviews_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "fairplay_incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fairplay_evidence" ADD CONSTRAINT "fairplay_evidence_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "fairplay_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fairplay_evidence_objects" ADD CONSTRAINT "fairplay_evidence_objects_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "fairplay_evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── What the schema itself refuses ─────────────────────────────────────────
-- ADR-0001: V1 is shadow review only. No session mode or review authority can say otherwise.
ALTER TABLE "fairplay_sessions" ADD CONSTRAINT "fairplay_sessions_mode_check" CHECK ("mode" IN ('shadow', 'post_match'));
ALTER TABLE "fairplay_sessions" ADD CONSTRAINT "fairplay_sessions_angle_mode_check" CHECK ("angle_mode" IN ('single', 'multi'));
ALTER TABLE "fairplay_reviews" ADD CONSTRAINT "fairplay_reviews_authority_mode_check" CHECK ("authority_mode" = 'shadow');
ALTER TABLE "fairplay_reviews" ADD CONSTRAINT "fairplay_reviews_result_check" CHECK ("result" IS NULL OR "result" IN ('supports_original', 'supports_alternative', 'inconclusive', 'footage_unavailable'));
ALTER TABLE "fairplay_incidents" ADD CONSTRAINT "fairplay_incidents_state_check" CHECK ("state" IN ('flagged', 'reviewing', 'reviewed', 'archived'));
ALTER TABLE "fairplay_edge_devices" ADD CONSTRAINT "fairplay_edge_devices_token_kind_check" CHECK ("token_kind" IN ('bootstrap', 'device'));
ALTER TABLE "fairplay_evidence_objects" ADD CONSTRAINT "fairplay_evidence_objects_kind_check" CHECK ("kind" IN ('clip', 'manifest'));
ALTER TABLE "fairplay_evidence_objects" ADD CONSTRAINT "fairplay_evidence_objects_state_check" CHECK ("state" IN ('pending', 'stored', 'deleted'));
ALTER TABLE "fairplay_edge_audit_entries" ADD CONSTRAINT "fairplay_edge_audit_entries_chain_status_check" CHECK ("chain_status" IN ('ok', 'break', 'unverified'));

-- Both audit tables are insert-only. No code updates or deletes them; these triggers make a
-- bug, or a hand-typed statement, fail instead of rewriting history.
CREATE FUNCTION "fairplay_refuse_audit_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'FairPlay audit rows are insert-only (% on %)', TG_OP, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER "fairplay_audit_logs_insert_only" BEFORE UPDATE OR DELETE ON "fairplay_audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "fairplay_refuse_audit_change"();
CREATE TRIGGER "fairplay_edge_audit_entries_insert_only" BEFORE UPDATE OR DELETE ON "fairplay_edge_audit_entries"
  FOR EACH ROW EXECUTE FUNCTION "fairplay_refuse_audit_change"();
CREATE TRIGGER "fairplay_audit_logs_no_truncate" BEFORE TRUNCATE ON "fairplay_audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION "fairplay_refuse_audit_change"();
CREATE TRIGGER "fairplay_edge_audit_entries_no_truncate" BEFORE TRUNCATE ON "fairplay_edge_audit_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION "fairplay_refuse_audit_change"();
