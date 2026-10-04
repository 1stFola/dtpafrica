/**
 * Phase 4 Increment 6 gate — identity accuracy and unknown precision, measured.
 *
 *   pnpm --filter @dtp/api vision:identitymetricscheck
 *
 * Needs the API on :3000 (`VISION_E2E_API`), whatever `DATABASE_URL` points at
 * (never production) holding a ScoreBoard match with squad players on both
 * teams, and the seeded `vision_reviewer` and `vision_admin` roles. The gate
 * seeds one gold member whose kit clustering sided six tracks as the worked
 * example in identity-metrics.spec.ts, has two signed-in people name and accept
 * five of them, and asks the ledger for the number.
 *
 * Three claims are on trial:
 *
 *   1. An identify version cannot be scored until every gold member has its
 *      sides decided and someone's identity has been accepted by a second
 *      person; an unaccepted identity is not truth.
 *   2. The run is created complete, with no job, and its rows are the numbers
 *      worked out by hand: team accuracy 2/3, coverage 3/5, unknown precision
 *      1/2, over five tracks, with a slice per kit colour.
 *   3. The version moves candidate -> benchmarked, the verdict is
 *      unthresholded, and the audit trail says the control plane scored it.
 */
import { randomBytes, randomUUID } from "node:crypto";
import * as bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";
import { VISION_CONTRACT_VERSION, visionKeys } from "@dtp/vision-contracts";
import { loadApiEnv } from "../src/shared/load-dotenv";
import { assertDevDatabase, createGateMatch, onInterrupt, removeGateMatch, type GateMatch } from "./gate-harness";

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
const as = (token: string) => ({
  post: (path: string, body: unknown) => call(path, { Authorization: `Bearer ${token}` }, { method: "POST", body: JSON.stringify(body) }),
});

type Fixture = { partnerId: string; assetId: string; datasetId: string | null; modelIds: string[]; jobIds: string[]; trackIds: string[]; userIds: string[] };

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
  await prisma.visionBenchmarkRun.deleteMany({ where: { modelVersion: { modelId: { in: fx.modelIds } } } });
  if (fx.datasetId) {
    await prisma.visionDatasetMember.deleteMany({ where: { datasetVersionId: fx.datasetId } });
    await prisma.visionDatasetVersion.deleteMany({ where: { id: fx.datasetId } });
  }
  await prisma.visionVideoAsset.deleteMany({ where: { id: fx.assetId } });
  await prisma.visionModel.deleteMany({ where: { id: { in: fx.modelIds } } });
  await prisma.visionAuditLog.deleteMany({ where: { OR: [{ actorId: { in: fx.userIds } }, { targetId: { in: [...fx.jobIds, ...fx.trackIds, ...fx.modelIds, fx.assetId] } }, { targetKind: "vision_benchmark_run", data: { path: ["modelVersionId"], string_contains: "" } }] } }).catch(() => undefined);
  await prisma.adminUser.deleteMany({ where: { id: { in: fx.userIds } } });
  await prisma.visionRightsScope.deleteMany({ where: { partnerId: fx.partnerId } });
  await prisma.visionSourceVideoRecord.deleteMany({ where: { partnerId: fx.partnerId } });
  await prisma.visionSourcePartner.deleteMany({ where: { id: fx.partnerId } });
  await removeGateMatch(prisma, gateMatch);
}

async function main() {
  assertDevDatabase({ api: API });
  console.log("Vision identity metrics — team accuracy and unknown precision, by hand");
  console.log(`  api ${API}`);
  console.log(`  run ${RUN}`);

  let fx: Fixture | null = null;
  onInterrupt(async () => {
    await cleanup(fx);
    await prisma.$disconnect();
  });
  try {
    const match = await matchWithSquads();
    const home = match.squadPlayers.filter((s) => s.teamId === match.homeTeamId && s.playerId);
    const away = match.squadPlayers.filter((s) => s.teamId === match.awayTeamId && s.playerId);

    const partner = await prisma.visionSourcePartner.create({ data: { name: `Identity metrics gate ${RUN}`, contactEmail: "gate@example.test" } });
    fx = { partnerId: partner.id, assetId: "", datasetId: null, modelIds: [], jobIds: [], trackIds: [], userIds: [] };
    const record = await prisma.visionSourceVideoRecord.create({
      data: { partnerId: partner.id, title: `Identity metrics gate record ${RUN}`, sourceQualityRank: "broadcast", originalAvailable: true, acquisitionStatus: "acquired", acquisitionMethod: "partner_direct_upload" },
    });
    await prisma.visionRightsScope.create({
      data: { partnerId: partner.id, grantLevel: "partner", canAnalyze: true, canTrain: true, canPublishHighlight: false, canShareWithScout: false, grantedAt: new Date() },
    });
    const checksum = randomUUID().replace(/-/g, "").padEnd(64, "0").slice(0, 64);
    const asset = await prisma.visionVideoAsset.create({
      data: {
        sourceVideoRecordId: record.id, sbMatchId: match.id, corpus: "dtp_owned", objectKey: `originals/gate-${RUN}-identity-metrics/source.mp4`, bytes: BigInt(1024), mimeType: "video/mp4",
        checksumSha256: checksum, width: 1280, height: 720, durationMs: 120_000, ingestState: "ready",
      },
    });
    fx.assetId = asset.id;

    // The identify version under test, and a frozen dataset with the asset as gold.
    const model = await post("/vision/models", { key: `identify/gate-${RUN}`, task: "identify" });
    fx.modelIds.push(String(model.body.id));
    const version = await post(`/vision/models/${model.body.id}/versions`, {
      version: "0.1", gitCommit: "3eeec6e0", configKey: "kits.Params()", workerImage: "dtp-vision-worker:0.1",
      licenceNote: "In-house kit colour clustering (dtp_vision_worker/kits.py); standard library only.",
    });
    const versionId = String(version.body.id);
    const dataset = await prisma.visionDatasetVersion.create({
      data: { label: `gate-${RUN}-identity`, frozenAt: new Date(), frozenBy: "gate", members: { create: { videoAssetId: asset.id, checksumSha256: checksum, split: "gold", groupKey: `g-${RUN}`, sbMatchId: match.id } } },
    });
    fx.datasetId = dataset.id;

    const job = async (type: string, extra: Record<string, unknown> = {}) => {
      const id = randomUUID();
      fx!.jobIds.push(id);
      await prisma.visionJob.create({
        data: { id, type, resourceClass: "cpu_small", state: "succeeded", videoAssetId: asset.id, inputSpec: {}, outputPrefix: visionKeys.inferencePrefix(id, 1), budgetSeconds: 600, budgetUsdCents: 100, contractVersion: VISION_CONTRACT_VERSION, finishedAt: new Date(), ...extra },
      });
      return id;
    };
    await job("transcode");
    await job("detect");
    const trackJob = await job("track");
    const identifyJob = await job("identify", { modelVersionId: versionId });

    /* Six tracks, as identity-metrics.spec.ts works them by hand:
         t1 sided A, nearest A, truth home       -> right
         t2 sided B, nearest B, truth away       -> right
         t3 sided A, nearest A, truth away       -> wrong
         t4 abstained, nearest A, truth home     -> abstention not needed
         t5 abstained, nearest B, truth home     -> abstention avoided a mistake
         t6 goalkeeper, not clustered            -> out of scope
       and t7, abstained, nearest B, whose identity is assigned but never accepted. */
    const sides = [
      { team: "A", nearest: "A", method: "kit_cluster", kit: "red" },
      { team: "B", nearest: "B", method: "kit_cluster", kit: "blue" },
      { team: "A", nearest: "A", method: "kit_cluster", kit: "red" },
      { team: null, nearest: "A", method: "kit_cluster", kit: "red" },
      { team: null, nearest: "B", method: "kit_cluster", kit: "blue" },
      { team: null, nearest: null, method: "not_clustered", kit: null },
      { team: null, nearest: "B", method: "kit_cluster", kit: "blue" },
    ];
    for (let i = 0; i < sides.length; i += 1) {
      const t = await prisma.visionTrack.create({
        data: { videoAssetId: asset.id, inferenceJobId: trackJob, localTrackId: i + 1, class: i === 5 ? "goalkeeper" : "player", startMs: 9000, endMs: 19000, startFrame: 0, endFrame: 250, detectionCount: 250, confirmed: true, artifactKey: `${visionKeys.inferencePrefix(trackJob, 1)}tracks.json` },
      });
      fx.trackIds.push(t.id);
      const s = sides[i]!;
      await prisma.visionTeamAssignment.create({
        data: { trackId: t.id, inferenceJobId: identifyJob, team: s.team, nearestTeam: s.nearest, confidence: s.team ? 0.9 : s.nearest ? 0.05 : null, method: s.method, kitDescription: s.kit, identifyVersionId: versionId },
      });
    }
    const [t1, t2, t3, t4, t5, , t7] = fx.trackIds as string[];

    const reviewer = await person(fx, "vision_reviewer", "reviewer");
    const second = await person(fx, "vision_admin", "second");
    const R = as(reviewer.token);
    const S = as(second.token);

    // ── 1. Refusals ──────────────────────────────────────────────────────
    section("1. No number until the sides are decided and a second person has accepted a name");

    const undecided = await post(`/vision/models/versions/${versionId}/benchmark`, { datasetVersionId: dataset.id });
    check("sides not decided: refused", undecided.body.error, "SidesNotDecided");
    check("…naming the job", undecided.body.jobs?.[0], identifyJob);
    await R.post(`/vision/review/jobs/${identifyJob}/sides`, { A: match.homeTeamId, B: match.awayTeamId });

    const unnamed = await post(`/vision/models/versions/${versionId}/benchmark`, { datasetVersionId: dataset.id });
    check("nobody named: refused", unnamed.body.error, "IdentitiesMissing");

    const name = async (trackId: string, slotId: string, accept: boolean, overrule = false) => {
      const assigned = await R.post(`/vision/review/tracks/${trackId}/identity`, { matchSquadPlayerId: slotId, acceptSideMismatch: overrule || undefined });
      if (assigned.status !== 201) throw new Error(`assign failed: ${JSON.stringify(assigned.body).slice(0, 200)}`);
      if (accept) {
        const accepted = await S.post(`/vision/review/identity/${assigned.body.assignment.id}/accept`, {});
        if (accepted.status !== 201) throw new Error(`accept failed: ${JSON.stringify(accepted.body).slice(0, 200)}`);
      }
    };
    await name(t1!, home[0]!.id, true);
    await name(t2!, away[0]!.id, true);
    await name(t3!, away[1]!.id, true, true); // the kit said home; the person says away, overruling it
    await name(t4!, home[1]!.id, true);
    await name(t5!, home[2]!.id, true);
    await name(t7!, away[0]!.id, false); // assigned, never accepted: not truth

    const stranger = await post(`/vision/models/versions/${versionId}/benchmark`, { datasetVersionId: randomUUID() });
    check("an unknown dataset: refused", stranger.status, 404);

    // ── 2. The number ────────────────────────────────────────────────────
    section("2. The run is created complete, with the numbers by hand");

    const requested = await post(`/vision/models/versions/${versionId}/benchmark`, { datasetVersionId: dataset.id });
    check("the request completes at once", `${requested.status}/${requested.body.state}`, "201/completed");
    check("…with no job", requested.body.jobId, null);
    check("…over five tracks with an accepted identity", requested.body.scored?.tracks, 5);
    check("…three of them sided", requested.body.scored?.sided, 3);
    check("…two abstentions judged", requested.body.scored?.abstained, 2);
    check("…the goalkeeper out of scope", requested.body.scored?.outOfScope, 1);
    check("…and the unaccepted one without truth", requested.body.scored?.withoutTruth, 1);
    const runId = String(requested.body.id);

    const run = await api(`/vision/models/benchmarks/${runId}`);
    const metric = (m: string, slice = "all") => (run.body.run?.metrics ?? []).find((x: any) => x.metric === m && x.slice === slice);
    check("team accuracy 2/3", metric("team_accuracy:all")?.value, 0.6667);
    check("…on three sided tracks", metric("team_accuracy:all")?.support, 3);
    check("coverage 3/5", metric("team_coverage:all")?.value, 0.6);
    check("unknown precision 1/2", metric("unknown_precision:all")?.value, 0.5);
    check("…on two abstentions", metric("unknown_precision:all")?.support, 2);
    check("five tracks", metric("tracks:all")?.value, 5);
    check("a slice per kit: red accuracy 1/2", metric("team_accuracy:all", "kit:red")?.value, 0.5);
    check("…blue abstention was right", metric("unknown_precision:all", "kit:blue")?.value, 1);
    check("…red abstention was not", metric("unknown_precision:all", "kit:red")?.value, 0);
    check("the verdict is unthresholded", run.body.run?.verdict, "unthresholded");
    check("…under the configured version", typeof run.body.run?.thresholdsVersion, "string");
    check("the summary counts tracks, not frames", run.body.run?.summary?.unit, "tracks");

    // ── 3. The ledger ────────────────────────────────────────────────────
    section("3. The ledger moved the version and wrote it down");

    const v = await api(`/vision/models/versions/${versionId}`);
    check("candidate -> benchmarked", v.body.version?.stage, "benchmarked");
    const rows = await prisma.visionMetricResult.count({ where: { benchmarkRunId: runId } });
    check("metric rows: four metrics on three slices", rows, 12);
    const audit = await prisma.visionAuditLog.findMany({ where: { targetId: runId }, select: { action: true, data: true } });
    check("audit: requested and benchmarked", audit.map((a) => a.action).sort().join(","), "model.benchmark.requested,model.benchmarked");
    check("…and the control plane said it scored it", (audit.find((a) => a.action === "model.benchmark.requested")?.data as any)?.scoredBy, "control_plane");

    const again = await post(`/vision/models/versions/${versionId}/benchmark`, { datasetVersionId: dataset.id });
    check("a second request is a second run with the same number", `${again.body.state}/${again.body.id !== runId}`, "completed/true");
    const runs = await prisma.visionBenchmarkRun.count({ where: { modelVersionId: versionId, state: "completed" } });
    check("…two completed runs on the version", runs, 2);
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
