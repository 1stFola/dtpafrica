/**
 * FairPlay Phase 4 against a real Postgres: sync, ownership, uploads, reads, retention.
 *
 *   FAIRPLAY_CHECK_DATABASE_URL=postgresql://…/fp4_scratch pnpm --filter @dtp/api fairplay:cloudcheck
 *
 * Only on a throwaway database built by `prisma migrate deploy`: FairPlay's audit tables are
 * insert-only by trigger, so what this writes cannot be removed afterwards. It refuses a
 * database whose name does not say scratch, test or ci.
 *
 * The bucket is the in-memory test double, which refuses a body that is not what was
 * signed, as R2 does. scripts/fairplay-e2e-check.py runs the real Edge against the real
 * API and an S3 server.
 */
import { generateKeyPairSync, randomUUID, verify, createPublicKey } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import type { AdminAuthContext } from "../src/admin/auth/admin-auth.types";
import { canonical, sha256Hex } from "../src/fairplay/canonical";
import { FairPlayDevicesService } from "../src/fairplay/devices.service";
import { FairPlayEvidenceService } from "../src/fairplay/evidence.service";
import { FairPlayAuditService } from "../src/fairplay/fairplay-audit.service";
import { loadFairPlayConfig } from "../src/fairplay/fairplay.config";
import { FairPlayReportService } from "../src/fairplay/report.service";
import { FairPlaySessionsService } from "../src/fairplay/sessions.service";
import { InMemoryEvidenceStore } from "../src/fairplay/storage/in-memory-evidence-store";
import { FairPlaySyncService, type SyncItem } from "../src/fairplay/sync.service";
import type { PrismaService } from "../src/prisma/prisma.service";
import { seedRbac } from "../src/seed/seed-rbac";

const url = process.env.FAIRPLAY_CHECK_DATABASE_URL ?? "";
const dbName = url.split("/").pop()?.split("?")[0] ?? "";
if (!/scratch|test|ci/i.test(dbName)) {
  console.error(`Refused: FAIRPLAY_CHECK_DATABASE_URL must name a throwaway database (scratch, test or ci), not "${dbName || "(unset)"}".`);
  process.exit(2);
}

const prisma = new PrismaClient({ datasourceUrl: url });
const db = prisma as unknown as PrismaService;
let passed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) passed += 1;
  else failures.push(label);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok || detail === undefined ? "" : `  ${JSON.stringify(detail)}`}`);
}

async function refusedWith(label: string, fn: () => Promise<unknown>, error: string) {
  try {
    await fn();
    check(label, false, "not refused");
  } catch (e) {
    const body = (e as { getResponse?: () => { error?: string } }).getResponse?.();
    check(label, body?.error === error, body ?? (e as Error).message);
  }
}

const ctx = (userId: string | undefined, permissions: string[], competitionIds: string[] = [], email = "x@example.org"): AdminAuthContext =>
  ({ method: "jwt", roleSlug: null, roleName: null, permissions, userId, email, competitionIds });

const hash = (payload: unknown) => sha256Hex(canonical(payload));

function item(entityType: string, entityId: string, version: number, payload: Record<string, unknown>): SyncItem {
  return { idempotencyKey: `${entityType}:${entityId}:${version}`, entityType, entityId, version, payloadHash: hash(payload), payload };
}

async function main() {
  const { privateKey } = generateKeyPairSync("ed25519");
  const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const config = loadFairPlayConfig({ FAIRPLAY_BUNDLE_SIGNING_KEY: pem });
  const store = new InMemoryEvidenceStore();
  const audit = new FairPlayAuditService(db);
  const devices = new FairPlayDevicesService(db, config, audit);
  const sessions = new FairPlaySessionsService(db, config, audit);
  const sync = new FairPlaySyncService(db, audit);
  const evidence = new FairPlayEvidenceService(db, config, store, audit);
  const reports = new FairPlayReportService(db, config, evidence, audit);

  await seedRbac(prisma);
  const run = randomUUID().slice(0, 8);
  const comp = async (name: string) => prisma.sbCompetition.create({ data: { slug: `fp-${name}-${run}`, name: `FP ${name} ${run}`, season: "2026" } });
  const c1 = await comp("one");
  const c2 = await comp("two");
  const team = async (c: { id: string }, name: string) => prisma.sbTeam.create({ data: { competitionId: c.id, slug: `${name}-${run}`, name } });
  const [lions, eagles, rams] = [await team(c1, "Lions"), await team(c1, "Eagles"), await team(c2, "Rams")];
  const ramsB = await team(c2, "Bulls");
  const matchA = await prisma.sbMatch.create({ data: { competitionId: c1.id, homeTeamId: lions.id, awayTeamId: eagles.id, kickoffAt: new Date() } });
  const matchB = await prisma.sbMatch.create({ data: { competitionId: c1.id, homeTeamId: eagles.id, awayTeamId: lions.id } });
  const matchC = await prisma.sbMatch.create({ data: { competitionId: c2.id, homeTeamId: rams.id, awayTeamId: ramsB.id } });
  const role = async (slug: string) => (await prisma.adminRole.findUniqueOrThrow({ where: { slug } })).id;
  const user = async (name: string, roleSlug: string) => prisma.adminUser.create({ data: { email: `${name}-${run}@example.org`, name, roleId: await role(roleSlug) } });
  const assessor = await user("assessor", "fairplay_assessor");
  const operator = await user("operator", "fairplay_operator");
  const outsider = await user("recorder", "match_recorder");

  const admin = ctx("admin-1", ["fairplay.session.manage", "fairplay.edge.admin", "fairplay.incident.review", "fairplay.evidence.export"]);
  const assessorCtx = ctx(assessor.id, ["fairplay.incident.operate", "fairplay.incident.review"], [], assessor.email);
  const operatorCtx = ctx(operator.id, ["fairplay.incident.operate"], [], operator.email);
  const orgC1 = ctx("org-1", ["fairplay.report.view"], [c1.id]);
  const orgC2 = ctx("org-2", ["fairplay.report.view"], [c2.id]);
  const orgUnscoped = ctx("org-3", ["fairplay.report.view"]);

  console.log("\nDevices and pairing");
  const d1 = await devices.create("Edge laptop 1", admin);
  const edge1 = randomUUID();
  const reg1 = await devices.register(d1.bootstrapToken, edge1);
  check("a bootstrap token pairs a device and returns the key to trust", Boolean(reg1.deviceToken && reg1.trustedKey?.keyId));
  await refusedWith("the same bootstrap token cannot pair a second machine", () => devices.register(d1.bootstrapToken, randomUUID()), "DeviceTokenInvalid");
  await refusedWith("a bootstrap token is not a device token", () => devices.verify(d1.bootstrapToken), "DeviceTokenInvalid");
  const id1 = await devices.verify(reg1.deviceToken);
  const d2 = await devices.create("Edge laptop 2", admin);
  const edge2 = randomUUID();
  const id2 = await devices.verify((await devices.register(d2.bootstrapToken, edge2)).deviceToken);

  console.log("\nSessions and members");
  await refusedWith("no session mode but shadow or post_match", () => sessions.create({ matchId: matchA.id, deviceId: d1.id, mode: "official" }, admin), "ModeNotAllowed");
  await refusedWith("a member is never given more than their account holds",
    () => sessions.create({ matchId: matchA.id, deviceId: d1.id, members: [{ adminUserId: operator.id, permissions: ["fairplay.incident.review"] }] }, admin), "PermissionNotHeld");
  await refusedWith("an account with no FairPlay role cannot be a member",
    () => sessions.create({ matchId: matchA.id, deviceId: d1.id, members: [{ adminUserId: outsider.id, permissions: ["fairplay.incident.operate"] }] }, admin), "PermissionNotHeld");
  const s1 = await sessions.create({ matchId: matchA.id, deviceId: d1.id, members: [
    { adminUserId: assessor.id, permissions: ["fairplay.incident.operate", "fairplay.incident.review"] },
    { adminUserId: operator.id, permissions: ["fairplay.incident.operate"] }] }, admin);
  const sC = await sessions.create({ matchId: matchC.id, deviceId: d2.id }, admin);
  check("the label defaults to the fixture", s1.label === "Lions v Eagles", s1.label);
  await refusedWith("an organiser cannot see another competition's session", () => sessions.get(sC.id, orgC1), "NotFound");
  const orgView = await sessions.get(s1.id, orgC1);
  check("an organiser sees the session but not its members or device", !("members" in orgView) && !("device" in orgView));
  await refusedWith("an unscoped organiser account is refused outright", () => sessions.list(orgUnscoped, {}), "OrganiserUnscoped");
  check("an organiser's session list is their competition's only", (await sessions.list(orgC1, {})).every((s) => s.competitionId === c1.id));

  console.log("\nThe signed bundle");
  check("no bundle names a member before they set a PIN", (await sessions.bundleFor(id1)).bundle?.bundle.members.length === 0);
  await refusedWith("a PIN is six digits or more", () => sessions.setMyPin(s1.id, "1234", assessorCtx), "PinInvalid");
  await refusedWith("only a member sets a PIN for a session", () => sessions.setMyPin(sC.id, "482913", assessorCtx), "NotFound");
  await sessions.setMyPin(s1.id, "482913", assessorCtx);
  const issued = await sessions.bundleFor(id1);
  const signed = issued.bundle!;
  const pub = createPublicKey(privateKey);
  check("the bundle verifies against the cloud key, for this session, with the member",
    verify(null, Buffer.from(canonical(signed.bundle)), pub, Buffer.from(signed.signature, "base64"))
      && signed.bundle.session.id === s1.id && signed.bundle.members.length === 1 && signed.bundle.members[0].email === assessor.email.toLowerCase());
  check("no PIN, token or plaintext in the bundle beyond the scrypt hash", /^scrypt\$32768\$8\$1\$/.test(signed.bundle.members[0].pinHash)
    && !JSON.stringify(signed).includes("482913"));
  const again = await sessions.bundleFor(id1, { contentHash: issued.contentHash, expiresAt: signed.bundle.expiresAt });
  check("an unchanged bundle is not re-signed", (again as { unchanged?: boolean }).unchanged === true);
  check("a device gets only its own session's bundle", (await sessions.bundleFor(id2)).bundle?.bundle.session.id === sC.id);

  console.log("\nSync: idempotent, ordered, owned");
  const t0 = "2026-10-28T15:00:00.000Z";
  const sessionPayload = { id: s1.id, label: s1.label, match_ref: matchA.id, mode: "shadow", created_utc: t0, created_by: assessor.id, ended_utc: null };
  const sessionItem = item("session", s1.id, 1, sessionPayload);
  const first = await sync.receive(id1, { deviceId: edge1, items: [sessionItem] });
  check("a provisioned session is applied", first.results[0]?.status === "applied", first.results);
  const replays = await Promise.all(Array.from({ length: 5 }, () => sync.receive(id1, { deviceId: edge1, items: [sessionItem] })));
  check("the same item five times at once: replayed every time, applied once",
    replays.every((r) => r.results[0]?.status === "replayed") && (await prisma.fairPlaySyncReceipt.count({ where: { idempotencyKey: sessionItem.idempotencyKey } })) === 1);
  const changed = { ...sessionItem, payload: { ...sessionPayload, label: "edited" }, payloadHash: hash({ ...sessionPayload, label: "edited" }) };
  check("the same key with other content is a conflict, and nothing is overwritten",
    (await sync.receive(id1, { deviceId: edge1, items: [changed] })).results[0]?.status === "conflict");
  const wrongMatch = item("session", s1.id, 2, { ...sessionPayload, match_ref: matchB.id });
  const wm = (await sync.receive(id1, { deviceId: edge1, items: [wrongMatch] })).results[0];
  check("a session reported for another match is rejected", wm?.status === "rejected" && /for match/.test(wm.message ?? ""), wm);
  const other = (await sync.receive(id2, { deviceId: edge2, items: [item("session", s1.id, 3, sessionPayload)] })).results[0];
  check("another device's token cannot send for this session", other?.status === "rejected", other);
  await refusedWith("a batch naming another Edge than its token is refused whole", () => sync.receive(id2, { deviceId: edge1, items: [] }), "DeviceMismatch");
  const unknownSession = (await sync.receive(id1, { deviceId: edge1, items: [item("session", randomUUID(), 1, { ...sessionPayload })] })).results[0];
  check("a session the cloud never provisioned is rejected", unknownSession?.status === "rejected");

  const rightsPayload = { id: randomUUID(), session_id: s1.id, footage_kind: "synthetic", status: "not_recorded", minors_present: "no",
    basis: null, consent_reference: null, recorded_by: assessor.id, recorded_name: "assessor", created_utc: t0, supersedes: null };
  const incidentId = randomUUID();
  const inc = (version: number, state: string, extra: Record<string, unknown> = {}) => ({ id: incidentId, session_id: s1.id, match_id: matchA.id,
    event_utc: "2026-10-28T15:23:10.000Z", basis: "manual", pre_roll_ms: 20000, post_roll_ms: 10000, category: "foul", note: "contact in the box",
    period: "first_half", match_minute: 23, match_second: 10, sheet_event_id: null, player_ref: "#7 home", observed_windows: null, state, version,
    hold_id: null, current_review_id: null, reopened_count: 0, created_by: assessor.id, created_utc: t0, updated_utc: t0, ...extra });
  const reviewId = randomUUID();
  const review = (version: number, state: string, extra: Record<string, unknown> = {}) => ({ id: reviewId, incident_id: incidentId, incident_version: 2,
    reviewer_id: assessor.id, reviewer_name: "Assessor", state, authority_mode: "shadow", on_field_decision: "play on", result: null,
    factual_notes: null, evidence_ids: null, footage_states: null, version, started_utc: t0, completed_at: null, superseded_by: null, superseded_reason: null, ...extra });
  const evidenceId = randomUUID();
  const clip = Buffer.from(`synthetic clip ${run}`.repeat(1000));
  const manifest = Buffer.from(JSON.stringify({ schema: "fairplay.evidence-manifest/v1", id: evidenceId }));
  const ev = (state: string, extra: Record<string, unknown> = {}) => ({ id: evidenceId, incident_id: incidentId, incident_version: 3, session_id: s1.id,
    source: "ground", job_id: randomUUID(), state, derivation: "copy", footage_kind: "synthetic", window_start_utc: "2026-10-28T15:22:50.000Z",
    window_duration_ms: 30000, coverage: "full", covered_ms: 30000, duration_ms: 30120, rel_path: `x/${evidenceId}.mp4`, bytes: clip.length,
    sha256: sha256Hex(clip), manifest_rel_path: `x/${evidenceId}.json`, manifest_sha256: sha256Hex(manifest), source_segment_ids: ["seg-1"],
    approved_by: null, approved_name: null, approved_utc: null, created_by: assessor.id, created_utc: t0, ...extra });
  const releasedEv = ev("approved", { approved_by: assessor.id, approved_name: "Assessor", approved_utc: "2026-10-28T16:00:00.000Z" });
  const segmentId = randomUUID();

  const batch = [
    item("rights", rightsPayload.id as string, 1, rightsPayload),
    item("segment", segmentId, 1, { schema: "fairplay.segment-manifest/v1", id: segmentId, state: "finalized" }),
    item("incident", incidentId, 1, inc(1, "flagged")),
    item("incident", incidentId, 2, inc(2, "reviewing", { current_review_id: reviewId })),
    item("review", reviewId, 1, review(1, "open")),
    item("review", reviewId, 2, review(2, "completed", { result: "supports_alternative", factual_notes: "Contact before the ball.", completed_at: "2026-10-28T15:59:00.000Z" })),
    item("incident", incidentId, 3, inc(3, "reviewed", { current_review_id: reviewId })),
    item("evidence", evidenceId, 1, ev("ready")),
    item("evidence", evidenceId, 2, releasedEv),
  ];
  const periodId = randomUUID();
  const period = item("period", periodId, 1, { id: periodId, session_id: s1.id, kind: "kickoff", period: "first_half", at_utc: t0 });
  const race = await Promise.all(Array.from({ length: 6 }, () => sync.receive(id1, { deviceId: edge1, items: [period] })));
  const statuses = race.map((r) => r.results[0]?.status).sort();
  check("a new item sent six times at once is applied exactly once", statuses.filter((s) => s === "applied").length === 1
    && statuses.filter((s) => s === "replayed").length === 5, statuses);
  const applied = (await sync.receive(id1, { deviceId: edge1, items: batch })).results;
  check("a whole match's records apply in order", applied.length === batch.length && applied.every((r) => r.status === "applied"), applied);
  const lateOld = item("incident", incidentId, 2, { ...inc(2, "reviewing"), note: "a resend with other content" });
  check("a different version-2 payload after version 3 is a conflict, not a rollback",
    (await sync.receive(id1, { deviceId: edge1, items: [lateOld] })).results[0]?.status === "conflict"
      && (await prisma.fairPlayIncident.findUniqueOrThrow({ where: { id: incidentId } })).state === "reviewed");
  const laterId = randomUUID();
  await sync.receive(id1, { deviceId: edge1, items: [item("incident", laterId, 3, { ...inc(3, "reviewed"), id: laterId })] });
  const stale = (await sync.receive(id1, { deviceId: edge1, items: [item("incident", laterId, 2, { ...inc(2, "reviewing"), id: laterId })] })).results[0];
  check("an older version arriving after a newer one is stale and ignored", stale?.status === "stale"
    && (await prisma.fairPlayIncident.findUniqueOrThrow({ where: { id: laterId } })).version === 3, stale);
  const officialId = randomUUID();
  const official = (await sync.receive(id1, { deviceId: edge1, items: [item("review", officialId, 1, { ...review(1, "open"), id: officialId, authority_mode: "official" })] })).results[0];
  check("a review claiming any authority but shadow is rejected", official?.status === "rejected" && /shadow/.test(official.message ?? ""), official);
  const swapped = (await sync.receive(id1, { deviceId: edge1, items: [item("evidence", evidenceId, 3, { ...releasedEv, sha256: "b".repeat(64) })] })).results[0];
  check("evidence whose file hash changes between versions is rejected", swapped?.status === "rejected", swapped);
  const segSteal = (await sync.receive(id2, { deviceId: edge2, items: [item("segment", segmentId, 2, { id: segmentId })] })).results[0];
  check("another device cannot overwrite this device's segment", segSteal?.status === "rejected", segSteal);
  const orphan = (await sync.receive(id2, { deviceId: edge2, items: [item("review", randomUUID(), 1, { ...review(1, "open"), incident_id: incidentId })] })).results[0];
  check("another device cannot attach a review to this device's incident", orphan?.status === "rejected", orphan);

  console.log("\nThe audit chain");
  let prev = "0".repeat(64);
  const entries = [1, 2, 3].map((seq) => {
    const detailText = canonical({ n: seq });
    const body = { seq, at_utc: t0, device_id: edge1, actor_id: assessor.id, actor_name: "Assessor", actor_kind: "operator", action: "incident.edited",
      entity_type: "incident", entity_id: incidentId, entity_version: seq, detail: detailText, prev_hash: prev };
    const entryHash = sha256Hex(canonical(body));
    const payload = { ...body, detail: { n: seq }, detail_text: detailText, entry_hash: entryHash };
    prev = entryHash;
    return item("audit", `${edge1}:${seq}`, 1, payload);
  });
  await sync.receive(id1, { deviceId: edge1, items: entries });
  const chain = await prisma.fairPlayEdgeAuditEntry.findMany({ where: { edgeDeviceId: edge1 }, orderBy: { seq: "asc" } });
  check("three linked entries recompute and chain: ok", chain.length === 3 && chain.every((e) => e.chainStatus === "ok"), chain.map((e) => e.chainStatus));
  const forged = { ...(entries[2].payload as Record<string, unknown>), seq: 4, detail_text: canonical({ n: 99 }), prev_hash: prev };
  await sync.receive(id1, { deviceId: edge1, items: [item("audit", `${edge1}:4`, 1, forged)] });
  const four = await prisma.fairPlayEdgeAuditEntry.findUniqueOrThrow({ where: { edgeDeviceId_seq: { edgeDeviceId: edge1, seq: 4 } } });
  check("an entry whose hash does not recompute is kept and flagged as a break", four.chainStatus === "break");
  check("the break is in the cloud audit log", (await prisma.fairPlayAuditLog.count({ where: { action: "sync.chain_break", targetId: `${edge1}:4` } })) === 1);
  const foreign = (await sync.receive(id1, { deviceId: edge1, items: [item("audit", `${edge2}:1`, 1, { ...(entries[0].payload as object), device_id: edge2 })] })).results[0];
  check("a device cannot send another device's audit entries", foreign?.status === "rejected", foreign);
  let refusedUpdate = false;
  try {
    await prisma.$executeRawUnsafe(`UPDATE fairplay_edge_audit_entries SET chain_status = 'ok' WHERE seq = 4`);
  } catch {
    refusedUpdate = true;
  }
  check("the database refuses to rewrite an audit entry", refusedUpdate);

  console.log("\nUploads: exact bytes, confirmed by hash, once");
  await refusedWith("a clip whose hash is not the synced one gets no URL",
    () => evidence.presign(id1, evidenceId, { kind: "clip", bytes: clip.length, sha256: "c".repeat(64) }), "HashMismatch");
  await refusedWith("a whole-match upload does not exist", () => evidence.presign(id1, evidenceId, { kind: "segment", bytes: 1, sha256: "a" }), "KindInvalid");
  await refusedWith("another device cannot upload this device's evidence",
    () => evidence.presign(id2, evidenceId, { kind: "clip", bytes: clip.length, sha256: sha256Hex(clip) }), "NotFound");
  const put = await evidence.presign(id1, evidenceId, { kind: "clip", bytes: clip.length, sha256: sha256Hex(clip) });
  check("a released clip gets a presigned PUT for its own key", !put.stored && put.key === `sessions/${s1.id}/evidence/${evidenceId}/clip.mp4`, put);
  let bucketRefused = false;
  try {
    store.put(put.key, Buffer.concat([clip, Buffer.from("tamper")]));
  } catch {
    bucketRefused = true;
  }
  check("the bucket refuses bytes that are not what was signed", bucketRefused);
  await refusedWith("confirming before the object exists is refused", () => evidence.confirm(id1, evidenceId, "clip"), "NotUploaded");
  store.put(put.key, clip);
  const confirmed = await evidence.confirm(id1, evidenceId, "clip");
  check("confirm checks size and SHA-256 and stores it, with its deletion date", confirmed.stored && Boolean(confirmed.deleteAfter));
  const after = new Date(confirmed.deleteAfter as Date).getTime() - new Date("2026-10-28T15:59:00.000Z").getTime();
  check("the deletion date is 90 days after the finding", after === 90 * 86_400_000, after / 86_400_000);
  const dup = await evidence.presign(id1, evidenceId, { kind: "clip", bytes: clip.length, sha256: sha256Hex(clip) });
  check("asking again for a stored clip uploads nothing", dup.stored === true);
  const mput = await evidence.presign(id1, evidenceId, { kind: "manifest", bytes: manifest.length, sha256: sha256Hex(manifest) });
  store.acceptAnything = true;
  store.put(mput.key, Buffer.from("not the manifest"));
  store.acceptAnything = false;
  await refusedWith("an object that is not intact is refused at confirm", () => evidence.confirm(id1, evidenceId, "manifest"), "UploadCorrupt");
  check("and removed from the bucket, with the reason recorded", !store.objects.has(mput.key) && store.removed.some((r) => r.key === mput.key && /corrupt/.test(r.reason))
    && (await prisma.fairPlayAuditLog.count({ where: { action: "upload.corrupt", targetId: evidenceId } })) === 1);
  await evidence.presign(id1, evidenceId, { kind: "manifest", bytes: manifest.length, sha256: sha256Hex(manifest) });
  store.put(mput.key, manifest);
  check("the next upload of it is stored", (await evidence.confirm(id1, evidenceId, "manifest")).stored === true);

  console.log("\nReads: permission, scope, release, audit");
  const read = await evidence.readUrl(evidenceId, "clip", "dispute from the home side", assessorCtx);
  check("a reviewer gets a read URL of at most five minutes", read.url.includes("ttl=300") && read.sha256 === sha256Hex(clip));
  check("the read is audited with its reason", (await prisma.fairPlayAuditLog.count({ where: { action: "evidence.read", targetId: evidenceId, reason: "dispute from the home side" } })) === 1);
  check("the competition's organiser may read released evidence", Boolean((await evidence.readUrl(evidenceId, "clip", undefined, orgC1)).url));
  await refusedWith("another competition's organiser cannot", () => evidence.readUrl(evidenceId, "clip", undefined, orgC2), "NotFound");
  await refusedWith("an unscoped organiser cannot", () => evidence.readUrl(evidenceId, "clip", undefined, orgUnscoped), "OrganiserUnscoped");
  await refusedWith("an operator, who flags but does not judge, cannot", () => evidence.readUrl(evidenceId, "clip", undefined, operatorCtx), "EvidenceNotPermitted");
  const report = await reports.report(s1.id, orgC1);
  const ri = report.incidents[0] as Record<string, unknown>;
  check("the organiser's report states the finding in its fixed words, with no operator note or player",
    (ri.finding as { statement?: string })?.statement === "The footage supports a different outcome from the on-field decision."
      && !("note" in ri) && !("playerRef" in ri) && /Shadow review only/.test(report.notice));
  check("the report has no field for a ruling or a score change", !/"(ruling|score|homeScore|awayScore|decision_override)"/.test(JSON.stringify(report)));
  await sync.receive(id1, { deviceId: edge1, items: [item("incident", incidentId, 4, inc(4, "reviewing", { reopened_count: 1 }))] });
  await refusedWith("reopening the incident withholds its evidence at once", () => evidence.readUrl(evidenceId, "clip", undefined, orgC1), "Withheld");
  check("and the organiser's report leaves it out", ((await reports.report(s1.id, orgC1)).incidents[0] as { evidence: unknown[] }).evidence.length === 0);
  await refusedWith("and nothing more of it is uploaded", () => evidence.presign(id1, evidenceId, { kind: "clip", bytes: clip.length, sha256: sha256Hex(clip) }), "NotReleasable");
  await sync.receive(id1, { deviceId: edge1, items: [item("incident", incidentId, 5, inc(5, "reviewed", { reopened_count: 1, current_review_id: reviewId }))] });

  const realId = randomUUID();
  const realIncident = randomUUID();
  await sync.receive(id1, { deviceId: edge1, items: [
    item("rights", realId, 1, { ...rightsPayload, id: realId, footage_kind: "real", status: "internal_review_only", created_utc: "2026-10-28T17:00:00.000Z" }),
    item("incident", realIncident, 1, { ...inc(1, "reviewed"), id: realIncident }),
  ] });
  await refusedWith("once the rights say real footage for internal review only, nothing is released",
    () => evidence.readUrl(evidenceId, "clip", undefined, assessorCtx), "Withheld");
  await sync.receive(id1, { deviceId: edge1, items: [item("rights", rightsPayload.id as string, 2, { ...rightsPayload, created_utc: "2026-10-28T18:00:00.000Z" })] });

  console.log("\nRetention and deleted matches");
  const swept = await evidence.sweep(new Date(Date.now() + 91 * 86_400_000));
  const objs = await prisma.fairPlayEvidenceObject.findMany({ where: { evidenceId } });
  check("90 days after the finding both objects are deleted, rows kept with hash and reason",
    swept.deleted === 2 && objs.every((o) => o.state === "deleted" && o.deleteReason?.includes("D10") && o.sha256.length === 64) && store.objects.size === 0);
  check("each deletion is audited", (await prisma.fairPlayAuditLog.count({ where: { action: "evidence.deleted", targetId: evidenceId } })) === 2);
  await refusedWith("a deleted clip cannot be read", () => evidence.readUrl(evidenceId, "clip", undefined, assessorCtx), "Deleted");
  await prisma.sbMatch.delete({ where: { id: matchA.id } });
  const orphaned = await reports.report(s1.id, admin);
  check("deleting the match keeps the session, its snapshot and its report", orphaned.session.matchStillExists === false
    && (orphaned.session.match as { home?: string }).home === "Lions" && orphaned.incidents.length === 3);

  console.log("\nRetiring a device");
  await devices.retire(d1.id, admin);
  await refusedWith("a retired device's token stops working at once", () => devices.verify(reg1.deviceToken), "DeviceTokenInvalid");

  const usage = await reports.usage();
  check("usage counts what the bucket holds and what was asked of it", usage.objects === 0 && usage.deletedObjects === 2 && usage.thisMonth.uploads >= 3, usage);

  console.log(`\n${passed}/${passed + failures.length} passed${failures.length ? ` — FAILED: ${failures.join("; ")}` : ""}`);
  process.exitCode = failures.length ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
