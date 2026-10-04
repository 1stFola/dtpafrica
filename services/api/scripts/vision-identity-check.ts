/**
 * Phase 4 Increment 4 gate — who a track is: a roster, a window, two people.
 *
 *   pnpm --filter @dtp/api vision:identitycheck
 *
 * Needs the API on :3000 (`VISION_E2E_API`), whatever `DATABASE_URL` points at
 * (never production) holding at least one ScoreBoard match with squad players on
 * both teams, the object store the API is configured with, and the seeded
 * `vision_reviewer` and `vision_admin` roles. The gate creates two signed-in
 * people and an asset of that match with four tracks the kit clustering has
 * already sided -- two on A, one on B, one it could not say.
 *
 * Four claims are on trial:
 *
 *   1. Which team a side is, is decided by a person, for the match's own two
 *      teams, one each.
 *   2. A track's candidates are its side's match squad, or the whole squad when
 *      nothing narrows it.
 *   3. An identity is a person's word for a window of a track: inside the track,
 *      on the roster, on the side unless the person overrules the kit; a new
 *      window supersedes what it overlaps (a split), the same person reaches
 *      other tracks as propagated rows (a merge), and unknown is a null that is
 *      never propagated.
 *   4. A second person accepts, the first cannot, and only an accepted, named,
 *      current assignment is readable as public.
 */
import { randomBytes, randomUUID } from "node:crypto";
import * as bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";
import { VISION_CONTRACT_VERSION, visionKeys } from "@dtp/vision-contracts";
import { loadApiEnv } from "../src/shared/load-dotenv";
import { assertDevDatabase, closeGate, createGateMatch, onInterrupt, removeGateMatch, type GateMatch } from "./gate-harness";

loadApiEnv();

const API = process.env.VISION_E2E_API ?? "http://localhost:3000/api/v1";
const prisma = new PrismaClient();
const RUN = randomUUID().slice(0, 8);

let checks = 0;
let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(68)} ${ok ? String(actual) : `expected ${expected}, got ${actual}`}`);
}
function section(t: string) {
  console.log(`\n${t}\n${"-".repeat(t.length)}`);
}
function adminHeaders(): Record<string, string> {
  const key = process.env.ADMIN_API_KEY?.trim();
  if (!key) throw new Error("ADMIN_API_KEY is not set");
  return { "x-admin-api-key": key, "Content-Type": "application/json" };
}
type Reply = { status: number; body: Record<string, any> };
async function call(path: string, headers: Record<string, string>, init?: RequestInit): Promise<Reply> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { "Content-Type": "application/json", ...headers } });
  const text = await res.text();
  let body: Record<string, any> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  return { status: res.status, body };
}
const api = (path: string, init?: RequestInit) => call(path, adminHeaders(), init);
const as = (token: string) => ({
  get: (path: string) => call(path, { Authorization: `Bearer ${token}` }),
  post: (path: string, body: unknown) => call(path, { Authorization: `Bearer ${token}` }, { method: "POST", body: JSON.stringify(body) }),
});

type Fixture = { partnerId: string; assetId: string; jobIds: string[]; trackIds: string[]; userIds: string[] };

/** A signed-in person with a seeded vision role; the credential exists only for this run. */
async function person(fx: Fixture, roleSlug: string, label: string): Promise<{ id: string; token: string }> {
  const role = await prisma.adminRole.findUnique({ where: { slug: roleSlug }, select: { id: true } });
  if (!role) throw new Error(`Role ${roleSlug} is not seeded; run the RBAC seed first`);
  const email = `gate-${label}-${RUN}@example.test`;
  const oneTimeCredential = randomBytes(24).toString("hex");
  const user = await prisma.adminUser.create({
    data: { email, name: `Gate ${label} ${RUN}`, passwordHash: await bcrypt.hash(oneTimeCredential, 4), roleId: role.id, isActive: true, allCompetitions: true },
  });
  fx.userIds.push(user.id);
  const login = await call("/admin/auth/login", {}, { method: "POST", body: JSON.stringify({ email, password: oneTimeCredential }) });
  if (!login.body.token) throw new Error(`login failed for ${label}: ${JSON.stringify(login.body).slice(0, 200)}`);
  return { id: user.id, token: String(login.body.token) };
}

/* The gate's own match: a competition, two teams, squads of real `Player` rows, 45-minute
   halves and no events. It used to pick a match somebody had recorded and write into it
   (docs/vision/50, appendix E). Held here, not on the fixture, so it is removed even when
   the run fails before the fixture exists. */
let gateMatch: GateMatch | null = null;
async function matchWithSquads() {
  gateMatch = await createGateMatch(prisma, RUN);
  return gateMatch;
}

async function seed(match: Awaited<ReturnType<typeof matchWithSquads>>): Promise<Fixture> {
  const partner = await prisma.visionSourcePartner.create({ data: { name: `Identity gate ${RUN}`, contactEmail: "gate@example.test" } });
  const record = await prisma.visionSourceVideoRecord.create({
    data: { partnerId: partner.id, title: `Identity gate record ${RUN}`, sourceQualityRank: "broadcast", originalAvailable: true, acquisitionStatus: "acquired", acquisitionMethod: "partner_direct_upload" },
  });
  await prisma.visionRightsScope.create({
    data: { partnerId: partner.id, grantLevel: "partner", canAnalyze: true, canTrain: true, canPublishHighlight: false, canShareWithScout: false, grantedAt: new Date() },
  });
  const asset = await prisma.visionVideoAsset.create({
    data: {
      sourceVideoRecordId: record.id, sbMatchId: match.id, corpus: "dtp_owned", objectKey: `originals/gate-${RUN}-identity/source.mp4`, bytes: BigInt(1024), mimeType: "video/mp4",
      checksumSha256: randomUUID().replace(/-/g, "").padEnd(64, "0").slice(0, 64), width: 1280, height: 720, durationMs: 120_000, ingestState: "ready",
    },
  });
  const jobIds: string[] = [];
  const job = async (type: string, extra: Record<string, unknown> = {}) => {
    const id = randomUUID();
    jobIds.push(id);
    await prisma.visionJob.create({
      data: { id, type, resourceClass: "cpu_small", state: "succeeded", videoAssetId: asset.id, inputSpec: {}, outputPrefix: visionKeys.inferencePrefix(id, 1), budgetSeconds: 600, budgetUsdCents: 100, contractVersion: VISION_CONTRACT_VERSION, finishedAt: new Date(), ...extra },
    });
    return id;
  };
  await job("transcode");
  await job("detect");
  const trackJob = await job("track");
  const identifyJob = await job("identify");
  const trackIds: string[] = [];
  for (let i = 1; i <= 4; i += 1) {
    const t = await prisma.visionTrack.create({
      data: { videoAssetId: asset.id, inferenceJobId: trackJob, localTrackId: i, class: "player", startMs: 9000 + (i - 1) * 20_000, endMs: 19000 + (i - 1) * 20_000, startFrame: 0, endFrame: 250, detectionCount: 250, confirmed: true, artifactKey: `${visionKeys.inferencePrefix(trackJob, 1)}tracks.json` },
    });
    trackIds.push(t.id);
  }
  const sides: (string | null)[] = ["A", "A", "B", null];
  await prisma.visionTeamAssignment.createMany({
    data: trackIds.map((trackId, i) => ({ trackId, inferenceJobId: identifyJob, team: sides[i], confidence: sides[i] ? 0.9 : 0.02, method: "kit_cluster", kitDescription: sides[i] === "A" ? "red" : sides[i] === "B" ? "blue" : null, identifyVersionId: null })),
  });
  return { partnerId: partner.id, assetId: asset.id, jobIds, trackIds, userIds: [] };
}

async function cleanup(fx: Fixture | null) {
  if (!fx) {
    await removeGateMatch(prisma, gateMatch);
    return;
  }
  // Identities and sides cascade with tracks and jobs, which cascade with the asset.
  await prisma.visionVideoAsset.deleteMany({ where: { id: fx.assetId } });
  await prisma.visionAuditLog.deleteMany({ where: { OR: [{ actorId: { in: fx.userIds } }, { targetId: { in: [...fx.jobIds, ...fx.trackIds, fx.assetId] } }] } });
  await prisma.adminUser.deleteMany({ where: { id: { in: fx.userIds } } });
  await prisma.visionRightsScope.deleteMany({ where: { partnerId: fx.partnerId } });
  await prisma.visionSourceVideoRecord.deleteMany({ where: { partnerId: fx.partnerId } });
  await prisma.visionSourcePartner.deleteMany({ where: { id: fx.partnerId } });
  await removeGateMatch(prisma, gateMatch);
}

async function main() {
  assertDevDatabase({ api: API });
  console.log("Vision identity — a roster, a window, two people");
  console.log(`  api ${API}`);
  console.log(`  run ${RUN}`);

  let fx: Fixture | null = null;
  onInterrupt(async () => {
    await cleanup(fx);
    await closeGate(prisma);
  });
  try {
    const match = await matchWithSquads();
    fx = await seed(match);
    const [t1, t2, t3, t4] = fx.trackIds as [string, string, string, string];
    const identifyJob = fx.jobIds[3]!;
    const trackJob = fx.jobIds[2]!;
    const homeSlots = match.squadPlayers.filter((s) => s.teamId === match.homeTeamId);
    const awaySlots = match.squadPlayers.filter((s) => s.teamId === match.awayTeamId);
    const h1 = homeSlots.find((s) => s.playerId)!;
    const h2 = homeSlots.find((s) => s.playerId && s.id !== h1.id)!;
    const a1 = awaySlots.find((s) => s.playerId)!;
    console.log(`  match ${match.id}: ${homeSlots.length} home slots, ${awaySlots.length} away slots`);

    const reviewer = await person(fx, "vision_reviewer", "reviewer");
    const admin = await person(fx, "vision_admin", "admin");
    const R = as(reviewer.token);
    const S = as(admin.token);

    // ── 1. Sides ─────────────────────────────────────────────────────────
    section("1. Which team a side is, is a person's decision about the match's own teams");

    const keyed = await api(`/vision/review/jobs/${identifyJob}/sides`, { method: "POST", body: JSON.stringify({ A: match.homeTeamId, B: match.awayTeamId }) });
    check("the operator key cannot decide: refused", keyed.body.error, "IdentityNeedsAPerson");
    const wrongJob = await R.post(`/vision/review/jobs/${trackJob}/sides`, { A: match.homeTeamId, B: match.awayTeamId });
    check("sides belong to an identify job, not a track job", wrongJob.body.error, "NotAnIdentifyJob");
    const same = await R.post(`/vision/review/jobs/${identifyJob}/sides`, { A: match.homeTeamId, B: match.homeTeamId });
    check("the same team on both sides: refused", same.body.error, "SidesSame");
    const foreign = await R.post(`/vision/review/jobs/${identifyJob}/sides`, { A: match.homeTeamId, B: randomUUID() });
    check("a team not in the match: refused", foreign.body.error, "SidesNotTheMatch");
    const decided = await R.post(`/vision/review/jobs/${identifyJob}/sides`, { A: match.homeTeamId, B: match.awayTeamId });
    check("A is home and B is away", `${decided.status}:${decided.body.sides?.A === match.homeTeamId}:${decided.body.sides?.B === match.awayTeamId}`, "201:true:true");
    check("…decided by the reviewer", decided.body.decidedBy, reviewer.id);

    const review = await R.get(`/vision/review/${fx.assetId}/tracks`);
    check("the review view lists the four tracks", review.body.count, 4);
    check("…with both sides decided", review.body.sidesDecided?.length, 2);
    const byId = new Map<string, any>((review.body.tracks ?? []).map((t: any) => [t.id, t]));
    check("a side-A track resolves to the home team", byId.get(t1)?.sbTeamId, match.homeTeamId);
    check("a side-B track to the away team", byId.get(t3)?.sbTeamId, match.awayTeamId);
    check("a track the kit could not side resolves to no team", byId.get(t4)?.sbTeamId, null);

    // ── 2. Candidates ────────────────────────────────────────────────────
    section("2. Who a track could be");

    const c1 = await R.get(`/vision/review/tracks/${t1}/candidates`);
    check("a sided track's candidates are its team's match squad", c1.body.narrowedBy, "side");
    check("…all of them", c1.body.candidates?.length, homeSlots.length);
    check("…and only them", (c1.body.candidates ?? []).every((c: any) => c.sbTeamId === match.homeTeamId), true);
    const c4 = await R.get(`/vision/review/tracks/${t4}/candidates`);
    check("an unsided track's candidates are the whole match squad", c4.body.narrowedBy, "match");
    check("…both teams", c4.body.candidates?.length, match.squadPlayers.length);
    check("the clock caveat is stated", String(c4.body.clock ?? "").includes("not anchored"), true);

    // ── 3. Assign ────────────────────────────────────────────────────────
    section("3. An identity is a person's word for a window of a track");

    const keyedAssign = await api(`/vision/review/tracks/${t1}/identity`, { method: "POST", body: JSON.stringify({ matchSquadPlayerId: h1.id }) });
    check("the operator key cannot name anyone", keyedAssign.body.error, "IdentityNeedsAPerson");
    const outside = await R.post(`/vision/review/tracks/${t1}/identity`, { matchSquadPlayerId: h1.id, validFromMs: 8000 });
    check("a window outside the track: refused", outside.body.error, "WindowOutsideTrack");
    const empty = await R.post(`/vision/review/tracks/${t1}/identity`, { matchSquadPlayerId: h1.id, validFromMs: 12000, validToMs: 12000 });
    check("an empty window: refused", empty.body.error, "WindowEmpty");
    const stranger = await R.post(`/vision/review/tracks/${t1}/identity`, { matchSquadPlayerId: randomUUID() });
    check("a slot not on this match: refused", stranger.body.error, "NotOnThisMatchSquad");

    const awayOnA = await R.post(`/vision/review/tracks/${t1}/identity`, { matchSquadPlayerId: a1.id });
    check("an away player on a home-sided track: refused", awayOnA.body.error, "SideDisagrees");
    const overruled = await R.post(`/vision/review/tracks/${t1}/identity`, { matchSquadPlayerId: a1.id, acceptSideMismatch: true });
    check("…unless the person overrules the kit", overruled.status, 201);
    check("…which marks the kit's side corrected, not erased", (await prisma.visionTeamAssignment.findFirst({ where: { trackId: t1 } }))?.reviewState, "corrected");
    check("…with the kit's own answer still on the row", (await prisma.visionTeamAssignment.findFirst({ where: { trackId: t1 } }))?.team, "A");

    const whole = await R.post(`/vision/review/tracks/${t1}/identity`, { matchSquadPlayerId: h1.id });
    check("a home player over the whole track", whole.status, 201);
    check("…names the player", whole.body.assignment?.playerId, h1.playerId);
    check("…over the track's window", `${whole.body.assignment?.validFromMs}-${whole.body.assignment?.validToMs}`, "9000-19000");
    check("…unreviewed, by the reviewer", `${whole.body.assignment?.reviewState}/${whole.body.assignment?.decidedBy === reviewer.id}`, "unreviewed/true");
    check("…and supersedes the overruled one", (await prisma.visionIdentityAssignment.findUnique({ where: { id: overruled.body.assignment.id } }))?.supersededBy, whole.body.assignment?.id);

    const first = await R.post(`/vision/review/tracks/${t1}/identity`, { matchSquadPlayerId: h1.id, validFromMs: 9000, validToMs: 14000 });
    const secondHalf = await R.post(`/vision/review/tracks/${t1}/identity`, { matchSquadPlayerId: h2.id, validFromMs: 14000, validToMs: 19000 });
    check("a split: two windows, two people", `${first.status}/${secondHalf.status}`, "201/201");
    const current = await prisma.visionIdentityAssignment.findMany({ where: { trackId: t1, supersededBy: null }, orderBy: { validFromMs: "asc" } });
    check("…leaves two current assignments on the track", current.length, 2);
    check("…in order", `${current[0]?.playerId === h1.playerId}/${current[1]?.playerId === h2.playerId}`, "true/true");
    check("…and the whole-track one superseded", (await prisma.visionIdentityAssignment.findUnique({ where: { id: whole.body.assignment.id } }))?.supersededBy !== null, true);

    const mergeWrongSide = await R.post(`/vision/review/tracks/${t2}/identity`, { matchSquadPlayerId: h1.id, propagateTo: [t3] });
    check("a merge onto an away-sided track: refused by the same rule", mergeWrongSide.body.error, "SideDisagrees");
    const merged = await R.post(`/vision/review/tracks/${t2}/identity`, { matchSquadPlayerId: h1.id, propagateTo: [t4] });
    check("a merge onto an unsided track", merged.status, 201);
    check("…writes a propagated row there", `${merged.body.propagated?.[0]?.trackId === t4}/${merged.body.propagated?.[0]?.method}`, "true/propagated");
    check("…over that track's own window", `${merged.body.propagated?.[0]?.validFromMs}-${merged.body.propagated?.[0]?.validToMs}`, "69000-79000");
    const badTarget = await R.post(`/vision/review/tracks/${t2}/identity`, { matchSquadPlayerId: h1.id, propagateTo: [randomUUID()] });
    check("a merge onto a track that does not exist: refused", badTarget.body.error, "PropagateTargetInvalid");

    const unknownSpread = await R.post(`/vision/review/tracks/${t3}/identity`, { matchSquadPlayerId: null, propagateTo: [t4] });
    check("unknown is never propagated", unknownSpread.body.error, "PropagateUnknownRefused");
    const unknown = await R.post(`/vision/review/tracks/${t3}/identity`, { matchSquadPlayerId: null, note: "back turned throughout" });
    check("unknown is recorded as a null player", `${unknown.status}/${unknown.body.assignment?.playerId}`, "201/null");

    // ── 4. Two people ────────────────────────────────────────────────────
    section("4. A second person accepts; only that is public");

    const firstId = String(first.body.assignment.id);
    const selfAccept = await R.post(`/vision/review/identity/${firstId}/accept`, {});
    check("the person who assigned cannot accept", selfAccept.body.error, "SelfAcceptanceRefused");
    const accepted = await S.post(`/vision/review/identity/${firstId}/accept`, {});
    check("a second person accepts", `${accepted.status}/${accepted.body.reviewState}`, "201/accepted");
    check("…and is recorded", accepted.body.reviewedBy, admin.id);
    const stale = await S.post(`/vision/review/identity/${whole.body.assignment.id}/accept`, {});
    check("a superseded assignment cannot be accepted", stale.body.error, "AssignmentSuperseded");
    const rejected = await S.post(`/vision/review/identity/${unknown.body.assignment.id}/reject`, { reason: "the number is visible at 12s" });
    check("a rejection keeps its reason", String(rejected.body.note ?? "").includes("the number is visible"), true);

    const pub = await api(`/vision/assets/${fx.assetId}/identity?public=1`);
    check("the public view lists only tracks with an accepted, named identity", pub.body.count, 1);
    check("…the accepted window", `${pub.body.tracks?.[0]?.identities?.[0]?.validFromMs}-${pub.body.tracks?.[0]?.identities?.[0]?.validToMs}`, "9000-14000");
    check("…and nothing unreviewed, propagated, rejected or unknown", (pub.body.tracks ?? []).flatMap((t: any) => t.identities).length, 1);
    check("…and says how many there are in all, and that this is all of them", `${pub.body.total}/${pub.body.truncated}/${pub.body.trackJobId}`, "1/false/null");
    /* The review view: one track run, a page at a time (docs/vision/60). */
    const paged = await R.get(`/vision/review/${fx.assetId}/tracks?limit=3`);
    check("a page of the review view says it is short", `${paged.body.count}/${paged.body.total}/${paged.body.truncated}`, "3/4/true");
    const rest = await R.get(`/vision/review/${fx.assetId}/tracks?limit=3&offset=3`);
    check("…and the next page is the rest", `${rest.body.count}/${rest.body.truncated}`, "1/false");
    check("…of the one track run the footage has", `${paged.body.trackJobs}/${typeof paged.body.trackJobId}`, "1/string");
    const otherRun = await R.get(`/vision/review/${fx.assetId}/tracks?job=${randomUUID()}`);
    check("a run that is not this footage's has no tracks", `${otherRun.status}/${otherRun.body.count}/${otherRun.body.total}`, "200/0/0");
    const all = await R.get(`/vision/review/${fx.assetId}/tracks`);
    check("the review view shows every current assignment", (all.body.tracks ?? []).flatMap((t: any) => t.identities).length, 5);

    const audit = await prisma.visionAuditLog.groupBy({ by: ["action"], where: { actorId: { in: [reviewer.id, admin.id] } }, _count: { _all: true } });
    const count = (a: string) => audit.find((r) => r.action === a)?._count._all ?? 0;
    check("the audit trail: one side decision", count("identity.sides.decided"), 1);
    check("…every assignment (six calls; a merge is one)", count("identity.assigned"), 6);
    check("…one acceptance and one rejection", `${count("identity.accepted")}/${count("identity.rejected")}`, "1/1");

    /* The audit screen's route (docs/vision/69). It has its own permission: the trail names who
       read raw footage and who named a player, and `vision.read` does not open it. */
    /* The seed gives a role its defaults only when it creates it, so that what an admin granted or
       revoked survives. A database seeded before this permission existed has to be told. */
    const held = await prisma.adminRole.count({ where: { slug: "vision_admin", permissions: { some: { permission: { slug: "vision.audit.read" } } } } });
    check("the Vision admin role holds vision.audit.read (if not: grant it in Settings, Roles, as on any database seeded before docs/vision/69)", held, 1);
    const closed = await R.get("/vision/audit");
    check("a reviewer cannot read the audit trail", `${closed.status}`, "403");
    const noSession = await call("/vision/audit", {});
    check("…nor can nobody", noSession.status, 401);
    const reviewerRows = await prisma.visionAuditLog.count({ where: { actorId: reviewer.id } });
    const theirs = await S.get(`/vision/audit?actor=${reviewer.id}&limit=200`);
    const theirRows = (theirs.body.items ?? []) as { id: string; actorId: string; actorEmail: string | null; actorMethod: string; action: string; createdAt: string }[];
    check("a Vision admin reads it: what the reviewer did, by their id", `${theirs.status}/${theirs.body.matching}/${theirRows.length}`, `200/${reviewerRows}/${reviewerRows}`);
    check("…every row theirs, signed in, with an email", theirRows.every((r) => r.actorId === reviewer.id && r.actorMethod === "jwt" && Boolean(r.actorEmail)), true);
    check("…newest first", theirRows.map((r) => r.createdAt).join(), [...theirRows.map((r) => r.createdAt)].sort().reverse().join());
    check("…and it says what the filters may be", `${(theirs.body.facets?.actions ?? []).includes("identity.assigned")}/${(theirs.body.facets?.targetKinds ?? []).includes("vision_track")}`, "true/true");
    const byEmail = await S.get(`/vision/audit?actor=${encodeURIComponent(String(theirRows[0]?.actorEmail ?? "").toUpperCase())}`);
    check("found by email too, whatever its case", byEmail.body.matching, theirs.body.matching);
    const family = await S.get(`/vision/audit?action=identity.&actor=${reviewer.id}`);
    check("a family of actions: only identity rows", ((family.body.items ?? []) as { action: string }[]).every((r) => r.action.startsWith("identity.")) && family.body.matching > 0 && family.body.matching <= theirs.body.matching, true);
    const one = await S.get(`/vision/audit?action=identity.accepted&actor=${admin.id}`);
    check("one action: the one acceptance, which the second person made", `${one.body.matching}/${one.body.items?.[0]?.action}`, "1/identity.accepted");
    /* Walked a row at a time, the pages are the whole answer once each, in the same order. */
    const walked: string[] = [];
    let cursor = "";
    for (let i = 0; i < 100; i += 1) {
      const page = await S.get(`/vision/audit?actor=${reviewer.id}&limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      walked.push(...((page.body.items ?? []) as { id: string }[]).map((r) => r.id));
      if (i > 0 && page.body.matching !== undefined) throw new Error("a later page counted the table again");
      if (!page.body.nextCursor) break;
      cursor = String(page.body.nextCursor);
    }
    check("paged two at a time: every row once, in order", walked.join(), theirRows.map((r) => r.id).join());
    const day = new Date().toISOString().slice(0, 10);
    const today = await S.get(`/vision/audit?actor=${reviewer.id}&from=${day}T00:00:00Z`);
    const tomorrow = await S.get(`/vision/audit?actor=${reviewer.id}&from=${new Date(Date.now() + 86_400_000).toISOString()}`);
    check("by time: all of it since midnight, none of it from tomorrow", `${today.body.matching === theirs.body.matching}/${tomorrow.body.matching}`, "true/0");
    const badFilter = await S.get("/vision/audit?from=yesterday");
    check("a filter it cannot read is refused by name, not dropped", `${badFilter.status}/${badFilter.body.error}/${badFilter.body.field}/${typeof badFilter.body.remediation}`, "400/AuditFilterInvalid/from/string");
    const before = await prisma.visionAuditLog.count();
    await S.get("/vision/audit?limit=1");
    check("reading the trail writes nothing to it", await prisma.visionAuditLog.count(), before);

    // ── 5. Decided once; sides not swapped quietly; an overlap keeps the rest (docs/vision/57) ──
    section("5. A decision is made once, sides are not swapped quietly, and a partial overlap keeps what it does not cover");

    const flip = await S.post(`/vision/review/identity/${firstId}/reject`, { reason: "changed my mind" });
    check("an accepted identity is not flipped to rejected in place", `${flip.status}/${flip.body.error}`, "409/AlreadyDecided");
    const unflip = await S.post(`/vision/review/identity/${unknown.body.assignment.id}/accept`, {});
    check("nor a rejected one accepted", `${unflip.status}/${unflip.body.error}`, "409/AlreadyDecided");
    const still = await prisma.visionIdentityAssignment.findUnique({ where: { id: firstId }, select: { reviewState: true, reviewedBy: true } });
    check("…and the accepted row is as it was", `${still?.reviewState}/${still?.reviewedBy === admin.id}`, "accepted/true");

    const swapped = await R.post(`/vision/review/jobs/${identifyJob}/sides`, { A: match.awayTeamId, B: match.homeTeamId });
    check("sides already decided are not swapped by a second answer", `${swapped.status}/${swapped.body.error}/${swapped.body.current?.A === match.homeTeamId}`, "409/SidesAlreadyDecided/true");
    const sameAgain = await R.post(`/vision/review/jobs/${identifyJob}/sides`, { A: match.homeTeamId, B: match.awayTeamId });
    check("the same answer again is not a change", sameAgain.status, 201);
    const onPurpose = await R.post(`/vision/review/jobs/${identifyJob}/sides`, { A: match.awayTeamId, B: match.homeTeamId, override: true });
    check("with override they change, and the audit keeps what they were", `${onPurpose.status}/${onPurpose.body.sides?.A === match.awayTeamId}`, "201/true");
    const changed = await prisma.visionAuditLog.findFirst({ where: { action: "identity.sides.changed", targetId: identifyJob }, select: { data: true } });
    check("…as A and B before", `${(changed?.data as any)?.previous?.A === match.homeTeamId}/${(changed?.data as any)?.previous?.B === match.awayTeamId}`, "true/true");
    await R.post(`/vision/review/jobs/${identifyJob}/sides`, { A: match.homeTeamId, B: match.awayTeamId, override: true });

    // h1 is accepted and public on track 1 for 9000-14000. The reviewer now says who it was for one second in the middle.
    const middle = await R.post(`/vision/review/tracks/${t1}/identity`, { matchSquadPlayerId: h2.id, validFromMs: 11000, validToMs: 12000 });
    check("an identity for one second in the middle of an accepted window", middle.status, 201);
    const nowCurrent = await prisma.visionIdentityAssignment.findMany({ where: { trackId: t1, supersededBy: null }, orderBy: { validFromMs: "asc" }, select: { validFromMs: true, validToMs: true, matchSquadPlayerId: true, reviewState: true, reviewedBy: true } });
    check("…leaves the accepted identity either side of it, still accepted, still the second person's", nowCurrent.map((r) => `${r.validFromMs}-${r.validToMs}:${r.matchSquadPlayerId === h1.id ? "h1" : "h2"}:${r.reviewState}`).join(" "), "9000-11000:h1:accepted 11000-12000:h2:unreviewed 12000-14000:h1:accepted 14000-19000:h2:unreviewed");
    check("…carrying who accepted it", nowCurrent.filter((r) => r.reviewState === "accepted").every((r) => r.reviewedBy === admin.id), true);
    const pubAfter = await api(`/vision/assets/${fx.assetId}/identity?public=1`);
    const windows = (pubAfter.body.tracks ?? []).flatMap((t: any) => t.identities).map((i: any) => `${i.validFromMs}-${i.validToMs}`).sort();
    check("the public view still names him for the two stretches nobody spoke about, and not for the second in between", windows.join(","), "12000-14000,9000-11000");
    const old = await prisma.visionIdentityAssignment.findUnique({ where: { id: firstId }, select: { supersededBy: true } });
    check("…and the original row says what superseded it", old?.supersededBy === middle.body.assignment?.id, true);
  } catch (error) {
    failures += 1;
    console.error("\nGate aborted:", error);
  } finally {
    await cleanup(fx).catch((e) => console.error("cleanup failed:", e));
    await closeGate(prisma);
  }

  console.log(`\n${checks - failures}/${checks} checks passed${failures ? ` — ${failures} FAILED` : ""}`);
  process.exitCode = failures ? 1 : 0;
}

void main();
