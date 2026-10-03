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
 */
import { randomBytes, randomUUID } from "node:crypto";
import * as bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";
import { VISION_CONTRACT_VERSION, VISION_EVENT_TAXONOMY_VERSION, visionKeys } from "@dtp/vision-contracts";
import { loadApiEnv } from "../src/shared/load-dotenv";

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

type Fixture = { partnerId: string; assetId: string; jobIds: string[]; userIds: string[]; eventIds: string[] };

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
    select: { id: true, homeTeamId: true, awayTeamId: true, squadPlayers: { select: { id: true, teamId: true, playerId: true, playerName: true, isStarter: true } } },
    take: 50,
  });
  const match = matches.find((m) => m.squadPlayers.some((s) => s.teamId === m.homeTeamId && s.playerId));
  if (!match) throw new Error("No ScoreBoard match with a home squad player and no goals; seed one first");
  return match;
}

async function cleanup(fx: Fixture | null) {
  if (!fx) return;
  await prisma.sbMatchEvent.deleteMany({ where: { id: { in: fx.eventIds } } });
  // Candidates and their evidence cascade with the asset; so do tracks, segments, anchors and jobs.
  await prisma.visionVideoAsset.deleteMany({ where: { id: fx.assetId } });
  await prisma.visionAuditLog.deleteMany({ where: { OR: [{ actorId: { in: fx.userIds } }, { targetId: { in: [...fx.jobIds, fx.assetId] } }] } });
  await prisma.adminUser.deleteMany({ where: { id: { in: fx.userIds } } });
  await prisma.visionRightsScope.deleteMany({ where: { partnerId: fx.partnerId } });
  await prisma.visionSourceVideoRecord.deleteMany({ where: { partnerId: fx.partnerId } });
  await prisma.visionSourcePartner.deleteMany({ where: { id: fx.partnerId } });
}

/* Kick-off nine seconds into the file; the first half ends at 45:00; the second half is never anchored. */
const KICKOFF_1 = 9000;
const END_1 = KICKOFF_1 + 45 * 60_000;
const minute1 = (m: number, s = 0) => KICKOFF_1 + m * 60_000 + s * 1000;

async function main() {
  console.log("Vision events — a candidate with its evidence, and one door into the match record");
  console.log(`  api ${API}`);
  console.log(`  run ${RUN}`);

  let fx: Fixture | null = null;
  try {
    const match = await matchWithSquadsAndNoGoals();
    const starter = match.squadPlayers.find((s) => s.teamId === match.homeTeamId && s.playerId)!;
    const partner = await prisma.visionSourcePartner.create({ data: { name: `Events gate ${RUN}`, contactEmail: "gate@example.test" } });
    fx = { partnerId: partner.id, assetId: "", jobIds: [], userIds: [], eventIds: [] };
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

    const goal = await R(`/vision/review/events`, { videoAssetId: fx.assetId, type: "goal_candidate", startMs: minute1(20, 15), endMs: minute1(20, 15), actorTrackId: track.id, actorMatchSquadPlayerId: starter.id });
    check("a goal candidate in play proposed", `${goal.status}/${goal.body.promotable}`, "201/true");
    const unaccepted = await R(`/vision/review/events/${goal.body.id}/promote`, {});
    check("…not promotable before acceptance", unaccepted.body.error, "NotAccepted");
    await S(`/vision/review/events/${goal.body.id}/decision`, { decision: "accepted" });
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
    check("…stamped with the candidate", (written?.metadata as any)?.vision?.candidateId === goal.body.id && (written?.metadata as any)?.vision?.contract === "VisionEventPromotionV1", true);
    check("…and the candidate knows", `${created.body.promotedEventId === written?.id}/${created.body.promotionKind}/${created.body.promotedBy === reviewer.id}`, "true/created/true");
    const again = await R(`/vision/review/events/${goal.body.id}/promote`, {});
    check("promoting again: refused", again.body.error, "AlreadyPromoted");
    const lateFix = await reviewer.as(`/vision/review/events/${goal.body.id}`, { method: "PATCH", body: JSON.stringify({ note: "later" }) });
    check("correcting a promoted candidate: refused", lateFix.body.error, "EventPromoted");

    // The recorder logged a goal at 33'. Vision's candidate at 33:20 is the same goal.
    const recorded = await prisma.sbMatchEvent.create({ data: { matchId: match.id, teamId: match.homeTeamId, type: "goal", minute: 33, detail: `gate-${RUN}`, metadata: { source: `gate-${RUN}` } } });
    fx.eventIds.push(recorded.id);
    const same = await R(`/vision/review/events`, { videoAssetId: fx.assetId, type: "goal_candidate", startMs: minute1(33, 20), endMs: minute1(33, 20), actorTrackId: track.id, sbTeamId: match.homeTeamId });
    await S(`/vision/review/events/${same.body.id}/decision`, { decision: "accepted" });
    const enriched = await R(`/vision/review/events/${same.body.id}/promote`, {});
    check("a candidate at 33:20 enriches the recorder's goal at 33'", `${enriched.status}/${enriched.body.promotion?.kind}/${enriched.body.promotion?.eventId === recorded.id}`, "201/enriched/true");
    const after = await prisma.sbMatchEvent.findUnique({ where: { id: recorded.id } });
    check("…the recorder's row keeps its own metadata and gains the stamp", `${(after?.metadata as any)?.source}/${(after?.metadata as any)?.vision?.startMs}`, `gate-${RUN}/${minute1(33, 20)}`);
    check("…its minute untouched, and no second goal added", `${after?.minute}/${await prisma.sbMatchEvent.count({ where: { matchId: match.id, type: "goal" } })}`, "33/2");
    check("…and the whole minute the recorder entered gains Vision's second", `${after?.secondInMinute}/${enriched.body.promotion?.second}`, "20/20");

    // ── 4. The second beside the recorder's minute ───────────────────────
    section("4. A second only under the recorder's own minute, and never over the recorder's word");

    // The recorder logged a goal at 36'. Vision's candidate at 37:05 is the same goal, a minute apart: no second is written under 36.
    const nearby = await prisma.sbMatchEvent.create({ data: { matchId: match.id, teamId: match.homeTeamId, type: "goal", minute: 36, detail: `gate-${RUN}` } });
    fx.eventIds.push(nearby.id);
    const aMinuteOff = await R(`/vision/review/events`, { videoAssetId: fx.assetId, type: "goal_candidate", startMs: minute1(37, 5), endMs: minute1(37, 5), sbTeamId: match.homeTeamId });
    await S(`/vision/review/events/${aMinuteOff.body.id}/decision`, { decision: "accepted" });
    const offByOne = await R(`/vision/review/events/${aMinuteOff.body.id}/promote`, {});
    check("a candidate at 37:05 enriches the recorder's goal at 36'", `${offByOne.body.promotion?.kind}/${offByOne.body.promotion?.eventId === nearby.id}/${offByOne.body.promotion?.minutesApart}`, "enriched/true/1");
    const nearbyAfter = await prisma.sbMatchEvent.findUnique({ where: { id: nearby.id } });
    check("…but writes no second under a minute that is not its own, and leaves the minute", `${nearbyAfter?.secondInMinute}/${nearbyAfter?.minute}/${offByOne.body.promotion?.second}`, "null/36/null");

    // The recorder entered 25' and its fortieth second by hand. Vision's candidate at 25:10 does not overwrite it.
    const byHand = await prisma.sbMatchEvent.create({ data: { matchId: match.id, teamId: match.homeTeamId, type: "goal", minute: 25, secondInMinute: 40, detail: `gate-${RUN}` } });
    fx.eventIds.push(byHand.id);
    const overHand = await R(`/vision/review/events`, { videoAssetId: fx.assetId, type: "goal_candidate", startMs: minute1(25, 10), endMs: minute1(25, 10), sbTeamId: match.homeTeamId });
    await S(`/vision/review/events/${overHand.body.id}/decision`, { decision: "accepted" });
    const kept = await R(`/vision/review/events/${overHand.body.id}/promote`, {});
    const byHandAfter = await prisma.sbMatchEvent.findUnique({ where: { id: byHand.id } });
    check("a second the recorder entered is the recorder's word: enriched, not overwritten", `${kept.body.promotion?.kind}/${byHandAfter?.secondInMinute}/${kept.body.promotion?.second}`, "enriched/40/40");

    const two = await prisma.sbMatchEvent.createManyAndReturn({ data: [40, 42].map((minute) => ({ matchId: match.id, teamId: match.homeTeamId, type: "goal", minute, detail: `gate-${RUN}` })) });
    fx.eventIds.push(...two.map((e) => e.id));
    const between = await R(`/vision/review/events`, { videoAssetId: fx.assetId, type: "goal_candidate", startMs: minute1(41), endMs: minute1(41), sbTeamId: match.homeTeamId });
    await S(`/vision/review/events/${between.body.id}/decision`, { decision: "accepted" });
    const ambiguous = await R(`/vision/review/events/${between.body.id}/promote`, {});
    check("a candidate equally near two recorder goals: refused, not guessed", ambiguous.body.error, "AmbiguousRecorderEvent");

    const offClock = await R(`/vision/review/events`, { videoAssetId: fx.assetId, type: "goal_candidate", startMs: minute1(50), endMs: minute1(50), sbTeamId: match.homeTeamId });
    check("a candidate after the first half's end reads off the clock", offClock.body.matchClock, "after the final whistle");
    await S(`/vision/review/events/${offClock.body.id}/decision`, { decision: "accepted" });
    const noClock = await R(`/vision/review/events/${offClock.body.id}/promote`, { create: true });
    check("…and cannot be promoted: the match record is in match minutes", noClock.body.error, "ClockNotAnchored");

    check("the match record holds exactly the gate's six goals", await prisma.sbMatchEvent.count({ where: { matchId: match.id, type: "goal" } }), 6);
  } catch (error) {
    failures += 1;
    console.error("\nGate aborted:", error);
  } finally {
    await cleanup(fx).catch((e) => console.error("cleanup failed:", e));
    await prisma.$disconnect();
  }

  console.log(`\n${checks - failures}/${checks} checks passed${failures ? ` — ${failures} FAILED` : ""}`);
  process.exitCode = failures ? 1 : 0;
}

void main();
