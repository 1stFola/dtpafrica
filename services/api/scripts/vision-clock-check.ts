/**
 * Phase 5 Increment 4 gate — the match clock anchored to the footage, and the
 * roster finally told the time.
 *
 *   pnpm --filter @dtp/api vision:clockcheck
 *
 * Needs the API on :3000 (`VISION_E2E_API`), whatever `DATABASE_URL` points at
 * (never production) holding a ScoreBoard match with squad players on the home
 * side, and the seeded `vision_reviewer` role. The gate writes one substitution
 * on that match for the run and removes it after.
 *
 * Three claims are on trial:
 *
 *   1. A person anchors each half's kick-off (and end) inside the footage, in
 *      order; the operator key cannot; a new anchor supersedes.
 *   2. Any source millisecond reads on the match clock the broadcast way --
 *      12:30, between halves, 47:12 -- and any track window does too.
 *   3. With the clock anchored, a track's candidates are the players on the
 *      pitch for its window: the starter taken off at 60' is not a candidate
 *      at 70', the substitute is not one at 10', and a window across the change
 *      lists both as partly.
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
const post = (path: string, body: unknown) => api(path, { method: "POST", body: JSON.stringify(body) });

type Fixture = { partnerId: string; assetId: string; jobIds: string[]; userIds: string[]; eventIds: string[] };

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

async function cleanup(fx: Fixture | null) {
  if (!fx) {
    await removeGateMatch(prisma, gateMatch);
    return;
  }
  await prisma.sbMatchEvent.deleteMany({ where: { id: { in: fx.eventIds } } });
  await prisma.visionVideoAsset.deleteMany({ where: { id: fx.assetId } });
  await prisma.visionAuditLog.deleteMany({ where: { OR: [{ actorId: { in: fx.userIds } }, { targetId: { in: [...fx.jobIds, fx.assetId] } }] } });
  await prisma.adminUser.deleteMany({ where: { id: { in: fx.userIds } } });
  await prisma.visionRightsScope.deleteMany({ where: { partnerId: fx.partnerId } });
  await prisma.visionSourceVideoRecord.deleteMany({ where: { partnerId: fx.partnerId } });
  await prisma.visionSourcePartner.deleteMany({ where: { id: fx.partnerId } });
  await removeGateMatch(prisma, gateMatch);
}

/* Kick-off nine seconds into the file; the first half ends at 45:00; the second kicks off at 50:00 of file time. */
const KICKOFF_1 = 9000;
const END_1 = KICKOFF_1 + 45 * 60_000;
const KICKOFF_2 = 3_000_000;
const minute1 = (m: number) => KICKOFF_1 + m * 60_000;
const minute2 = (m: number) => KICKOFF_2 + (m - 45) * 60_000;

async function main() {
  assertDevDatabase({ api: API });
  console.log("Vision clock — the match clock anchored to the footage");
  console.log(`  api ${API}`);
  console.log(`  run ${RUN}`);

  let fx: Fixture | null = null;
  onInterrupt(async () => {
    await cleanup(fx);
    await closeGate(prisma);
  });
  try {
    const match = await matchWithSquads();
    const home = match.squadPlayers.filter((s) => s.teamId === match.homeTeamId && s.playerId && s.jerseyNumber !== null);
    // Youth squads reuse numbers; the recorder names the incoming player by number, so the
    // two players this gate moves must each be the only one of their number on the side.
    const uniqueNumber = (s: { jerseyNumber: number | null }) => home.filter((o) => o.jerseyNumber === s.jerseyNumber).length === 1;
    const starterOff = home.find((s) => s.isStarter && uniqueNumber(s))!;
    const starterOn = home.find((s) => s.isStarter && s.id !== starterOff.id)!;
    const sub = home.find((s) => !s.isStarter && uniqueNumber(s))!;
    if (!starterOff || !starterOn || !sub) throw new Error("The match has no uniquely numbered home starter and substitute");

    const partner = await prisma.visionSourcePartner.create({ data: { name: `Clock gate ${RUN}`, contactEmail: "gate@example.test" } });
    fx = { partnerId: partner.id, assetId: "", jobIds: [], userIds: [], eventIds: [] };
    const record = await prisma.visionSourceVideoRecord.create({
      data: { partnerId: partner.id, title: `Clock gate record ${RUN}`, sourceQualityRank: "broadcast", originalAvailable: true, acquisitionStatus: "acquired", acquisitionMethod: "partner_direct_upload" },
    });
    await prisma.visionRightsScope.create({
      data: { partnerId: partner.id, grantLevel: "partner", canAnalyze: true, canTrain: true, canPublishHighlight: false, canShareWithScout: false, grantedAt: new Date() },
    });
    const asset = await prisma.visionVideoAsset.create({
      data: {
        sourceVideoRecordId: record.id, sbMatchId: match.id, corpus: "dtp_owned", objectKey: `originals/gate-${RUN}-clock/source.mp4`, bytes: BigInt(1024), mimeType: "video/mp4",
        checksumSha256: randomUUID().replace(/-/g, "").padEnd(64, "0").slice(0, 64), width: 1280, height: 720, durationMs: 6_000_000, ingestState: "ready",
      },
    });
    fx.assetId = asset.id;
    // The substitution for this run: the starter off for the substitute at 60', as the recorder writes it.
    const event = await prisma.sbMatchEvent.create({
      data: { matchId: match.id, teamId: match.homeTeamId, playerId: starterOff.playerId, playerLabel: starterOff.playerName, type: "substitution", minute: 60, detail: `#${starterOff.jerseyNumber} off, #${sub.jerseyNumber} on`, metadata: { source: `gate-${RUN}`, half: 2, playerNumber: starterOff.jerseyNumber, secondaryPlayerNumber: sub.jerseyNumber } },
    });
    fx.eventIds.push(event.id);

    const job = async (type: string) => {
      const id = randomUUID();
      fx!.jobIds.push(id);
      await prisma.visionJob.create({ data: { id, type, resourceClass: "cpu_small", state: "succeeded", videoAssetId: asset.id, inputSpec: {}, outputPrefix: visionKeys.inferencePrefix(id, 1), budgetSeconds: 600, budgetUsdCents: 100, contractVersion: VISION_CONTRACT_VERSION, finishedAt: new Date() } });
      return id;
    };
    const trackJob = await job("track");
    const identifyJob = await job("identify");
    const windows = [
      [minute1(10), minute1(15)],
      [minute2(70), minute2(75)],
      [minute2(58), minute2(62)],
    ];
    const trackIds: string[] = [];
    for (let i = 0; i < windows.length; i += 1) {
      const t = await prisma.visionTrack.create({
        data: { videoAssetId: asset.id, inferenceJobId: trackJob, localTrackId: i + 1, class: "player", startMs: windows[i]![0]!, endMs: windows[i]![1]!, startFrame: 0, endFrame: 1, detectionCount: 1, confirmed: true, artifactKey: `${visionKeys.inferencePrefix(trackJob, 1)}tracks.json` },
      });
      trackIds.push(t.id);
      await prisma.visionTeamAssignment.create({ data: { trackId: t.id, inferenceJobId: identifyJob, team: "A", nearestTeam: "A", confidence: 0.9, method: "kit_cluster", kitDescription: "red" } });
    }
    const [t1, t2, t3] = trackIds as [string, string, string];

    const reviewer = await person(fx, "vision_reviewer", "reviewer");
    const R = { post: (path: string, body: unknown) => call(path, { Authorization: `Bearer ${reviewer.token}` }, { method: "POST", body: JSON.stringify(body) }) };
    await R.post(`/vision/review/jobs/${identifyJob}/sides`, { A: match.homeTeamId, B: match.awayTeamId });

    // ── 1. Anchoring ─────────────────────────────────────────────────────
    section("1. A person anchors each half, in order, inside the footage");

    const before = await api(`/vision/review/tracks/${t2}/candidates`);
    check("before the clock is anchored, the whole side is listed", before.body.candidates?.length, home.length);
    check("…with the caveat", String(before.body.clock).includes("not anchored"), true);
    check("…and no window", before.body.window, null);

    const keyed = await post(`/vision/review/${fx.assetId}/clock`, { half: 1, sourceMs: KICKOFF_1 });
    check("the operator key cannot anchor", keyed.body.error, "ClockNeedsAPerson");
    const outside = await R.post(`/vision/review/${fx.assetId}/clock`, { half: 1, sourceMs: 7_000_000 });
    check("an anchor past the footage: refused", outside.body.error, "AnchorOutsideAsset");
    const backwards = await R.post(`/vision/review/${fx.assetId}/clock`, { half: 1, sourceMs: KICKOFF_1, endMs: KICKOFF_1 });
    check("a half ending before it starts: refused", backwards.body.error, "HalfEndsBeforeItStarts");
    const half5 = await R.post(`/vision/review/${fx.assetId}/clock`, { half: 5, sourceMs: KICKOFF_1 });
    check("a fifth half: refused", half5.status, 400);
    const first = await R.post(`/vision/review/${fx.assetId}/clock`, { half: 1, sourceMs: KICKOFF_1, endMs: END_1 });
    check("the first half anchored, kick-off and end", `${first.status}/${first.body.half}/${first.body.decidedBy === reviewer.id}`, "201/1/true");
    const early = await R.post(`/vision/review/${fx.assetId}/clock`, { half: 2, sourceMs: END_1 - 1000 });
    check("a second half before the first ended: refused", early.body.error, "HalfOutOfOrder");
    const second = await R.post(`/vision/review/${fx.assetId}/clock`, { half: 2, sourceMs: KICKOFF_2 });
    check("the second half anchored", second.status, 201);
    const again = await R.post(`/vision/review/${fx.assetId}/clock`, { half: 2, sourceMs: KICKOFF_2 + 40 });
    check("re-anchoring supersedes rather than adds", again.status, 201);
    const rows = await prisma.visionClockAnchor.findMany({ where: { videoAssetId: fx.assetId, half: 2 }, orderBy: { createdAt: "asc" } });
    check("…two rows for the half, the first superseded by the second", `${rows.length}/${rows[0]?.supersededBy === rows[1]?.id}`, "2/true");
    const back = await R.post(`/vision/review/${fx.assetId}/clock`, { half: 2, sourceMs: KICKOFF_2 });
    check("…and back again", back.status, 201);

    // ── 2. Reading ───────────────────────────────────────────────────────
    section("2. Any millisecond reads on the match clock");

    const read = async (ms: number) => (await api(`/vision/review/${fx!.assetId}/clock?sourceMs=${ms}`)).body.at;
    check("the clock is anchored", (await api(`/vision/review/${fx.assetId}/clock`)).body.anchored, true);
    check("…with two halves named", (await api(`/vision/review/${fx.assetId}/clock`)).body.anchors?.map((a: any) => a.name).join(", "), "1st half, 2nd half");
    check("five seconds in is before kick-off", (await read(5000))?.status, "before_kickoff");
    check("12:30 of the first half", (await read(minute1(12) + 30_000))?.display, "12:30");
    check("the break is between halves", (await read(END_1 + 60_000))?.status, "between_halves");
    check("47:12 of the second", (await read(KICKOFF_2 + 2 * 60_000 + 12_000))?.display, "47:12");
    check("added time runs past ninety", (await read(minute2(91)))?.display, "91:00");
    const review = await api(`/vision/review/${fx.assetId}/tracks`);
    const byId = new Map<string, any>((review.body.tracks ?? []).map((t: any) => [t.id, t]));
    check("the review view carries the clock", review.body.clock?.anchored, true);
    check("…and each track's window on it", byId.get(t1)?.matchClock, "10:00–15:00");
    check("…across the break too", byId.get(t3)?.matchClock, "58:00–62:00");

    // ── 3. The roster told the time ──────────────────────────────────────
    section("3. Candidates are the players on the pitch for the window");

    const names = (body: any) => new Map<string, string>((body.candidates ?? []).map((c: any) => [c.matchSquadPlayerId, c.onPitch]));
    const early1 = await api(`/vision/review/tracks/${t1}/candidates`);
    check("at 10'-15' the clock is applied", String(early1.body.clock).includes("substitutions are applied"), true);
    check("…the window is on the clock", early1.body.window?.display, "10:00–15:00");
    check("…the starter later taken off is on the pitch", names(early1.body).get(starterOff.id), "yes");
    check("…the substitute is not listed", names(early1.body).has(sub.id), false);
    const homeAll = match.squadPlayers.filter((s) => s.teamId === match.homeTeamId);
    const homeStarters = homeAll.filter((s) => s.isStarter).length;
    check("…every substitute is off the pitch before they come on", early1.body.window?.offPitch, homeAll.length - homeStarters);
    const late = await api(`/vision/review/tracks/${t2}/candidates`);
    check("at 70'-75' the starter taken off is not listed", names(late.body).has(starterOff.id), false);
    check("…the substitute is on the pitch", names(late.body).get(sub.id), "yes");
    check("…another starter still is", names(late.body).get(starterOn.id), "yes");
    const across = await api(`/vision/review/tracks/${t3}/candidates`);
    check("across the change at 60', both are listed as partly", `${names(across.body).get(starterOff.id)}/${names(across.body).get(sub.id)}`, "partly/partly");
    check("…and the eleven who started plus the one who came on", across.body.candidates?.length, homeStarters + 1);

    const audit = await prisma.visionAuditLog.count({ where: { actorId: reviewer.id, action: "clock.anchored" } });
    check("the audit trail: four anchors filed", audit, 4);
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
