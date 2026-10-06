import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import type { EventGoldLabels } from "@dtp/vision-contracts";
import { VisionEventGoldService } from "./event-gold.service";
import { InMemoryObjectStore } from "../storage/in-memory-object-store";
import type { AdminAuthContext } from "../../admin/auth/admin-auth.types";

const alice = { userId: "alice", method: "jwt" } as AdminAuthContext, bob = { userId: "bob", method: "jwt" } as AdminAuthContext;
const input = { label: "independent-v1", videoAssetId: "asset", windowStartMs: 0, windowEndMs: 5000, toleranceMs: 100, reviewerAEmail: "alice@example.test", reviewerBEmail: "bob@example.test" };
const labels = (id = "e", startMs = 1000): EventGoldLabels => ({ events: [{ id, type: "shot", startMs, endMs: startMs, actorMatchSquadPlayerId: null }], nonPlayWindows: [] });
type Row = Record<string, any>;
let set: Row | null, store: InMemoryObjectStore, service: VisionEventGoldService;
const db = {
  adminUser: { findMany: vi.fn() }, visionVideoAsset: { findUnique: vi.fn() }, sbMatchSquadPlayer: { findMany: vi.fn() }, visionDatasetMember: { findFirst: vi.fn() },
  visionEventGoldSet: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
  visionEventGoldSubmission: { create: vi.fn() }, visionEventGoldProposal: { create: vi.fn() }, visionEventGoldRun: { create: vi.fn(), findFirst: vi.fn() },
  visionEventCandidate: { findMany: vi.fn() }, visionModelVersion: { findMany: vi.fn(), findUnique: vi.fn() },
  visionJob: { findMany: vi.fn(), findFirst: vi.fn() }, visionJobEvent: { findFirst: vi.fn() }, $transaction: vi.fn(), $executeRaw: vi.fn(),
};
const rights = { canAnalyze: vi.fn() }, audit = { record: vi.fn() };
beforeEach(() => {
  vi.resetAllMocks(); set = null; store = new InMemoryObjectStore();
  db.adminUser.findMany.mockResolvedValue(["alice", "bob"].map((id) => ({ id, email: `${id}@example.test`, role: { permissions: [{ permission: { slug: "vision.review" } }] } })));
  db.visionVideoAsset.findUnique.mockResolvedValue({ id: "asset", durationMs: 5000, checksumSha256: "a".repeat(64), sbMatchId: "match" });
  db.sbMatchSquadPlayer.findMany.mockResolvedValue([]); rights.canAnalyze.mockResolvedValue({ allowed: true });
  db.visionDatasetMember.findFirst.mockResolvedValue(null);
  db.$transaction.mockImplementation((fn) => fn(db));
  db.visionEventGoldSet.create.mockImplementation(({ data }) => { set = { ...data, id: "gold", revision: 0, currentProposalId: null, frozenAt: null, frozenBy: null, createdAt: new Date(), submissions: [], proposals: [], runs: [] }; return structuredClone(set); });
  db.visionEventGoldSet.findUnique.mockImplementation(() => structuredClone(set));
  db.visionEventGoldSet.updateMany.mockImplementation(({ where, data }) => {
    if (!set || set.frozenAt || (where.revision !== undefined && where.revision !== set.revision) || (where.currentProposalId !== undefined && where.currentProposalId !== set.currentProposalId)) return { count: 0 };
    Object.assign(set, { ...data, revision: set.revision + (data.revision?.increment ?? 0) }); return { count: 1 };
  });
  db.visionEventGoldSubmission.create.mockImplementation(({ data }) => { if (set!.submissions.some((row: Row) => row.reviewerId === data.reviewerId)) throw new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test" }); set!.submissions.push({ ...data, createdAt: new Date() }); return data; });
  db.visionEventGoldProposal.create.mockImplementation(({ data }) => { set!.proposals.push({ ...data, createdAt: new Date() }); return data; });
  db.visionEventGoldRun.create.mockImplementation(({ data }) => { set!.runs.push({ ...data, createdAt: new Date() }); return data; });
  db.visionEventGoldRun.findFirst.mockImplementation(({ where }) => set!.runs.find((row: Row) => row.id === where.id));
  db.visionEventCandidate.findMany.mockResolvedValue([]);
  db.visionModelVersion.findMany.mockResolvedValue([]);
  db.visionJob.findMany.mockResolvedValue([]);
  db.visionModelVersion.findUnique.mockResolvedValue({ id: "event-model", version: "v1", weightsChecksum: "c".repeat(64), gitCommit: "commit", model: { key: "event-detector", task: "event" } });
  service = new VisionEventGoldService(db as never, store, rights as never, audit as never);
});
const independent = async () => { await service.create(input, alice); await service.submit("gold", { labels: labels("a"), complete: true }, alice); await service.submit("gold", { labels: labels("b", 1020), complete: true }, bob); };
const frozen = async () => { await independent(); const proposal = await service.reconcile("gold", { labels: labels("gold-event"), reason: "Reviewed contact frame together; unknown actor retained." }, alice); await service.freeze("gold", { proposalId: proposal.proposal!.id }, bob); };

describe("independent event references", () => {
  it("refuses shared keys, duplicate reviewers, missing permissions and already-trained footage", async () => {
    await expect(service.create(input)).rejects.toMatchObject({ response: { error: "EventGoldNeedsAPerson" } });
    await expect(service.create({ ...input, reviewerBEmail: input.reviewerAEmail }, alice)).rejects.toMatchObject({ response: { error: "EventGoldReviewersRequired" } });
    db.adminUser.findMany.mockResolvedValueOnce([{ id: "alice", email: input.reviewerAEmail, role: null }]);
    await expect(service.create(input, alice)).rejects.toMatchObject({ response: { error: "EventGoldReviewersRequired" } });
    db.visionDatasetMember.findFirst.mockResolvedValueOnce({ id: "training-member" });
    await expect(service.create(input, alice)).rejects.toMatchObject({ response: { error: "EventGoldAlreadyUsedForTraining" } });
    expect(db.visionEventGoldSet.create).not.toHaveBeenCalled();
  });
  it("rejects bad windows and out-of-source footage", async () => {
    await expect(service.create({ ...input, toleranceMs: NaN }, alice)).rejects.toMatchObject({ response: { error: "InvalidEventGoldWindow" } });
    await expect(service.create({ ...input, windowEndMs: 6000 }, alice)).rejects.toMatchObject({ response: { error: "EventGoldAssetNotReady" } });
  });
  it("blinds the other labels and object keys until both independently submit", async () => {
    await service.create(input, alice);
    await service.submit("gold", { labels: labels("a"), complete: true }, alice);
    const theirs = await service.get("gold", bob);
    expect(theirs.submissions[0]?.labels).toBeNull();
    expect(theirs.submissions[0]).not.toHaveProperty("payloadKey");
    expect((await service.get("gold", alice)).submissions[0]?.labels?.events[0]?.id).toBe("a");
    await service.submit("gold", { labels: labels("b"), complete: true }, bob);
    expect((await service.get("gold", alice)).submissions.every((row) => row.labels !== null)).toBe(true);
  });
  it("enforces assignment, completeness, immutable submission and two independent inputs", async () => {
    await service.create(input, alice);
    await expect(service.submit("gold", { labels: labels(), complete: false }, alice)).rejects.toMatchObject({ response: { error: "EventGoldIncomplete" } });
    await expect(service.get("gold", { userId: "carol" } as AdminAuthContext)).rejects.toMatchObject({ response: { error: "EventGoldAssignedOnly" } });
    await service.submit("gold", { labels: labels(), complete: true }, alice);
    await expect(service.submit("gold", { labels: labels(), complete: true }, alice)).rejects.toMatchObject({ response: { error: "EventGoldAlreadySubmitted" } });
    await expect(service.reconcile("gold", { labels: labels(), reason: "reason" }, alice)).rejects.toMatchObject({ response: { error: "EventGoldNotIndependent" } });
  });
  it("records disagreement and requires second approval of the exact current reconciliation", async () => {
    await independent();
    const result = await service.reconcile("gold", { labels: labels("canonical"), reason: "Timing reconciled." }, alice);
    expect(result.proposal?.disagreement.all.tp).toBe(1);
    expect(result.proposal?.disagreement.all.meanStartErrorMs).toBe(20);
    await expect(service.freeze("gold", { proposalId: result.proposal!.id }, alice)).rejects.toMatchObject({ response: { error: "EventGoldNeedsSecondApproval" } });
    await expect(service.freeze("gold", { proposalId: "obsolete" }, bob)).rejects.toMatchObject({ response: { error: "EventGoldNeedsSecondApproval" } });
    const final = await service.freeze("gold", { proposalId: result.proposal!.id }, bob);
    expect(final.frozenBy).toBe("bob");
    await expect(service.reconcile("gold", { labels: labels(), reason: "later edit" }, bob)).rejects.toMatchObject({ response: { error: "EventGoldFrozen" } });
    await expect(service.submit("gold", { labels: labels(), complete: true }, alice)).rejects.toMatchObject({ response: { error: "EventGoldFrozen" } });
  });
  it("refuses a reconciliation or freeze lost to a concurrent state change", async () => {
    await independent(); db.visionEventGoldSet.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.reconcile("gold", { labels: labels(), reason: "candidate" }, alice)).rejects.toMatchObject({ response: { error: "EventGoldChanged" } });
    const result = await service.reconcile("gold", { labels: labels(), reason: "new candidate" }, alice);
    db.visionEventGoldSet.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.freeze("gold", { proposalId: result.proposal!.id }, bob)).rejects.toMatchObject({ response: { error: "EventGoldChanged" } });
    expect(set!.frozenAt).toBeNull();
  });
  it("checks rights again on submission, viewing, freeze and scoring", async () => {
    await frozen(); rights.canAnalyze.mockResolvedValue({ allowed: false, reason: "revoked" });
    await expect(service.get("gold", alice)).rejects.toMatchObject({ response: { error: "RightsDenied" } });
    await expect(service.benchmark("gold", alice)).rejects.toMatchObject({ response: { error: "RightsDenied" } });
    expect(db.visionEventGoldRun.create).not.toHaveBeenCalled();
  });
  it("rejects a roster actor from a different match and player-level revocation", async () => {
    await service.create(input, alice);
    const known = { ...labels(), events: [{ ...labels().events[0]!, actorMatchSquadPlayerId: "slot" }] };
    await expect(service.submit("gold", { labels: known, complete: true }, alice)).rejects.toMatchObject({ response: { error: "EventGoldActorOutsideMatch" } });
    db.sbMatchSquadPlayer.findMany.mockResolvedValue([{ id: "slot", playerId: "player" }]);
    rights.canAnalyze.mockImplementation(async (subject) => ({ allowed: !subject.playerId, reason: "player_revoked" }));
    await expect(service.submit("gold", { labels: known, complete: true }, alice)).rejects.toMatchObject({ response: { error: "RightsDenied" } });
  });
  it("pins the frozen checksum and snapshot, preserves zero-support metrics and changes no events", async () => {
    await frozen();
    const result = await service.benchmark("gold", alice);
    expect(result.report.all).toMatchObject({ reference: 1, predictions: 0, fn: 1, precision: null, recall: 0 });
    expect(result.report.snapshotChecksum).toHaveLength(64);
    expect(result.report.referenceChecksum).toHaveLength(64);
    expect((await service.report("gold", result.runId, bob)).report).toEqual(result.report);
    expect(Object.keys(db.visionEventCandidate)).toEqual(["findMany"]);
    expect(db.visionEventCandidate.findMany.mock.calls[0]?.[0].take).toBe(201);
  });
  it("refuses object corruption and source checksum drift", async () => {
    await frozen(); const proposal = set!.proposals[0];
    await store.putSmallObject("derived", proposal.payloadKey, "{}", "application/json");
    await expect(service.benchmark("gold", alice)).rejects.toMatchObject({ response: { error: "EventGoldIntegrityFailure" } });
    db.visionVideoAsset.findUnique.mockResolvedValue({ id: "asset", checksumSha256: "b".repeat(64) });
    await expect(service.benchmark("gold", alice)).rejects.toMatchObject({ response: { error: "EventGoldSourceChanged" } });
  });
  it("keeps model choices hidden until freeze and only lists registered event versions", async () => {
    await independent();
    expect((await service.get("gold", bob)).benchmarkModels).toEqual([]);
    expect(db.visionModelVersion.findMany).not.toHaveBeenCalled();
    expect(db.visionJob.findMany).not.toHaveBeenCalled();
    await frozenAfterIndependent();
    expect(db.visionModelVersion.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { model: { task: "event" } }, take: 100 }));
    expect(db.visionJob.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { videoAssetId: "asset", type: "events", state: "succeeded", modelVersionId: { not: null } }, take: 100 }));
  });
  it("scores superseded and rejected model originals without including manual corrections or other versions", async () => {
    await frozen();
    const original = { ...labels("original", 1300).events[0]!, taxonomyVersion: set!.taxonomyVersion, method: "model", modelVersionId: "event-model", confidence: 0.2, inPlay: true, reviewState: "rejected", supersededBy: "human-correction", createdAt: new Date() };
    db.visionEventCandidate.findMany.mockResolvedValue([original]);
    const result = await service.benchmark("gold", alice, { scope: "model_original_candidates", modelVersionId: "event-model" });
    const query = db.visionEventCandidate.findMany.mock.calls[0]![0];
    expect(query.where).toMatchObject({ method: "model", modelVersionId: "event-model" });
    expect(query.where).not.toHaveProperty("supersededBy");
    expect(query.where).not.toHaveProperty("reviewState");
    expect(result.report.all).toMatchObject({ tp: 0, fp: 1, fn: 1 });
    expect(result.report.scope).toBe("model_original_candidates");
    expect(result.report.model).toMatchObject({ id: "event-model", weightsChecksum: "c".repeat(64) });
    expect((await service.report("gold", result.runId, bob)).report).toEqual(result.report);
  });
  it("refuses invalid scopes, mixed current/model selection, unknown/non-event versions and absent inference evidence", async () => {
    await frozen();
    for (const input of [{ scope: "typo" }, { scope: "all_current_candidates", modelVersionId: "model" }, { scope: "model_original_candidates" }, { scope: "model_original_candidates", modelVersionId: " " }, null, []]) {
      await expect(service.benchmark("gold", alice, input as never)).rejects.toMatchObject({ response: { error: "InvalidEventBenchmarkScope" } });
    }
    db.visionModelVersion.findUnique.mockResolvedValueOnce(null);
    await expect(service.benchmark("gold", alice, { scope: "model_original_candidates", modelVersionId: "missing" })).rejects.toMatchObject({ response: { error: "EventBenchmarkModelRequired" } });
    db.visionModelVersion.findUnique.mockResolvedValueOnce({ id: "detect", model: { task: "detect" } });
    await expect(service.benchmark("gold", alice, { scope: "model_original_candidates", modelVersionId: "detect" })).rejects.toMatchObject({ response: { error: "EventBenchmarkModelRequired" } });
    await expect(service.benchmark("gold", alice, { scope: "model_original_candidates", modelVersionId: "event-model" })).rejects.toMatchObject({ response: { error: "EventBenchmarkNoModelEvidence" } });
    expect(db.visionEventGoldRun.create).not.toHaveBeenCalled();
  });
  it("rechecks prediction actor rights on scoring and saved report reads", async () => {
    await frozen();
    db.sbMatchSquadPlayer.findMany.mockResolvedValue([{ id: "slot", playerId: "player" }]);
    db.visionEventCandidate.findMany.mockResolvedValue([{ ...labels("model").events[0]!, actorMatchSquadPlayerId: "slot", taxonomyVersion: set!.taxonomyVersion, method: "model", modelVersionId: "event-model", confidence: 0.5, inPlay: true }]);
    const run = await service.benchmark("gold", alice, { scope: "model_original_candidates", modelVersionId: "event-model" });
    rights.canAnalyze.mockImplementation(async (subject) => ({ allowed: !subject.playerId, reason: "player_revoked" }));
    await expect(service.benchmark("gold", alice, { scope: "model_original_candidates", modelVersionId: "event-model" })).rejects.toMatchObject({ response: { error: "RightsDenied" } });
    await expect(service.report("gold", run.runId, bob)).rejects.toMatchObject({ response: { error: "RightsDenied" } });
  });
  it("scores a completed zero-output run as misses and pins the run rather than reading the candidate ledger", async () => {
    await frozen(); await completeRun([]);
    const result = await service.benchmark("gold", alice, { scope: "complete_event_run", jobId: "event-job" });
    expect(result.report.all).toMatchObject({ reference: 1, predictions: 0, fn: 1, precision: null, recall: 0 });
    expect(result.report.modelVersionIds).toEqual(["event-model"]);
    expect(result.report.inference).toMatchObject({ jobId: "event-job", attemptNumber: 1, eventCount: 0 });
    expect(result.report.inference!.artifactChecksum).toHaveLength(64);
    expect(db.visionEventCandidate.findMany).not.toHaveBeenCalled();
    expect((await service.report("gold", result.runId, bob)).report).toEqual(result.report);
  });
  it("scores exactly one run's immutable output", async () => {
    await frozen(); await completeRun([{ ...labels("prediction").events[0]!, confidence: 0.5, inPlay: true }]);
    const result = await service.benchmark("gold", bob, { scope: "complete_event_run", jobId: "event-job" });
    expect(result.report.all.tp).toBe(1);
    expect(result.report.pairs[0]?.predictionId).toBe("prediction");
    expect(db.visionEventCandidate.findMany).not.toHaveBeenCalled();
  });
  it("refuses incomplete-run selection and missing evidence instead of treating it as zero output", async () => {
    await frozen();
    for (const input of [{ scope: "complete_event_run" }, { scope: "complete_event_run", jobId: "job", modelVersionId: "event-model" }, { scope: "all_current_candidates", jobId: "job" }, { scope: null }])
      await expect(service.benchmark("gold", alice, input as never)).rejects.toMatchObject({ response: { error: "InvalidEventBenchmarkScope" } });
    await expect(service.benchmark("gold", alice, { scope: "complete_event_run", jobId: "missing" })).rejects.toMatchObject({ response: { error: "EventRunEvidenceInvalid" } });
    expect(db.visionEventGoldRun.create).not.toHaveBeenCalled();
  });
});

async function completeRun(events: unknown[]) {
  const artifact = { schemaVersion: "event-inference/v1", jobId: "event-job", attemptNumber: 1, videoAssetId: "asset", sourceChecksum: "a".repeat(64),
    modelVersionId: "event-model", weightsChecksum: "c".repeat(64), configKey: "config", gitCommit: "commit", workerImage: "image", taxonomyVersion: set!.taxonomyVersion,
    coverage: { startMs: 0, endMs: 5000, complete: true }, events };
  const body = JSON.stringify(artifact), key = "inference/event-job/1/events.json";
  await store.putSmallObject("derived", key, body, "application/json");
  const progress = { artifacts: [{ key, bucket: "derived", role: "event_inference", bytes: Buffer.byteLength(body), contentType: "application/json" }], modelVersionIds: ["event-model"], workerImage: "image",
    summary: { modelVersionId: "event-model", weightsSha256: artifact.weightsChecksum, sourceChecksum: artifact.sourceChecksum, windowStartMs: 0, windowEndMs: 5000, eventCount: events.length, eventArtifactSha256: createHash("sha256").update(body).digest("hex") } };
  db.visionJob.findFirst.mockResolvedValue({ id: "event-job", type: "events", state: "succeeded", videoAssetId: "asset", modelVersionId: "event-model", workerId: "worker", idempotencyKey: "complete-once", attemptNumber: 1,
    finishedAt: new Date(), outputPrefix: "inference/event-job/1/", inputSpec: { sourceChecksum: artifact.sourceChecksum, windowStartMs: 0, windowEndMs: 5000 }, progress });
  db.visionJobEvent.findFirst.mockResolvedValue({ data: progress });
  db.visionModelVersion.findUnique.mockResolvedValue({ id: "event-model", version: "v1", weightsChecksum: artifact.weightsChecksum, configKey: "config", gitCommit: "commit", workerImage: "image", model: { key: "events", task: "event" } });
}

async function frozenAfterIndependent() {
  const proposal = await service.reconcile("gold", { labels: labels("gold-event"), reason: "Reviewed independently." }, alice);
  await service.freeze("gold", { proposalId: proposal.proposal!.id }, bob);
}
