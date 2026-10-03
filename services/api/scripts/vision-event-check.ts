/**
 * Phase 6 Increment 1 gate — event candidates: a proposal with its evidence, a
 * second person's word, and the one door into the match record.
 *
 *   pnpm --filter @dtp/api vision:eventcheck
 *
 * Needs the API on :3000 (`VISION_E2E_API`), whatever `DATABASE_URL` points at
 * (never production) holding a ScoreBoard match with squad players and no goals,
 * and the seeded `vision_reviewer` and `vision_annotator` roles. The gate writes
 * recorder goals on that match for the run and removes them after.
 *
 * Three claims are on trial:
 *
 *   1. A person proposes an event from the taxonomy inside the footage, on this
 *      asset's tracks and this match's roster; the evidence it rests on is
 *      found and linked; inside a replay it is flagged. The operator key cannot.
 *   2. A correction is a new row that supersedes and starts review again; the
 *      proposer cannot accept their own; a rejection says why.
 *   3. Promotion needs acceptance, a recorder type, play, publication rights
 *      and the clock; it enriches the recorder's event at the same minute
 *      rather than adding a second; it creates one only on instruction; a
 *      replayed goal is never a second goal (docs/vision/09, the required test).
 *   4. (Increment 3) The second lands beside the recorder's minute: on a created
 *      event always; on an enriched one only when the minutes agree and the
 *      recorder gave none. The minute itself is never rewritten.
 *   5. (Increment 3) The review queue lists what is not the reader's own,
 *      oldest first, both kinds, and empties as decisions land.
 *   6. (QA fix 5, docs/vision/55) The record is in the recorder's minutes: the
 *      minute being played, counted from one, stopped at the half's length with
 *      added time beside it. A created goal moves the scoreline and the scorer's
 *      totals with it. A decision is not flipped in place; the minute written is
 *      the one accepted; one recorder event is one candidate's; and when the
 *      recorder's sheet is rebuilt the stamp follows the event or the candidate
 *      is left stale and reviewed again.
 *
 * The gate restores the match's score and the scorer's totals when it is done.
 */
import { randomBytes, randomUUID } from "node:crypto";
import * as bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";
import { VISION_CONTRACT_VERSION, VISION_EVENT_TAXONOMY_VERSION, visionKeys } from "@dtp/vision-contracts";
import { loadApiEnv } from "../src/shared/load-dotenv";
import { recorderHalfLength } from "../src/vision/clock/recorder-minute";
import { reapplyEnrichment } from "../src/vision/events/reapply-enrichment";

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
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(72)} ${ok ? String(actual) : `expected ${expected}, got ${actual}`}`);
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

type Before = {
  matchId: string;
  homeScore: number;
  awayScore: number;
  competitionId: string;
  playerId: string;
  careerGoals: number;
  /** The scorer's row in the competition's totals before the run, or null when there was none. */
  competitionGoals: number | null;
};
type Fixture = { partnerId: string; assetId: string; jobIds: string[]; userIds: string[]; eventIds: string[]; before: Before | null };

async function person(fx: Fixture, roleSlug: string, label: string): Promise<{ id: string; token: string; as: (path: string, init?: RequestInit) => Promise<Reply> }> {
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
  const token = String(login.body.token);
  return { id: user.id, token, as: (path, init) => call(path, { Authorization: `Bearer ${token}` }, init) };
}

async function matchWithSquadsAndNoGoals() {
  const matches = await prisma.sbMatch.findMany({
    where: { squadPlayers: { some: { playerId: { not: null } } }, events: { none: { type: "goal" } } },
    select: {
      id: true, homeTeamId: true, awayTeamId: true, homeScore: true, awayScore: true, competitionId: true,
      competition: { select: { formatConfig: true } },
      statisticsSheet: { select: { clock: true } },
      squadPlayers: { select: { id: true, teamId: true, playerId: true, playerName: true, isStarter: true } },
    },
    take: 200,
  });
  // The gate's minutes are written for 45-minute halves, so it takes a match played to them.
  const match = matches.find((m) => m.squadPlayers.some((s) => s.teamId === m.homeTeamId && s.playerId) && recorderHalfLength(m.statisticsSheet?.clock, m.competition?.formatConfig) === 45);
  if (!match) throw new Error("No ScoreBoard match of 45-minute halves with a home squad player and no goals; seed one first");
  return match;
}

async function cleanup(fx: Fixture | null) {
  if (!fx) return;
  await prisma.sbMatchEvent.deleteMany({ where: { id: { in: fx.eventIds } } });
  // The created goal moved the scoreline and the scorer's totals; both go back to what they were.
  if (fx.before) {
    const b = fx.before;
    await prisma.sbMatch.update({ where: { id: b.matchId }, data: { homeScore: b.homeScore, awayScore: b.awayScore } });
    await prisma.player.update({ where: { id: b.playerId }, data: { careerGoals: b.careerGoals } });
    const key = { competitionId_playerId: { competitionId: b.competitionId, playerId: b.playerId } };
    if (b.competitionGoals === null) await prisma.sbPlayerCompetitionStats.deleteMany({ where: { competitionId: b.competitionId, playerId: b.playerId } });
    else await prisma.sbPlayerCompetitionStats.update({ where: key, data: { goals: b.competitionGoals } });
  }
  // Candidates and their evidence cascade with the asset; so do tracks, segments, anchors and jobs.
  await prisma.visionVideoAsset.deleteMany({ where: { id: fx.assetId } });
  await prisma.visionAuditLog.deleteMany({ where: { OR: [{ actorId: { in: fx.userIds } }, { targetId: { in: [...fx.jobIds, fx.assetId] } }] } });
  await prisma.adminUser.deleteMany({ where: { id: { in: fx.userIds } } });
  await prisma.visionRightsScope.deleteMany({ where: { partnerId: fx.partnerId } });
  await prisma.visionSourceVideoRecord.deleteMany({ where: { partnerId: fx.partnerId } });
  await prisma.visionSourcePartner.deleteMany({ where: { id: fx.partnerId } });
}

/* Kick-off nine seconds into the file; the first half ends at 49:00, four minutes of added time in; the second half is never anchored. */
const KICKOFF_1 = 9000;
const END_1 = KICKOFF_1 + 49 * 60_000;
/** A stopwatch reading: `m:ss` after kick-off. */
const minute1 = (m: number, s = 0) => KICKOFF_1 + m * 60_000 + s * 1000;
/** The recorder's way: second `s` of the `n`-th minute being played, counted from one. */
const inMinute = (n: number, s = 0) => minute1(n - 1, s);

async function main() {
  console.log("Vision events — a candidate with its evidence, and one door into the match record");
  console.log(`  api ${API}`);
  console.log(`  run ${RUN}`);

  let fx: Fixture | null = null;
  try {
    const match = await matchWithSquadsAndNoGoals();
    const starter = match.squadPlayers.find((s) => s.teamId === match.homeTeamId && s.playerId)!;
    const partner = await prisma.visionSourcePartner.create({ data: { name: `Events gate ${RUN}`, contactEmail: "gate@example.test" } });
    fx = { partnerId: partner.id, assetId: "", jobIds: [], userIds: [], eventIds: [], before: null };
    const scorer = await prisma.player.findUniqueOrThrow({ where: { id: starter.playerId! }, select: { careerGoals: true } });
    const scorerTotals = await prisma.sbPlayerCompetitionStats.findUnique({ where: { competitionId_playerId: { competitionId: match.competitionId, playerId: starter.playerId! } }, select: { goals: true } });
    fx.before = { matchId: match.id, homeScore: match.homeScore, awayScore: match.awayScore, competitionId: match.competitionId, playerId: starter.playerId!, careerGoals: scorer.careerGoals, competitionGoals: scorerTotals?.goals ?? null };
    const record = await prisma.visionSourceVideoRecord.create({
      data: { partnerId: partner.id, title: `Events gate record ${RUN}`, sourceQualityRank: "broadcast", originalAvailable: true, acquisitionStatus: "acquired", acquisitionMethod: "partner_direct_upload" },
    });
    const scope = await prisma.visionRightsScope.create({
      data: { partnerId: partner.id, grantLevel: "partner", canAnalyze: true, canTrain: true, canPublishHighlight: false, canShareWithScout: false, grantedAt: new Date() },
    });
    const asset = await prisma.visionVideoAsset.create({
      data: {
        sourceVideoRecordId: record.id, sbMatchId: match.id, corpus: "dtp_owned", objectKey: `originals/gate-${RUN}-events/source.mp4`, bytes: BigInt(1024), mimeType: "video/mp4",
        checksumSha256: randomUUID().replace(/-/g, "").padEnd(64, "0").slice(0, 64), width: 1280, height: 720, durationMs: 6_000_000, ingestState: "ready",
      },
    });
    fx.assetId = asset.id;
    const trackJob = randomUUID();
    fx.jobIds.push(trackJob);
    await prisma.visionJob.create({ data: { id: trackJob, type: "track", resourceClass: "cpu_small", state: "succeeded", videoAssetId: asset.id, inputSpec: {}, outputPrefix: visionKeys.inferencePrefix(trackJob, 1), budgetSeconds: 600, budgetUsdCents: 100, contractVersion: VISION_CONTRACT_VERSION, finishedAt: new Date() } });
    const track = await prisma.visionTrack.create({
      data: { videoAssetId: asset.id, inferenceJobId: trackJob, localTrackId: 1, class: "player", startMs: minute1(10), endMs: minute1(25), startFrame: 0, endFrame: 1, detectionCount: 1, confirmed: true, artifactKey: `${visionKeys.inferencePrefix(trackJob, 1)}tracks.json` },
    });

    const reviewer = await person(fx, "vision_reviewer", "reviewer");
    const second = await person(fx, "vision_reviewer", "second");
    const annotator = await person(fx, "vision_annotator", "annotator");
    const postAs = (who: typeof reviewer) => (path: string, body: unknown) => who.as(path, { method: "POST", body: JSON.stringify(body) });
    const R = postAs(reviewer);
    const S = postAs(second);

    // What the candidate will rest on: the half anchored, a wide segment and a replay, and who track 1 was said to be.
    const anchored = await R(`/vision/review/${fx.assetId}/clock`, { half: 1, sourceMs: KICKOFF_1, endMs: END_1 });
    check("the first half anchored", anchored.status, 201);
    const wide = await R(`/vision/review/${fx.assetId}/camera-segments`, { startMs: KICKOFF_1, endMs: minute1(29), kind: "wide" });
    const replay = await R(`/vision/review/${fx.assetId}/camera-segments`, { startMs: minute1(30), endMs: minute1(31), kind: "replay" });
    check("a wide segment and a replay declared", `${wide.status}/${replay.status}`, "201/201");
    const identity = await prisma.visionIdentityAssignment.create({
      data: { trackId: track.id, playerId: starter.playerId, matchSquadPlayerId: starter.id, sbTeamId: match.homeTeamId, confidence: 1, method: "manual", validFromMs: minute1(10), validToMs: minute1(25), decidedBy: reviewer.id },
    });

    // ── 1. Proposing ─────────────────────────────────────────────────────
    section("1. A person proposes an event, and the evidence is found for it");

    const keyed = await post(`/vision/review/events`, { videoAssetId: fx.assetId, type: "shot", startMs: minute1(12), endMs: minute1(12) });
    check("the operator key cannot propose", keyed.body.error, "EventNeedsAPerson");
    const foreign = await R(`/vision/review/events`, { videoAssetId: fx.assetId, type: "goal", startMs: minute1(12), endMs: minute1(12) });
    check("a type outside the taxonomy: refused at the door", foreign.status, 400);
    const past = await R(`/vision/review/events`, { videoAssetId: fx.assetId, type: "shot", startMs: 5_999_000, endMs: 6_000_001 });
    check("a window past the footage: refused", past.body.error, "EventOutsideAsset");
    const stranger = await R(`/vision/review/events`, { videoAssetId: fx.assetId, type: "shot", startMs: minute1(12), endMs: minute1(12), actorTrackId: randomUUID() });
    check("an actor track not of this footage: refused", stranger.body.error, "ActorNotOnThisAsset");
    const otherSlot = await prisma.sbMatchSquadPlayer.findFirst({ where: { matchId: { not: match.id } }, select: { id: true } });
    if (otherSlot) {
      const wrongMatch = await R(`/vision/review/events`, { videoAssetId: fx.assetId, type: "shot", startMs: minute1(12), endMs: minute1(12), actorMatchSquadPlayerId: otherSlot.id });
      check("a roster slot of another match: refused", wrongMatch.body.error, "NotOnThisMatchSquad");
    }
    const wrongTeam = await R(`/vision/review/events`, { videoAssetId: fx.assetId, type: "shot", startMs: minute1(12), endMs: minute1(12), sbTeamId: randomUUID() });
    check("a team not in this match: refused", wrongTeam.body.error, "TeamNotInThisMatch");

    const shot = await R(`/vision/review/events`, { videoAssetId: fx.assetId, type: "shot", startMs: minute1(12), endMs: minute1(12, 2), actorTrackId: track.id, actorMatchSquadPlayerId: starter.id, note: "from the edge of the box", evidence: [{ kind: "detection_frame", targetId: "frame-18000" }] });
    check("a shot proposed", shot.status, 201);
    check("…under the taxonomy version", shot.body.taxonomyVersion, VISION_EVENT_TAXONOMY_VERSION);
    check("…by the reviewer, unreviewed", `${shot.body.decidedBy === reviewer.id}/${shot.body.reviewState}`, "true/unreviewed");
    check("…with the actor's player and team from the slot", `${shot.body.actorPlayerId === starter.playerId}/${shot.body.sbTeamId === match.homeTeamId}`, "true/true");
    check("…reading 12:00 on the match clock", shot.body.matchClock, "12:00");
    check("…in play, inside the wide segment", `${shot.body.inPlay}/${shot.body.cameraSegmentId === wide.body.id}`, "true/true");
    const kinds = (shot.body.evidence as { kind: string; targetId: string }[]).map((e) => e.kind).sort().join(",");
    check("…resting on the track, the identity, the segment, the half, and the frame the reviewer named", kinds, "camera_segment,clock_anchor,detection_frame,identity,track");
    check("…the identity link naming the assignment", (shot.body.evidence as any[]).some((e) => e.kind === "identity" && e.targetId === identity.id), true);
    check("…not promotable: the recorder has no row for a shot", shot.body.promotable, false);

    const replayed = await R(`/vision/review/events`, { videoAssetId: fx.assetId, type: "goal_candidate", startMs: minute1(30, 20), endMs: minute1(30, 20), sbTeamId: match.homeTeamId });
    check("a goal candidate inside the replay is flagged not play", `${replayed.status}/${replayed.body.inPlay}/${replayed.body.cameraSegmentId === replay.body.id}`, "201/false/true");

    // ── 2. Correction and review ─────────────────────────────────────────
    section("2. A correction supersedes; a second person decides");

    const corrected = await reviewer.as(`/vision/review/events/${shot.body.id}`, { method: "PATCH", body: JSON.stringify({ endMs: minute1(12, 3) }) });
    check("the shot corrected: a new row", `${corrected.status}/${corrected.body.id !== shot.body.id}/${corrected.body.supersedes === shot.body.id}`, "200/true/true");
    check("…with the change, the rest carried, the frame kept", `${corrected.body.endMs}/${corrected.body.actorTrackId === track.id}/${(corrected.body.evidence as any[]).some((e) => e.kind === "detection_frame")}`, `${minute1(12, 3)}/true/true`);
    const old = await reviewer.as(`/vision/review/events/${shot.body.id}`);
    check("…and the old row says what superseded it", old.body.supersededBy === corrected.body.id, true);
    const stale = await S(`/vision/review/events/${shot.body.id}/decision`, { decision: "accepted" });
    check("a decision on the superseded row: refused", stale.body.error, "EventSuperseded");
    const selfAccept = await R(`/vision/review/events/${corrected.body.id}/decision`, { decision: "accepted" });
    check("the proposer cannot accept their own", selfAccept.body.error, "SelfAcceptanceRefused");
    const noReason = await S(`/vision/review/events/${corrected.body.id}/decision`, { decision: "rejected" });
    check("a rejection without a reason: refused", noReason.body.error, "ReasonRequired");

    // ── 5. The review queue ──────────────────────────────────────────────
    section("5. The queue: what is not yours, oldest first, until it is decided");

    const queueKeyed = await api(`/vision/review/queue?assetId=${fx.assetId}`);
    check("the operator key has no queue", queueKeyed.body.error, "EventNeedsAPerson");
    const queueAnnotator = await annotator.as(`/vision/review/queue?assetId=${fx.assetId}`);
    check("nor does someone without vision.review", queueAnnotator.status, 403);
    const queueSecond = await second.as(`/vision/review/queue?assetId=${fx.assetId}`);
    const queued = (queueSecond.body.items as { kind: string; id: string }[]).map((i) => `${i.kind}:${i.id}`);
    check("the second person's queue on this footage: the identity, then the replayed goal, then the corrected shot, in the order they were made", queued.join(","), `identity:${identity.id},event:${replayed.body.id},event:${corrected.body.id}`);
    check("…the superseded shot is not in it", queued.some((q) => q.endsWith(shot.body.id)), false);
    check("…counting what waits", `${queueSecond.body.waiting?.events}/${queueSecond.body.waiting?.identities}`, "2/1");
    const first = queueSecond.body.items[0];
    check("…the identity item says the track, the slot, the footage and the clock", `${first.localTrackId}/${first.slot?.name === starter.playerName}/${first.asset?.title?.startsWith("Events gate record")}/${first.matchClock}`, "1/true/true/10:00");
    check("…the event item says the type and the clock", `${queueSecond.body.items[2].type}/${queueSecond.body.items[2].matchClock}`, "shot/12:00");
    const queueReviewer = await reviewer.as(`/vision/review/queue?assetId=${fx.assetId}`);
    check("the proposer's own queue on this footage is empty: nothing here is a second person's to them", `${queueReviewer.body.count}/${queueReviewer.body.waiting?.events}/${queueReviewer.body.waiting?.identities}`, "0/0/0");
    const queueOne = await second.as(`/vision/review/queue?assetId=${fx.assetId}&limit=1`);
    check("a limit cuts the list and keeps the count of what waits", `${queueOne.body.count}/${queueOne.body.waiting?.events}`, "1/2");
    const queueAll = await second.as(`/vision/review/queue`);
    check("without an asset the queue spans the footage, this one included", (queueAll.body.items as { id: string }[]).some((i) => i.id === corrected.body.id), true);

    const accepted = await S(`/vision/review/events/${corrected.body.id}/decision`, { decision: "accepted" });
    check("a second person accepts", `${accepted.status}/${accepted.body.reviewState}/${accepted.body.reviewedBy === second.id}`, "201/accepted/true");
    const queueAfter = await second.as(`/vision/review/queue?assetId=${fx.assetId}`);
    check("…and the shot leaves the queue", (queueAfter.body.items as { id: string }[]).map((i) => i.id).includes(corrected.body.id) ? "still there" : `${queueAfter.body.count} left`, "2 left");

    const listed = await reviewer.as(`/vision/review/${fx.assetId}/events`);
    check("the asset lists its current candidates", `${listed.body.count}/${listed.body.clock?.anchored}`, "2/true");
    const everything = await reviewer.as(`/vision/review/${fx.assetId}/events?all=1`);
    check("…and the superseded one on request", everything.body.count, 3);

    // ── 3. Promotion ─────────────────────────────────────────────────────
    section("3. One door into the match record, and a replay is never a second goal");

    const shotPromote = await R(`/vision/review/events/${corrected.body.id}/promote`, {});
    check("an accepted shot cannot be promoted: no recorder type", shotPromote.body.error, "NoScoreBoardType");

    await S(`/vision/review/events/${replayed.body.id}/decision`, { decision: "accepted" });
    const replayPromote = await R(`/vision/review/events/${replayed.body.id}/promote`, {});
    check("an accepted goal candidate in the replay: refused", replayPromote.body.error, "NotInPlay");

    const goal = await R(`/vision/review/events`, { videoAssetId: fx.assetId, type: "goal_candidate", startMs: inMinute(20, 15), endMs: inMinute(20, 15), actorTrackId: track.id, actorMatchSquadPlayerId: starter.id });
    check("a goal candidate in play proposed", `${goal.status}/${goal.body.promotable}`, "201/true");
    const unaccepted = await R(`/vision/review/events/${goal.body.id}/promote`, {});
    check("…not promotable before acceptance", unaccepted.body.error, "NotAccepted");
    await S(`/vision/review/events/${goal.body.id}/decision`, { decision: "accepted" });
    const flipped = await S(`/vision/review/events/${goal.body.id}/decision`, { decision: "rejected", reason: "changed my mind" });
    check("…and once accepted, the decision is not flipped in place", flipped.body.error, "AlreadyDecided");
    const noPermission = await postAs(annotator)(`/vision/review/events/${goal.body.id}/promote`, {});
    check("…nor by someone without vision.publish", noPermission.status, 403);
    const noRights = await R(`/vision/review/events/${goal.body.id}/promote`, {});
    check("…nor while the rights scope forbids publication", noRights.body.error, "PublicationRightsRefused");
    await prisma.visionRightsScope.update({ where: { id: scope.id }, data: { canPublishHighlight: true } });
    const nothingToEnrich = await R(`/vision/review/events/${goal.body.id}/promote`, {});
    check("with rights, and no recorder goal near 20': nothing to enrich, nothing created", `${nothingToEnrich.body.error}/${nothingToEnrich.body.nearest}`, "NoMatchingEvent/null");
    check("…and the match record is untouched", await prisma.sbMatchEvent.count({ where: { matchId: match.id, type: "goal" } }), 0);
    const created = await R(`/vision/review/events/${goal.body.id}/promote`, { create: true });
    check("on instruction, a goal is added to the match record", `${created.status}/${created.body.promotion?.kind}/${created.body.promotion?.minute}`, "201/created/20");
    if (created.body.promotion?.eventId) fx.eventIds.push(created.body.promotion.eventId);
    const written = await prisma.sbMatchEvent.findUnique({ where: { id: created.body.promotion?.eventId ?? "" } });
    check("…for the home side, by the player the slot names, at minute 20", `${written?.teamId === match.homeTeamId}/${written?.playerId === starter.playerId}/${written?.playerLabel === starter.playerName}/${written?.minute}`, "true/true/true/20");
    check("…and at the fifteenth second of it, on the row and in the reply", `${written?.secondInMinute}/${created.body.promotion?.second}`, "15/15");
    check("…marked as from video, in the first half, with no added time", `${(written?.metadata as any)?.source}/${(written?.metadata as any)?.half}/${(written?.metadata as any)?.addedMinute}`, "vision/1/null");
    const scored = await prisma.sbMatch.findUnique({ where: { id: match.id }, select: { homeScore: true, awayScore: true } });
    check("…and the scoreline counts it: one more for the home side, the away side untouched", `${scored!.homeScore - match.homeScore}/${scored!.awayScore - match.awayScore}`, "1/0");
    const credited = await prisma.player.findUnique({ where: { id: starter.playerId! }, select: { careerGoals: true } });
    const creditedTotals = await prisma.sbPlayerCompetitionStats.findUnique({ where: { competitionId_playerId: { competitionId: match.competitionId, playerId: starter.playerId! } }, select: { goals: true } });
    check("…and so do the scorer's totals, career and competition", `${credited!.careerGoals - fx.before!.careerGoals}/${(creditedTotals?.goals ?? 0) - (fx.before!.competitionGoals ?? 0)}`, "1/1");
    check("…the credit recorded on the row, so deleting the goal can take it back", (written?.metadata as any)?.statsApplied, true);
    check("…stamped with the candidate", (written?.metadata as any)?.vision?.candidateId === goal.body.id && (written?.metadata as any)?.vision?.contract === "VisionEventPromotionV1", true);
    check("…and the candidate knows", `${created.body.promotedEventId === written?.id}/${created.body.promotionKind}/${created.body.promotedBy === reviewer.id}`, "true/created/true");
    const again = await R(`/vision/review/events/${goal.body.id}/promote`, {});
    check("promoting again: refused", again.body.error, "AlreadyPromoted");
    const lateFix = await reviewer.as(`/vision/review/events/${goal.body.id}`, { method: "PATCH", body: JSON.stringify({ note: "later" }) });
    check("correcting a promoted candidate: refused", lateFix.body.error, "EventPromoted");

    // The recorder logged a goal at 33'. Vision's candidate twenty seconds into the 33rd minute is the same goal.
    const recorded = await prisma.sbMatchEvent.create({ data: { matchId: match.id, teamId: match.homeTeamId, type: "goal", minute: 33, detail: `gate-${RUN}`, metadata: { source: `gate-${RUN}` } } });
    fx.eventIds.push(recorded.id);
    const same = await R(`/vision/review/events`, { videoAssetId: fx.assetId, type: "goal_candidate", startMs: inMinute(33, 20), endMs: inMinute(33, 20), actorTrackId: track.id, sbTeamId: match.homeTeamId });
    await S(`/vision/review/events/${same.body.id}/decision`, { decision: "accepted" });
    const enriched = await R(`/vision/review/events/${same.body.id}/promote`, {});
    check("a candidate in the 33rd minute enriches the recorder's goal at 33'", `${enriched.status}/${enriched.body.promotion?.kind}/${enriched.body.promotion?.eventId === recorded.id}`, "201/enriched/true");
    const after = await prisma.sbMatchEvent.findUnique({ where: { id: recorded.id } });
    check("…the recorder's row keeps its own metadata and gains the stamp", `${(after?.metadata as any)?.source}/${(after?.metadata as any)?.vision?.startMs}`, `gate-${RUN}/${inMinute(33, 20)}`);
    check("…its minute untouched, and no second goal added", `${after?.minute}/${await prisma.sbMatchEvent.count({ where: { matchId: match.id, type: "goal" } })}`, "33/2");
    check("…and the whole minute the recorder entered gains Vision's second", `${after?.secondInMinute}/${enriched.body.promotion?.second}`, "20/20");
    const afterEnrich = await prisma.sbMatch.findUnique({ where: { id: match.id }, select: { homeScore: true } });
    check("…and enriching moves no score: the recorder's goal is the recorder's to count", afterEnrich!.homeScore - match.homeScore, 1);

    // A second candidate for the same goal: the recorder's event already carries one.
    const twice = await R(`/vision/review/events`, { videoAssetId: fx.assetId, type: "goal_candidate", startMs: inMinute(33, 40), endMs: inMinute(33, 40), sbTeamId: match.homeTeamId });
    await S(`/vision/review/events/${twice.body.id}/decision`, { decision: "accepted" });
    const taken = await R(`/vision/review/events/${twice.body.id}/promote`, {});
    check("a second candidate landing on the same recorder goal: refused, not a 500", `${taken.status}/${taken.body.error}`, "409/AlreadyEnriched");
    const takenCreate = await R(`/vision/review/events/${twice.body.id}/promote`, { create: true });
    check("…and not turned into a second goal by asking to create", `${takenCreate.body.error}/${await prisma.sbMatchEvent.count({ where: { matchId: match.id, type: "goal" } })}`, "AlreadyEnriched/2");

    // ── 4. The second beside the recorder's minute ───────────────────────
    section("4. A second only under the recorder's own minute, and never over the recorder's word");

    // The recorder logged a goal at 36'. Vision's candidate in the 37th minute is the same goal, a minute apart: no second is written under 36.
    const nearby = await prisma.sbMatchEvent.create({ data: { matchId: match.id, teamId: match.homeTeamId, type: "goal", minute: 36, detail: `gate-${RUN}` } });
    fx.eventIds.push(nearby.id);
    const aMinuteOff = await R(`/vision/review/events`, { videoAssetId: fx.assetId, type: "goal_candidate", startMs: inMinute(37, 5), endMs: inMinute(37, 5), sbTeamId: match.homeTeamId });
    await S(`/vision/review/events/${aMinuteOff.body.id}/decision`, { decision: "accepted" });
    const offByOne = await R(`/vision/review/events/${aMinuteOff.body.id}/promote`, {});
    check("a candidate in the 37th minute enriches the recorder's goal at 36'", `${offByOne.body.promotion?.kind}/${offByOne.body.promotion?.eventId === nearby.id}/${offByOne.body.promotion?.minutesApart}`, "enriched/true/1");
    const nearbyAfter = await prisma.sbMatchEvent.findUnique({ where: { id: nearby.id } });
    check("…but writes no second under a minute that is not its own, and leaves the minute", `${nearbyAfter?.secondInMinute}/${nearbyAfter?.minute}/${offByOne.body.promotion?.second}`, "null/36/null");

    // The recorder entered 25' and its fortieth second by hand. Vision's candidate ten seconds into that minute does not overwrite it.
    const byHand = await prisma.sbMatchEvent.create({ data: { matchId: match.id, teamId: match.homeTeamId, type: "goal", minute: 25, secondInMinute: 40, detail: `gate-${RUN}` } });
    fx.eventIds.push(byHand.id);
    const overHand = await R(`/vision/review/events`, { videoAssetId: fx.assetId, type: "goal_candidate", startMs: inMinute(25, 10), endMs: inMinute(25, 10), sbTeamId: match.homeTeamId });
    await S(`/vision/review/events/${overHand.body.id}/decision`, { decision: "accepted" });
    const kept = await R(`/vision/review/events/${overHand.body.id}/promote`, {});
    const byHandAfter = await prisma.sbMatchEvent.findUnique({ where: { id: byHand.id } });
    check("a second the recorder entered is the recorder's word: enriched, not overwritten", `${kept.body.promotion?.kind}/${byHandAfter?.secondInMinute}/${kept.body.promotion?.second}`, "enriched/40/40");

    const two = await prisma.sbMatchEvent.createManyAndReturn({ data: [40, 42].map((minute) => ({ matchId: match.id, teamId: match.homeTeamId, type: "goal", minute, detail: `gate-${RUN}` })) });
    fx.eventIds.push(...two.map((e) => e.id));
    const between = await R(`/vision/review/events`, { videoAssetId: fx.assetId, type: "goal_candidate", startMs: inMinute(41), endMs: inMinute(41), sbTeamId: match.homeTeamId });
    await S(`/vision/review/events/${between.body.id}/decision`, { decision: "accepted" });
    const ambiguous = await R(`/vision/review/events/${between.body.id}/promote`, {});
    check("a candidate equally near two recorder goals: refused, not guessed", ambiguous.body.error, "AmbiguousRecorderEvent");

    const offClock = await R(`/vision/review/events`, { videoAssetId: fx.assetId, type: "goal_candidate", startMs: minute1(50), endMs: minute1(50), sbTeamId: match.homeTeamId });
    check("a candidate after the first half's end reads off the clock", offClock.body.matchClock, "after the final whistle");
    await S(`/vision/review/events/${offClock.body.id}/decision`, { decision: "accepted" });
    const noClock = await R(`/vision/review/events/${offClock.body.id}/promote`, { create: true });
    check("…and cannot be promoted: the match record is in match minutes", noClock.body.error, "ClockNotAnchored");

    check("the match record holds exactly the gate's six goals", await prisma.sbMatchEvent.count({ where: { matchId: match.id, type: "goal" } }), 6);

    // ── 6. The recorder's minutes ────────────────────────────────────────
    section("6. The recorder's minutes: added time, the clock that was accepted, and a sheet rebuilt");

    /* As the recorder's console publishes them: a goal two minutes into first-half added time,
       and one in the 47th minute of the second half. On a stopwatch both read 47. */
    const sheetRow = (minute: number, half: 1 | 2, addedMinute: number | null) => ({ matchId: match.id, teamId: match.homeTeamId, type: "goal", minute, detail: `gate-${RUN}`, metadata: { source: "match_recorder", sheetId: `gate-${RUN}`, half, addedMinute } });
    const stoppage = await prisma.sbMatchEvent.create({ data: sheetRow(45, 1, 2) });
    const secondHalf = await prisma.sbMatchEvent.create({ data: sheetRow(47, 2, null) });
    fx.eventIds.push(stoppage.id, secondHalf.id);
    const late = await R(`/vision/review/events`, { videoAssetId: fx.assetId, type: "goal_candidate", startMs: minute1(47, 12), endMs: minute1(47, 12), sbTeamId: match.homeTeamId });
    check("a candidate 47:12 after kick-off reads 47:12 on the footage's stopwatch", late.body.matchClock, "47:12");
    await S(`/vision/review/events/${late.body.id}/decision`, { decision: "accepted" });
    const inAdded = await R(`/vision/review/events/${late.body.id}/promote`, {});
    check("…and is the recorder's 45+2, not the second half's 47th minute", `${inAdded.body.promotion?.kind}/${inAdded.body.promotion?.eventId === stoppage.id}/${inAdded.body.promotion?.minute}+${inAdded.body.promotion?.addedMinute}/${inAdded.body.promotion?.minutesApart}`, "enriched/true/45+2/0");
    const stoppageAfter = await prisma.sbMatchEvent.findUnique({ where: { id: stoppage.id } });
    const secondHalfAfter = await prisma.sbMatchEvent.findUnique({ where: { id: secondHalf.id } });
    check("…its second written under 45+2, the minute and added minute left as the recorder had them", `${stoppageAfter?.secondInMinute}/${stoppageAfter?.minute}/${(stoppageAfter?.metadata as any)?.addedMinute}`, "12/45/2");
    check("…and the second-half goal untouched", `${(secondHalfAfter?.metadata as any)?.vision === undefined}/${secondHalfAfter?.secondInMinute}`, "true/null");

    /* The sheet is sent back and approved again: the console deletes the rows it published and
       writes them fresh. Done here as the service does it -- delete, rewrite, put back. */
    const rebuild = async (rewritten: { minute: number; addedMinute: number | null } | null) => {
      const live = await prisma.sbMatchEvent.findFirst({ where: { matchId: match.id, detail: `gate-${RUN}`, metadata: { path: ["half"], equals: 1 } }, select: { id: true } });
      if (live) await prisma.sbMatchEvent.delete({ where: { id: live.id } });
      const fresh = rewritten ? await prisma.sbMatchEvent.create({ data: sheetRow(rewritten.minute, 1, rewritten.addedMinute) }) : null;
      if (fresh) fx!.eventIds.push(fresh.id);
      return { fresh, put: await reapplyEnrichment(prisma, match.id) };
    };
    const same1 = await rebuild({ minute: 45, addedMinute: 2 });
    const backRow = await prisma.sbMatchEvent.findUnique({ where: { id: same1.fresh!.id } });
    const backCandidate = await reviewer.as(`/vision/review/events/${late.body.id}`);
    check("the sheet approved again with the same goal: the stamp and the second go back on the new row", `${same1.put.reapplied.includes(late.body.id)}/${(backRow?.metadata as any)?.vision?.candidateId === late.body.id}/${backRow?.secondInMinute}/${(backRow?.metadata as any)?.source}`, "true/true/12/match_recorder");
    check("…stamped with when the publisher promoted it, not with now", (backRow?.metadata as any)?.vision?.promotedAt === (stoppageAfter?.metadata as any)?.vision?.promotedAt, true);
    check("…and the candidate points at it, promoted as before", `${backCandidate.body.promotedEventId === same1.fresh!.id}/${backCandidate.body.promotionKind}/${backCandidate.body.promotionStale}`, "true/enriched/false");

    const nudged = await rebuild({ minute: 45, addedMinute: 3 });
    const nudgedRow = await prisma.sbMatchEvent.findUnique({ where: { id: nudged.fresh!.id } });
    check("approved again with the goal moved to 45+3: still the same goal, a minute away, and no second under a minute that is not its own", `${nudged.put.reapplied.includes(late.body.id)}/${(nudgedRow?.metadata as any)?.vision?.candidateId === late.body.id}/${nudgedRow?.secondInMinute}`, "true/true/null");

    const removed = await rebuild(null);
    const orphan = await reviewer.as(`/vision/review/events/${late.body.id}`);
    check("approved again without the goal: nothing to put it on, and the candidate says its event is gone", `${removed.put.stale.includes(late.body.id)}/${orphan.body.promotedEventId}/${orphan.body.promotionStale}`, "true/null/true");
    const staleAgain = await R(`/vision/review/events/${late.body.id}/promote`, { create: true });
    check("…it is not promoted a second time as if nothing had happened", staleAgain.body.error, "PromotionStale");
    check("…and no goal was added by trying", await prisma.sbMatchEvent.count({ where: { matchId: match.id, type: "goal" } }), 7);
    const restarted = await reviewer.as(`/vision/review/events/${late.body.id}`, { method: "PATCH", body: JSON.stringify({}) });
    check("a correction, with nothing changed, starts its review again", `${restarted.status}/${restarted.body.reviewState}/${restarted.body.promotionStale}/${restarted.body.supersedes === late.body.id}`, "200/unreviewed/false/true");
    await S(`/vision/review/events/${restarted.body.id}/decision`, { decision: "accepted" });

    // The recorder puts the goal back at 45+2. Meanwhile one reviewer re-anchors the half: the minute that was accepted is no longer the minute that would be written.
    const restored = await prisma.sbMatchEvent.create({ data: sheetRow(45, 1, 2) });
    fx.eventIds.push(restored.id);
    const reAnchored = await R(`/vision/review/${fx.assetId}/clock`, { half: 1, sourceMs: KICKOFF_1 + 1000, endMs: END_1 });
    check("the half re-anchored a second later, after the acceptance", reAnchored.status, 201);
    const movedClock = await R(`/vision/review/events/${restarted.body.id}/promote`, {});
    check("…the candidate is not promoted on a clock nobody reviewed it on", movedClock.body.error, "ClockChangedSinceAcceptance");
    const reviewedAgain = await reviewer.as(`/vision/review/events/${restarted.body.id}`, { method: "PATCH", body: JSON.stringify({}) });
    await S(`/vision/review/events/${reviewedAgain.body.id}/decision`, { decision: "accepted" });
    const onNewClock = await R(`/vision/review/events/${reviewedAgain.body.id}/promote`, {});
    check("…reviewed again on the new clock, it enriches the recorder's 45+2, a second earlier than before", `${onNewClock.body.promotion?.kind}/${onNewClock.body.promotion?.eventId === restored.id}/${onNewClock.body.promotion?.minute}+${onNewClock.body.promotion?.addedMinute}/${onNewClock.body.promotion?.second}`, "enriched/true/45+2/11");

    const finalScore = await prisma.sbMatch.findUnique({ where: { id: match.id }, select: { homeScore: true, awayScore: true } });
    check("through all of it the scoreline moved once: by the one goal that was created", `${finalScore!.homeScore - match.homeScore}/${finalScore!.awayScore - match.awayScore}`, "1/0");
  } catch (error) {
    failures += 1;
    console.error("\nGate aborted:", error);
  } finally {
    await cleanup(fx).catch((e) => console.error("cleanup failed:", e));
    if (fx?.before) {
      const b = fx.before;
      const m = await prisma.sbMatch.findUnique({ where: { id: b.matchId }, select: { homeScore: true, awayScore: true, _count: { select: { events: { where: { type: "goal" } } } } } });
      const p = await prisma.player.findUnique({ where: { id: b.playerId }, select: { careerGoals: true } });
      const t = await prisma.sbPlayerCompetitionStats.findUnique({ where: { competitionId_playerId: { competitionId: b.competitionId, playerId: b.playerId } }, select: { goals: true } });
      check("after the run the match has its score back, no goals, and the scorer's totals are what they were", `${m?.homeScore}-${m?.awayScore}/${m?._count.events}/${p?.careerGoals}/${t?.goals ?? null}`, `${b.homeScore}-${b.awayScore}/0/${b.careerGoals}/${b.competitionGoals}`);
    }
    await prisma.$disconnect();
  }

  console.log(`\n${checks - failures}/${checks} checks passed${failures ? ` — ${failures} FAILED` : ""}`);
  process.exitCode = failures ? 1 : 0;
}

void main();
