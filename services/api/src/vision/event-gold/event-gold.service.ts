import { Inject, Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { Prisma, type VisionEventGoldSet } from "@prisma/client";
import { EVENT_GOLD_SCHEMA_VERSION, MAX_GOLD_EVENTS, VISION_EVENT_TAXONOMY_VERSION, validateEventGoldLabels, type EventGoldLabels } from "@dtp/vision-contracts";
import type { AdminAuthContext } from "../../admin/auth/admin-auth.types";
import { PrismaService } from "../../prisma/prisma.service";
import { VisionAuditService } from "../audit/vision-audit.service";
import { RightsPolicyService } from "../rights/rights-policy.service";
import { OBJECT_STORE, type ObjectStore } from "../storage/object-store";
import { notFound, personFor, refusal } from "../shared/refusals";
import { lockGoldReservations } from "./gold-lock";
import { scoreEvents, widerTolerances, type EventPrediction } from "./event-score";
import { EVENT_SCORE_MODEL_SELECT, readEventRunEvidence } from "./event-run-evidence";

const person = personFor("EventGoldNeedsAPerson", "Independent reference labels must be attributable to a person.");
const checksum = (body: string | Buffer) => createHash("sha256").update(body).digest("hex");
const fix = "Check the reference window, reviewer assignment and current state, then try again.";
const include = { submissions: { orderBy: { createdAt: "asc" as const } }, proposals: { orderBy: { createdAt: "desc" as const } }, runs: { orderBy: { createdAt: "desc" as const }, take: 20 } };
export type CreateGoldInput = { label: string; videoAssetId: string; windowStartMs: number; windowEndMs: number; toleranceMs: number; reviewerAEmail: string; reviewerBEmail: string };
export type EventBenchmarkInput = { scope?: "all_current_candidates" | "model_original_candidates" | "complete_event_run"; modelVersionId?: string; jobId?: string };

@Injectable()
export class VisionEventGoldService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    @Inject(RightsPolicyService) private readonly rights: RightsPolicyService,
    @Inject(VisionAuditService) private readonly audit: VisionAuditService) {}

  async list(actor?: AdminAuthContext, videoAssetId?: string) {
    const me = person(actor, "read event references").userId;
    return { sets: await this.db.visionEventGoldSet.findMany({ where: { ...(videoAssetId ? { videoAssetId } : {}), OR: [{ createdBy: me }, { reviewerAId: me }, { reviewerBId: me }] }, orderBy: { createdAt: "desc" }, take: 100,
      include: { submissions: { select: { reviewerId: true, createdAt: true } } } }) };
  }

  async create(input: CreateGoldInput, actor?: AdminAuthContext) {
    const me = person(actor, "create an event reference").userId;
    if (typeof input.label !== "string" || !input.label.trim() || input.label.length > 120 || !Number.isSafeInteger(input.windowStartMs) || !Number.isSafeInteger(input.windowEndMs)
      || input.windowStartMs < 0 || input.windowEndMs <= input.windowStartMs || input.windowEndMs - input.windowStartMs > 300_000
      || !Number.isSafeInteger(input.toleranceMs) || input.toleranceMs < 0 || input.toleranceMs > 10_000) throw refusal(400, "InvalidEventGoldWindow", "Use a label, a source-time window of at most five minutes and a tolerance between 0 and 10000ms.", fix);
    if (typeof input.reviewerAEmail !== "string" || typeof input.reviewerBEmail !== "string") throw refusal(400, "EventGoldReviewersRequired", "Name two existing reviewer accounts.", fix);
    const emails = [input.reviewerAEmail.trim().toLowerCase(), input.reviewerBEmail.trim().toLowerCase()];
    const users = await this.db.adminUser.findMany({ where: { email: { in: emails }, isActive: true }, include: { role: { include: { permissions: { include: { permission: true } } } } } });
    if (new Set(emails).size !== 2 || users.length !== 2 || users.some((user) => !user.role?.permissions.some((entry) => entry.permission.slug === "vision.review"))) throw refusal(400, "EventGoldReviewersRequired", "Both reviewers must be different active accounts with vision.review permission.", "Use existing authorised reviewers; this workflow does not grant permissions.");
    const asset = await this.asset(input.videoAssetId);
    if (asset.durationMs === null || input.windowEndMs > asset.durationMs || !/^[a-f0-9]{64}$/i.test(asset.checksumSha256)) throw refusal(409, "EventGoldAssetNotReady", "The source duration and checksum must be known, and the window must stay inside the original footage.", "Complete probe and fingerprint, then choose a bounded window.");
    await this.allowed(input.videoAssetId);
    try {
      const set = await this.db.$transaction(async (tx) => {
        await lockGoldReservations(tx);
        await this.noTraining(tx, asset);
        return tx.visionEventGoldSet.create({ data: { label: input.label.trim(), videoAssetId: asset.id, sourceChecksum: asset.checksumSha256, windowStartMs: input.windowStartMs, windowEndMs: input.windowEndMs,
          toleranceMs: input.toleranceMs, taxonomyVersion: VISION_EVENT_TAXONOMY_VERSION, reviewerAId: users.find((user) => user.email.toLowerCase() === emails[0])!.id, reviewerBId: users.find((user) => user.email.toLowerCase() === emails[1])!.id, createdBy: me } });
      });
      await this.audit.record({ action: "event.gold.created", targetKind: "event_gold", targetId: set.id, data: { videoAssetId: asset.id, windowStartMs: set.windowStartMs, windowEndMs: set.windowEndMs } }, actor);
      return set;
    } catch (error) { this.unique(error); }
  }

  async get(id: string, actor?: AdminAuthContext) {
    const me = person(actor, "read an event reference").userId;
    const set = await this.requireSet(id, me);
    await this.allowed(set.videoAssetId);
    const both = set.submissions.length === 2;
    const submissions = await Promise.all(set.submissions.map(async (row) => ({ id: row.id, reviewerId: row.reviewerId, createdAt: row.createdAt,
      labels: both || row.reviewerId === me ? await this.labels((await this.read<{ labels: EventGoldLabels }>(row)).labels, set) : null })));
    const proposal = set.proposals.find((row) => row.id === set.currentProposalId);
    const proposalBody = proposal ? await this.read<{ labels: EventGoldLabels; disagreement: ReturnType<typeof scoreEvents>; nonPlayAgreement: boolean }>(proposal) : null;
    if (proposalBody) await this.labels(proposalBody.labels, set);
    const asset = await this.asset(set.videoAssetId);
    if (asset.checksumSha256 !== set.sourceChecksum) throw refusal(409, "EventGoldSourceChanged", "The source bytes changed after this reference was created.", "Investigate the source and create a new reference version.");
    const disagreement = both ? scoreEvents(submissions[0]!.labels!, submissions[1]!.labels!.events.map((event) => ({ ...event, inPlay: true })), set.toleranceMs) : null;
    const roster = asset.sbMatchId ? await this.db.sbMatchSquadPlayer.findMany({ where: { matchId: asset.sbMatchId }, select: { id: true, playerName: true, jerseyNumber: true, teamId: true, team: { select: { name: true } } }, orderBy: [{ teamId: "asc" }, { jerseyNumber: "asc" }] }) : [];
    return { ...set, submissions, proposals: undefined, runs: set.runs.map((run) => ({ id: run.id, createdAt: run.createdAt })),
      proposal: proposal ? { id: proposal.id, proposedBy: proposal.proposedBy, reason: proposal.reason, ...proposalBody! } : null,
      disagreement, roster, schemaVersion: EVENT_GOLD_SCHEMA_VERSION, me,
      // Do not expose model choices or predictions during independent labelling.
      benchmarkModels: set.frozenAt ? await this.db.visionModelVersion.findMany({ where: { model: { task: "event" } },
        select: { id: true, version: true, model: { select: { key: true } } }, orderBy: { createdAt: "desc" }, take: 100 }) : [],
      benchmarkJobs: set.frozenAt ? await this.db.visionJob.findMany({ where: { videoAssetId: set.videoAssetId, type: "events", state: "succeeded", modelVersionId: { not: null } },
        select: { id: true, modelVersionId: true, attemptNumber: true, finishedAt: true }, orderBy: { finishedAt: "desc" }, take: 100 }) : [] };
  }

  async submit(id: string, input: { labels: unknown; complete: boolean }, actor?: AdminAuthContext) {
    const me = person(actor, "submit independent event labels").userId;
    const set = await this.requireSet(id, me);
    this.assigned(set, me); this.mutable(set);
    if (input.complete !== true) throw refusal(400, "EventGoldIncomplete", "Confirm that you reviewed the entire reference window, including periods with no events.", fix);
    if (set.submissions.some((row) => row.reviewerId === me)) throw refusal(409, "EventGoldAlreadySubmitted", "Your independent submission is immutable. Create a new reference version to relabel.", fix);
    await this.allowed(set.videoAssetId);
    const labels = await this.labels(input.labels, set);
    const rowId = randomUUID();
    const object = await this.write(id, `submissions/${rowId}`, { ...this.context(set), reviewerId: me, labels, complete: true });
    try {
      await this.db.$transaction(async (tx) => {
        const lock = await tx.visionEventGoldSet.updateMany({ where: { id, frozenAt: null }, data: { revision: { increment: 1 } } });
        if (lock.count !== 1) throw refusal(409, "EventGoldFrozen", "This reference was frozen while you submitted.", fix);
        await tx.visionEventGoldSubmission.create({ data: { id: rowId, goldSetId: id, reviewerId: me, ...object } });
      });
    } catch (error) { this.unique(error); }
    await this.audit.record({ action: "event.gold.submitted", targetKind: "event_gold", targetId: id, data: { submissionId: rowId, checksum: object.payloadChecksum } }, actor);
    return this.get(id, actor);
  }

  async reconcile(id: string, input: { labels: unknown; reason: string }, actor?: AdminAuthContext) {
    const me = person(actor, "propose reconciled event labels").userId;
    const set = await this.requireSet(id, me);
    this.assigned(set, me); this.mutable(set);
    if (set.submissions.length !== 2) throw refusal(409, "EventGoldNotIndependent", "Both reviewers must submit independently before reconciliation.", fix);
    this.reason(input.reason);
    await this.allowed(set.videoAssetId);
    const labels = await this.labels(input.labels, set);
    const raw = await Promise.all(set.submissions.map((row) => this.read<{ labels: EventGoldLabels }>(row)));
    const disagreement = scoreEvents(raw[0]!.labels, raw[1]!.labels.events.map((event) => ({ ...event, inPlay: true })), set.toleranceMs);
    const ordered = (value: EventGoldLabels) => JSON.stringify([...value.nonPlayWindows].sort((a, b) => a.startMs - b.startMs));
    const proposalId = randomUUID();
    const object = await this.write(id, `proposals/${proposalId}`, { ...this.context(set), proposedBy: me, reason: input.reason.trim(), labels, disagreement, nonPlayAgreement: ordered(raw[0]!.labels) === ordered(raw[1]!.labels), submissions: set.submissions.map((row) => ({ id: row.id, reviewerId: row.reviewerId, checksum: row.payloadChecksum })) });
    await this.db.$transaction(async (tx) => {
      const updated = await tx.visionEventGoldSet.updateMany({ where: { id, frozenAt: null, revision: set.revision }, data: { currentProposalId: proposalId, revision: { increment: 1 } } });
      if (updated.count !== 1) throw refusal(409, "EventGoldChanged", "The reference changed while you reconciled. Reload before proposing again.", fix);
      await tx.visionEventGoldProposal.create({ data: { id: proposalId, goldSetId: id, proposedBy: me, reason: input.reason.trim(), ...object } });
    });
    await this.audit.record({ action: "event.gold.reconciled", targetKind: "event_gold", targetId: id, reason: input.reason.trim(), data: { proposalId } }, actor);
    return this.get(id, actor);
  }

  async freeze(id: string, input: { proposalId: string }, actor?: AdminAuthContext) {
    const me = person(actor, "approve and freeze an event reference").userId;
    const set = await this.requireSet(id, me);
    this.assigned(set, me); this.mutable(set);
    const proposal = set.proposals.find((row) => row.id === input.proposalId && row.id === set.currentProposalId);
    if (set.submissions.length !== 2 || !proposal || proposal.proposedBy === me) throw refusal(409, "EventGoldNeedsSecondApproval", "Approve the current reconciliation proposed by the other assigned reviewer, after both independent submissions.", fix);
    await this.allowed(set.videoAssetId);
    await this.labels((await this.read<{ labels: EventGoldLabels }>(proposal)).labels, set);
    const asset = await this.asset(set.videoAssetId);
    if (asset.checksumSha256 !== set.sourceChecksum) throw refusal(409, "EventGoldSourceChanged", "The source checksum changed after this reference was created.", "Investigate the asset and create a new reference version.");
    await this.db.$transaction(async (tx) => {
      await lockGoldReservations(tx);
      await this.noTraining(tx, asset);
      const changed = await tx.visionEventGoldSet.updateMany({ where: { id, frozenAt: null, currentProposalId: proposal.id, revision: set.revision }, data: { frozenAt: new Date(), frozenBy: me, revision: { increment: 1 } } });
      if (changed.count !== 1) throw refusal(409, "EventGoldChanged", "The reconciliation changed or was already frozen. Reload before approving.", fix);
    });
    await this.audit.record({ action: "event.gold.frozen", targetKind: "event_gold", targetId: id, data: { proposalId: proposal.id, checksum: proposal.payloadChecksum } }, actor);
    return this.get(id, actor);
  }

  async benchmark(id: string, actor?: AdminAuthContext, input: EventBenchmarkInput = {}) {
    const scope = input?.scope === undefined ? "all_current_candidates" : input.scope;
    const idValid = (value: unknown) => typeof value === "string" && !!value.trim() && value.length <= 200;
    if (!input || typeof input !== "object" || Array.isArray(input) || !["all_current_candidates", "model_original_candidates", "complete_event_run"].includes(scope)
      || (scope !== "model_original_candidates" && input.modelVersionId !== undefined) || (scope !== "complete_event_run" && input.jobId !== undefined)
      || (scope === "model_original_candidates" && !idValid(input.modelVersionId)) || (scope === "complete_event_run" && !idValid(input.jobId)))
      throw refusal(400, "InvalidEventBenchmarkScope", "Choose current candidates, one registered event model version, or one completed event run.", "Select a scope and its model version or inference job.");
    const me = person(actor, "score an event snapshot").userId;
    const set = await this.requireSet(id, me);
    if (!set.frozenAt) throw refusal(409, "EventGoldNotFrozen", "Freeze a second-person-approved reference before scoring.", fix);
    await this.allowed(set.videoAssetId);
    const asset = await this.asset(set.videoAssetId);
    if (asset.checksumSha256 !== set.sourceChecksum) throw refusal(409, "EventGoldSourceChanged", "The reference no longer names the current source bytes.", "Investigate the asset before evaluating.");
    const proposal = set.proposals.find((row) => row.id === set.currentProposalId)!;
    const gold = await this.read<{ labels: EventGoldLabels }>(proposal);
    await this.labels(gold.labels, set);
    const inference = scope === "complete_event_run" ? await readEventRunEvidence(this.db, this.store, set, input.jobId!, asset.durationMs ?? 0) : null;
    if (inference) await this.labels({ events: inference.artifact.events, nonPlayWindows: [] }, { ...set, windowStartMs: 0, windowEndMs: asset.durationMs ?? 0 });
    const model = inference?.model ?? (scope === "model_original_candidates" ? await this.db.visionModelVersion.findUnique({ where: { id: input.modelVersionId }, select: EVENT_SCORE_MODEL_SELECT }) : null);
    if (scope === "model_original_candidates" && (!model || model.model.task !== "event"))
      throw refusal(409, "EventBenchmarkModelRequired", "This version is not a registered event model.", "Choose an event model version from the registry.");
    const selection = scope === "model_original_candidates" ? { method: "model", modelVersionId: model!.id } : { supersededBy: null };
    // Corrections are manual rows. Keep superseded/rejected model originals so
    // human corrections or decisions cannot improve the model's measured output.
    const rows = inference ? inference.artifact.events.filter((row) => row.startMs >= set.windowStartMs && row.startMs < set.windowEndMs)
      .map((row) => ({ ...row, taxonomyVersion: inference.artifact.taxonomyVersion, method: "model", modelVersionId: inference.model.id, reviewState: "unreviewed", supersededBy: null, createdAt: new Date(inference.provenance.finishedAt) }))
      : await this.db.visionEventCandidate.findMany({ where: { videoAssetId: set.videoAssetId, ...selection, startMs: { gte: set.windowStartMs, lt: set.windowEndMs } }, orderBy: { id: "asc" }, take: MAX_GOLD_EVENTS + 1,
        select: { id: true, type: true, taxonomyVersion: true, startMs: true, endMs: true, actorMatchSquadPlayerId: true, inPlay: true, method: true, modelVersionId: true, confidence: true, reviewState: true, supersededBy: true, createdAt: true } });
    if (scope === "model_original_candidates" && rows.length === 0)
      throw refusal(409, "EventBenchmarkNoModelEvidence", "There are no original proposals from this version in the reference window. An absent run is not a zero-event prediction.", "Complete a provenance-checked event inference run before evaluating this version.");
    if (rows.length > MAX_GOLD_EVENTS || rows.some((row) => row.taxonomyVersion !== set.taxonomyVersion)) throw refusal(409, "EventSnapshotNotCompatible", "The snapshot is too large or uses a different taxonomy. Nothing was scored.", "Choose a smaller reference window or a compatible taxonomy version.");
    if (!validateEventGoldLabels({ events: rows, nonPlayWindows: [] }, { startMs: 0, endMs: asset.durationMs ?? Number.MAX_SAFE_INTEGER }).labels) throw refusal(409, "InvalidEventSnapshot", "Some current candidates contain invalid event types, actors or source windows. Nothing was scored.", "Correct the affected candidates before evaluating.");
    if (rows.some((row) => !Number.isFinite(row.confidence) || row.confidence < 0 || row.confidence > 1))
      throw refusal(409, "InvalidEventSnapshot", "Candidate confidence must be finite and between zero and one. Nothing was scored.", "Investigate the original prediction artifact.");
    await this.labels({ events: rows, nonPlayWindows: [] }, { ...set, windowStartMs: 0, windowEndMs: asset.durationMs ?? Number.MAX_SAFE_INTEGER });
    const report = { ...this.context(set), proposalId: proposal.id, referenceChecksum: proposal.payloadChecksum, referenceApprovedBy: set.frozenBy, referenceFrozenAt: set.frozenAt.toISOString(),
      scope, model, inference: inference?.provenance ?? null, interpretation: inference ? "One completed event-run artifact against a frozen human reference. The worker reports complete source-window coverage; this does not establish representative accuracy or satisfy the production model gate."
        : model ? "Original proposals from one event model version, including corrected and rejected originals. Candidate evidence only: inference completeness and representative coverage are not established; this is not a production model gate."
        : "Candidate snapshot against a human reference; not a production model gate or accuracy claim for this match.",
      methods: inference ? ["model"] : [...new Set(rows.map((row) => row.method))], modelVersionIds: inference ? [inference.model.id] : [...new Set(rows.flatMap((row) => row.modelVersionId ? [row.modelVersionId] : []))], ...scoreEvents(gold.labels, rows as EventPrediction[], set.toleranceMs), widerTolerances: widerTolerances(gold.labels, rows as EventPrediction[], set.toleranceMs) };
    const runId = randomUUID();
    const snapshot = await this.write(id, `runs/${runId}/snapshot`, { ...this.context(set), requestedBy: me, scope, model, inference: inference?.provenance ?? null, rows });
    const scored = await this.write(id, `runs/${runId}/report`, { ...report, snapshotChecksum: snapshot.payloadChecksum });
    await this.db.visionEventGoldRun.create({ data: { id: runId, goldSetId: id, requestedBy: me, snapshotKey: snapshot.payloadKey, snapshotChecksum: snapshot.payloadChecksum, reportKey: scored.payloadKey, reportChecksum: scored.payloadChecksum } });
    await this.audit.record({ action: "event.gold.scored", targetKind: "event_gold", targetId: id, data: { runId, scope, inferenceJobId: inference?.provenance.jobId ?? null, modelVersionId: model?.id ?? null, snapshotChecksum: snapshot.payloadChecksum, reportChecksum: scored.payloadChecksum } }, actor);
    return { runId, report: { ...report, snapshotChecksum: snapshot.payloadChecksum } };
  }

  async report(id: string, runId: string, actor?: AdminAuthContext) {
    const set = await this.requireSet(id, person(actor, "read event scores").userId);
    await this.allowed(set.videoAssetId);
    const run = await this.db.visionEventGoldRun.findFirst({ where: { id: runId, goldSetId: id } });
    if (!run) throw notFound("event benchmark run", runId);
    const proposal = set.proposals.find((row) => row.id === set.currentProposalId)!;
    await this.labels((await this.read<{ labels: EventGoldLabels }>(proposal)).labels, set);
    // Read both artifacts: a report without the snapshot it names is not reproducible.
    const snapshot = await this.read<{ rows: EventPrediction[] }>({ payloadKey: run.snapshotKey, payloadChecksum: run.snapshotChecksum });
    const asset = await this.asset(set.videoAssetId);
    await this.labels({ events: snapshot.rows, nonPlayWindows: [] }, { ...set, windowStartMs: 0, windowEndMs: asset.durationMs ?? Number.MAX_SAFE_INTEGER });
    return { runId, report: await this.read({ payloadKey: run.reportKey, payloadChecksum: run.reportChecksum }) };
  }

  private async requireSet(id: string, me: string) {
    const set = await this.db.visionEventGoldSet.findUnique({ where: { id }, include });
    if (!set) throw notFound("event reference", id);
    if (![set.createdBy, set.reviewerAId, set.reviewerBId].includes(me)) throw refusal(403, "EventGoldAssignedOnly", "This reference belongs to its creator and assigned reviewers.", "Open a reference assigned to your account.");
    return set;
  }
  private assigned(set: VisionEventGoldSet, me: string) {
    if (![set.reviewerAId, set.reviewerBId].includes(me)) throw refusal(403, "EventGoldAssignedOnly", "Only an assigned reviewer can label or approve this reference.", fix);
  }
  private mutable(set: VisionEventGoldSet) { if (set.frozenAt) throw refusal(409, "EventGoldFrozen", "Frozen reference labels are immutable.", "Create a new reference version and rebaseline openly."); }
  private reason(value: unknown) { if (typeof value !== "string" || !value.trim() || value.length > 2000) throw refusal(400, "EventGoldReasonRequired", "Explain how disagreements were resolved (at most 2000 characters).", fix); }
  private async asset(id: string) { const asset = await this.db.visionVideoAsset.findUnique({ where: { id } }); if (!asset) throw notFound("video asset", id); return asset; }
  private async allowed(videoAssetId: string) { const decision = await this.rights.canAnalyze({ videoAssetId }); if (!decision.allowed) throw refusal(403, "RightsDenied", "Analysis rights are required for event reference work.", "Restore the relevant grant before proceeding.", { reason: decision.reason }); }
  private async labels(raw: unknown, set: VisionEventGoldSet) {
    const result = validateEventGoldLabels(raw, { startMs: set.windowStartMs, endMs: set.windowEndMs });
    if (!result.labels) throw refusal(400, "InvalidEventGoldLabels", "The labels do not satisfy the event reference contract.", fix, { problems: result.problems });
    const actorIds = [...new Set(result.labels.events.flatMap((event) => event.actorMatchSquadPlayerId ? [event.actorMatchSquadPlayerId] : []))];
    if (actorIds.length) {
      const asset = await this.asset(set.videoAssetId);
      const slots = asset.sbMatchId ? await this.db.sbMatchSquadPlayer.findMany({ where: { id: { in: actorIds }, matchId: asset.sbMatchId }, select: { id: true, playerId: true } }) : [];
      if (slots.length !== actorIds.length) throw refusal(400, "EventGoldActorOutsideMatch", "Every known actor must be a roster slot from this footage's match.", "Choose a match player or mark the actor unknown.");
      for (const slot of slots) if (slot.playerId) {
        const decision = await this.rights.canAnalyze({ videoAssetId: set.videoAssetId, playerId: slot.playerId });
        if (!decision.allowed) throw refusal(403, "RightsDenied", "A reference actor no longer has analysis rights.", "Restore the applicable rights before viewing or changing actor labels.", { reason: decision.reason });
      }
    }
    return result.labels;
  }
  private async write(id: string, name: string, value: unknown) { const body = JSON.stringify(value); const payloadKey = `event-gold/${id}/${name}.json`; await this.store.putSmallObject("derived", payloadKey, body, "application/json"); return { payloadKey, payloadChecksum: checksum(body) }; }
  private context(set: VisionEventGoldSet) { return { schemaVersion: EVENT_GOLD_SCHEMA_VERSION, goldSetId: set.id, label: set.label, videoAssetId: set.videoAssetId, sourceChecksum: set.sourceChecksum, windowStartMs: set.windowStartMs, windowEndMs: set.windowEndMs, taxonomyVersion: set.taxonomyVersion, toleranceMs: set.toleranceMs }; }
  private async read<T = unknown>(row: { payloadKey: string; payloadChecksum: string }): Promise<T> { const body = await this.store.getSmallObject("derived", row.payloadKey); if (!body || checksum(body) !== row.payloadChecksum) throw refusal(409, "EventGoldIntegrityFailure", "Stored labels or scoring artifacts no longer match their recorded checksum.", "Investigate storage; do not score or freeze this reference."); return JSON.parse(body.toString("utf8")) as T; }
  private unique(error: unknown): never { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw refusal(409, "EventGoldAlreadyExists", "The reference label or immutable reviewer submission already exists.", fix); throw error; }
  private async noTraining(tx: Prisma.TransactionClient, asset: { id: string; checksumSha256: string; sbMatchId: string | null }) {
    const member = await tx.visionDatasetMember.findFirst({ where: { datasetVersion: { frozenAt: { not: null } }, split: { in: ["train", "val"] }, OR: [{ videoAssetId: asset.id }, { checksumSha256: asset.checksumSha256 }, ...(asset.sbMatchId ? [{ sbMatchId: asset.sbMatchId }] : [])] } });
    if (member) throw refusal(409, "EventGoldAlreadyUsedForTraining", "This footage or match is already in a frozen training/validation dataset and cannot become held-out event gold.", "Select footage outside training and validation.");
  }
}
