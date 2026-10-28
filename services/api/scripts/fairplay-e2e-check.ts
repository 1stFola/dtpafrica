/**
 * FairPlay Phase 4 end to end: the real API, the real Edge code and an S3 server.
 *
 *   FAIRPLAY_CHECK_DATABASE_URL=postgresql://…/fp4_scratch pnpm --filter @dtp/api fairplay:e2echeck
 *
 * It needs Docker with two local images, `adobe/s3mock:5.2.3` (the S3 server CI already
 * uses) and `fp-edge-test` (the Edge image with pytest), and a scratch database built by
 * `prisma migrate deploy`. It pulls nothing.
 *
 *   1. starts the S3 server and this API on the scratch database, pointed at each other;
 *   2. through the API's HTTP routes: adds two Edge devices, provisions a session for a
 *      match on the first and one for another match on the second, makes a member, signs
 *      them in and sets their matchday PIN;
 *   3. runs services/fairplay-edge/tests/test_cloud_e2e.py in the Edge image: pairing, the
 *      bundle, the PIN at the venue, a match synced, a 30-minute outage, uploads, a
 *      corrupted object, the wrong match;
 *   4. checks from the cloud: the report, a read URL, the bytes behind it, the audit log.
 *
 * Every byte of "video" is synthetic test data. FairPlay's audit tables are insert-only, so
 * this runs only on a throwaway database.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { seedRbac } from "../src/seed/seed-rbac";

const url = process.env.FAIRPLAY_CHECK_DATABASE_URL ?? "";
if (!/scratch|test|ci/i.test(url.split("/").pop()?.split("?")[0] ?? "")) {
  console.error("Refused: FAIRPLAY_CHECK_DATABASE_URL must name a throwaway database (scratch, test or ci).");
  process.exit(2);
}

const API_PORT = 3190;
const S3_PORT = 9190;
const BUCKET = "fp-e2e-evidence";
const S3_NAME = `fp4-e2e-s3-${randomBytes(3).toString("hex")}`;
const base = `http://127.0.0.1:${API_PORT}/api/v1`;
const apiKey = randomBytes(24).toString("hex");
const prisma = new PrismaClient({ datasourceUrl: url });
let passed = 0;
const failures: string[] = [];
let api: ChildProcess | null = null;
let apiLog = "";

function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) passed += 1;
  else failures.push(label);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok || detail === undefined ? "" : `  ${JSON.stringify(detail)}`}`);
}

async function call<T>(method: string, path: string, body?: unknown, auth: Record<string, string> = { "x-admin-api-key": apiKey }): Promise<T> {
  const send = () => fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", ...auth }, body: body === undefined ? undefined : JSON.stringify(body) });
  // A pooled keep-alive connection the API closed while the Edge step ran resets on reuse; once more on a fresh one.
  const res = await send().catch((e: { cause?: { code?: string } }) => {
    if (e.cause?.code === "ECONNRESET") return send();
    throw e;
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

async function waitFor(what: string, probe: () => Promise<boolean>, seconds = 90) {
  for (let i = 0; i < seconds * 2; i += 1) {
    if (await probe().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${what} did not come up within ${seconds} s`);
}

async function main() {
  console.log("\nStarting the S3 server and the API");
  const s3 = spawnSync("docker", ["run", "-d", "--rm", "--pull", "never", "--name", S3_NAME, "-p", `127.0.0.1:${S3_PORT}:9090`,
    "-e", `COM_ADOBE_TESTING_S3MOCK_STORE_INITIAL_BUCKETS=${BUCKET}`, "adobe/s3mock:5.2.3"], { encoding: "utf8" });
  if (s3.status !== 0) throw new Error(`s3mock: ${s3.stderr}`);
  await waitFor("s3mock", async () => (await fetch(`http://127.0.0.1:${S3_PORT}/${BUCKET}`)).ok);

  const pem = generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  api = spawn(process.execPath, ["-r", "@swc-node/register", "src/main.ts"], {
    cwd: resolve(__dirname, ".."),
    env: { ...process.env, PORT: String(API_PORT), DATABASE_URL: url, ADMIN_API_KEY: apiKey, FAIRPLAY_STORAGE_BACKEND: "r2",
      FAIRPLAY_R2_ENDPOINT: `http://127.0.0.1:${S3_PORT}`, FAIRPLAY_R2_ACCESS_KEY_ID: "e2e", FAIRPLAY_R2_SECRET_ACCESS_KEY: "e2e-not-a-secret",
      FAIRPLAY_R2_BUCKET: BUCKET, FAIRPLAY_BUNDLE_SIGNING_KEY: pem, FAIRPLAY_RETENTION_SWEEP: "off", VISION_ENABLED: "false" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  api.stdout?.on("data", (d) => (apiLog += d));
  api.stderr?.on("data", (d) => (apiLog += d));
  await waitFor("the API", async () => (await fetch(`${base}/health`)).ok, 180).catch((e) => {
    console.error(apiLog.slice(-4000));
    throw e;
  });

  console.log("\nProvisioning through the API");
  await seedRbac(prisma);
  const run = randomUUID().slice(0, 8);
  const comp = await prisma.sbCompetition.create({ data: { slug: `fp-e2e-${run}`, name: `FP e2e ${run}`, season: "2026" } });
  const [home, away] = await Promise.all(["Lions", "Eagles"].map((name) => prisma.sbTeam.create({ data: { competitionId: comp.id, slug: `${name}-${run}`, name } })));
  const match = await prisma.sbMatch.create({ data: { competitionId: comp.id, homeTeamId: home.id, awayTeamId: away.id, kickoffAt: new Date() } });
  const match2 = await prisma.sbMatch.create({ data: { competitionId: comp.id, homeTeamId: away.id, awayTeamId: home.id } });
  const password = randomBytes(12).toString("hex");
  const assessor = await prisma.adminUser.create({ data: { email: `assessor-${run}@example.org`, name: "E2E Assessor", passwordHash: await bcrypt.hash(password, 10),
    roleId: (await prisma.adminRole.findUniqueOrThrow({ where: { slug: "fairplay_assessor" } })).id } });

  const d1 = await call<{ id: string; bootstrapToken: string }>("POST", "/fairplay/devices", { label: "E2E Edge" });
  const d2 = await call<{ id: string; bootstrapToken: string }>("POST", "/fairplay/devices", { label: "E2E other Edge" });
  await call("POST", "/fairplay/device/register", { edgeDeviceId: randomUUID() }, { "x-fairplay-bootstrap-token": d2.bootstrapToken });
  const s1 = await call<{ id: string }>("POST", "/fairplay/sessions", { matchId: match.id, deviceId: d1.id,
    members: [{ adminUserId: assessor.id, permissions: ["fairplay.incident.operate", "fairplay.incident.review"] }] });
  const s2 = await call<{ id: string }>("POST", "/fairplay/sessions", { matchId: match2.id, deviceId: d2.id });
  const login = await call<{ token?: string; accessToken?: string }>("POST", "/admin/auth/login", { email: assessor.email, password }, {});
  const jwt = { Authorization: `Bearer ${login.token ?? login.accessToken}` };
  const pin = String(100000 + (randomBytes(3).readUIntBE(0, 3) % 900000));
  await call("PUT", `/fairplay/sessions/${s1.id}/members/me/pin`, { pin }, jwt);
  check("devices, sessions, a member and their PIN are set up through the API", true);

  console.log("\nThe Edge, in its image");
  const out = mkdtempSync(join(tmpdir(), "fp4-e2e-"));
  const edgeDir = resolve(__dirname, "../../fairplay-edge");
  const win = (p: string) => (process.platform === "win32" ? p.replace(/\\/g, "/") : p);
  const edge = spawnSync("docker", ["run", "--rm", "-v", `${win(edgeDir)}:/src:ro`, "-v", `${win(out)}:/out`,
    "-e", "FAIRPLAY_E2E_TARGET=host.docker.internal", "-e", `FAIRPLAY_E2E_API_PORT=${API_PORT}`, "-e", `FAIRPLAY_E2E_S3_PORT=${S3_PORT}`,
    "-e", `FAIRPLAY_E2E_BUCKET=${BUCKET}`, "-e", `FAIRPLAY_E2E_BOOTSTRAP=${d1.bootstrapToken}`, "-e", `FAIRPLAY_E2E_SESSION=${s1.id}`,
    "-e", `FAIRPLAY_E2E_OTHER_SESSION=${s2.id}`, "-e", `FAIRPLAY_E2E_EMAIL=${assessor.email}`, "-e", `FAIRPLAY_E2E_PIN=${pin}`, "-e", "FAIRPLAY_E2E_OUT=/out",
    "fp-edge-test", "sh", "-c",
    "mkdir /tmp/w && tar -C /src --exclude=./fixtures/out -cf - . | tar -C /tmp/w -xf - && cd /tmp/w && python -m pytest -q -s -p no:cacheprovider tests/test_cloud_e2e.py"],
    { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" }, timeout: 600_000 });
  const lines = (edge.stdout ?? "").split("\n").filter((l) => /^(PASS|FAIL) /.test(l));
  for (const l of lines) check(`edge: ${l.slice(6)}`, l.startsWith("PASS"));
  if (edge.status !== 0 || !lines.length) {
    const why = (edge.stdout ?? "").split("\n").filter((l) => /^E |^(FAILED|ERROR) |Error:|\.py:\d+: /.test(l));
    console.log(why.slice(0, 60).join("\n"), (edge.stderr ?? "").slice(-2000));
    check("the Edge's run completed", false, edge.status);
  }

  console.log("\nFrom the cloud");
  const results = JSON.parse(readFileSync(join(out, "edge-results.json"), "utf8")) as { evidence: { id: string; sha256: string }[] };
  const report = await call<{ incidents: { finding: { result: string } | null; evidence: { id: string; stored: string; released: boolean }[] }[] }>(
    "GET", `/fairplay/sessions/${s1.id}/report`, undefined, jwt);
  check("the report holds the three incidents with their findings", report.incidents.length === 3 && report.incidents.every((i) => i.finding?.result === "supports_original"));
  check("and every clip released and stored", report.incidents.every((i) => i.evidence.length === 1 && i.evidence[0].released && i.evidence[0].stored === "stored"));
  for (const ev of results.evidence) {
    const read = await call<{ url: string }>("POST", `/fairplay/evidence/${ev.id}/read-url`, { kind: "clip", reason: "e2e check" }, jwt);
    const bytes = Buffer.from(await (await fetch(read.url)).arrayBuffer());
    check(`the read URL for ${ev.id.slice(0, 8)} serves the Edge's exact bytes`, createHash("sha256").update(bytes).digest("hex") === ev.sha256);
  }
  const reads = await prisma.fairPlayAuditLog.count({ where: { action: "evidence.read", actorId: assessor.id, reason: "e2e check" } });
  check("each read is in the audit log with its reason", reads === results.evidence.length, reads);
  const chain = await prisma.fairPlayEdgeAuditEntry.groupBy({ by: ["chainStatus"], _count: true });
  check("every Edge audit entry recomputed and chained in the cloud", chain.length === 1 && chain[0].chainStatus === "ok", chain);
  const corrupt = await prisma.fairPlayAuditLog.count({ where: { action: "upload.corrupt" } });
  check("the corrupted object is in the cloud audit log", corrupt === 1, corrupt);

  console.log(`\n${passed}/${passed + failures.length} passed${failures.length ? ` — FAILED: ${failures.join("; ")}` : ""}`);
  process.exitCode = failures.length ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    console.error(`
API log, last part:
${apiLog.slice(-3000)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    api?.kill();
    spawnSync("docker", ["stop", S3_NAME], { encoding: "utf8" });
    await prisma.$disconnect();
  });
