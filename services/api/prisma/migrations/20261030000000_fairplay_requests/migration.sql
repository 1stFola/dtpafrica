-- FairPlay Phase 5.7: a player's or a parent's requests, and clips withdrawn on request
-- (decisions.md D11). Additive only: two new fairplay_* tables, their constraints and a
-- trigger. No existing table or column changes.

-- CreateTable
CREATE TABLE "fairplay_requests" (
    "id" TEXT NOT NULL,
    "competition_id" TEXT NOT NULL,
    "player_ref" TEXT NOT NULL,
    "requester_name" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "reference" TEXT,
    "state" TEXT NOT NULL DEFAULT 'open',
    "outcome_note" TEXT,
    "created_by_id" TEXT,
    "created_by_email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "closed_by_email" TEXT,

    CONSTRAINT "fairplay_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fairplay_withdrawals" (
    "id" TEXT NOT NULL,
    "evidence_id" TEXT NOT NULL,
    "request_id" TEXT,
    "origin" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "requester" TEXT NOT NULL,
    "clip_sha256" TEXT NOT NULL,
    "clip_bytes" BIGINT NOT NULL,
    "created_by_id" TEXT,
    "created_by_email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "edge_applied_at" TIMESTAMP(3),
    "edge_detail" JSONB,

    CONSTRAINT "fairplay_withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fairplay_requests_competition_id_created_at_idx" ON "fairplay_requests"("competition_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "fairplay_withdrawals_evidence_id_key" ON "fairplay_withdrawals"("evidence_id");

-- CreateIndex
CREATE INDEX "fairplay_withdrawals_request_id_idx" ON "fairplay_withdrawals"("request_id");

-- CreateIndex
CREATE INDEX "fairplay_withdrawals_edge_applied_at_idx" ON "fairplay_withdrawals"("edge_applied_at");

-- AddForeignKey
ALTER TABLE "fairplay_withdrawals" ADD CONSTRAINT "fairplay_withdrawals_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "fairplay_evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fairplay_withdrawals" ADD CONSTRAINT "fairplay_withdrawals_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "fairplay_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Constraints
ALTER TABLE "fairplay_requests" ADD CONSTRAINT "fairplay_requests_state_check" CHECK ("state" IN ('open', 'completed', 'refused'));
ALTER TABLE "fairplay_requests" ADD CONSTRAINT "fairplay_requests_relationship_check" CHECK ("relationship" IN ('player', 'parent_or_guardian', 'representative'));
ALTER TABLE "fairplay_withdrawals" ADD CONSTRAINT "fairplay_withdrawals_origin_check" CHECK ("origin" IN ('cloud', 'edge'));
ALTER TABLE "fairplay_withdrawals" ADD CONSTRAINT "fairplay_withdrawals_clip_sha256_check" CHECK ("clip_sha256" ~ '^[0-9a-f]{64}$');

-- A withdrawal is the record that a clip existed and why it was removed: it is never
-- deleted. Its Edge confirmation is the one thing filled in later.
CREATE FUNCTION "fairplay_refuse_withdrawal_delete"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'FairPlay withdrawals are kept (% on %)', TG_OP, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER "fairplay_withdrawals_kept" BEFORE DELETE ON "fairplay_withdrawals"
  FOR EACH ROW EXECUTE FUNCTION "fairplay_refuse_withdrawal_delete"();
CREATE TRIGGER "fairplay_withdrawals_no_truncate" BEFORE TRUNCATE ON "fairplay_withdrawals"
  FOR EACH STATEMENT EXECUTE FUNCTION "fairplay_refuse_withdrawal_delete"();
