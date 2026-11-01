/**
 * FairPlay's stakeholder demo: a throwaway cloud on this machine (docs/fairplay/demo-walkthrough.md).
 *
 *   FAIRPLAY_CHECK_DATABASE_URL=postgresql://…/fp_demo_scratch pnpm --filter @dtp/api fairplay:democloud -- <file>
 *
 * It starts the S3 server CI uses and this API on a scratch database, makes a pretend competition,
 * match, Edge device and session, and writes the one-time token and the sign-in details to <file>,
 * which is for the presenter's eyes only. It stays up until Ctrl-C. It pulls nothing, and touches no
 * real bucket, no real data and no production setting. FairPlay's audit tables are insert-only, so
 * this runs only on a throwaway database.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { generateKeyPairSync, randomBytes, randomInt } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { seedRbac } from "../src/seed/seed-rbac";

const url = process.env.FAIRPLAY_CHECK_DATABASE_URL ?? "";
if (!/scratch|test|ci/i.test(url.split("/").pop()?.split("?")[0] ?? "")) {
  console.error("Refused: FAIRPLAY_CHECK_DATABASE_URL must name a throwaway database (scratch, test or ci).");
  process.exit(2);
}
const file = process.argv[2] === "--" ? process.argv[3] : process.argv[2];
if (!file) {
  console.error("Say where to write the sign-in details: pnpm fairplay:democloud -- <file>");
  process.exit(2);
}

const API_PORT = 3190;
const S3_PORT = 9190;
const BUCKET = "fp-demo-evidence";
const S3_NAME = `fp-demo-s3-${randomBytes(3).toString("hex")}`;
const base = `http://127.0.0.1:${API_PORT}/api/v1`;
const apiKey = randomBytes(24).toString("hex");
const prisma = new PrismaClient({ datasourceUrl: url });
const EVERY_VENUE_JOB = ["fairplay.incident.operate", "fairplay.incident.review", "fairplay.session.manage", "fairplay.edge.admin",
  "fairplay.evidence.view_original", "fairplay.evidence.export"];
let api: ChildProcess | null = null;
let apiLog = "";

async function call<T>(method: string, path: string, body?: unknown, auth: Record<string, string> = { "x-admin-api-key": apiKey }): Promise<T> {
  const res = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", ...auth }, body: body === undefined ? undefined : JSON.stringify(body) });
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

function stop() {
  api?.kill();
  spawnSync("docker", ["stop", S3_NAME], { encoding: "utf8" });
}

async function main() {
  const s3 = spawnSync("docker", ["run", "-d", "--rm", "--pull", "never", "--name", S3_NAME, "-p", `127.0.0.1:${S3_PORT}:9090`,
    "-e", `COM_ADOBE_TESTING_S3MOCK_STORE_INITIAL_BUCKETS=${BUCKET}`, "adobe/s3mock:5.2.3"], { encoding: "utf8" });
  if (s3.status !== 0) throw new Error(`s3mock: ${s3.stderr}`);
  await waitFor("s3mock", async () => (await fetch(`http://127.0.0.1:${S3_PORT}/${BUCKET}`)).ok);

  const pem = generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  api = spawn(process.execPath, ["-r", "@swc-node/register", "src/main.ts"], {
    cwd: resolve(__dirname, ".."),
    env: { ...process.env, PORT: String(API_PORT), DATABASE_URL: url, ADMIN_API_KEY: apiKey, FAIRPLAY_STORAGE_BACKEND: "r2",
      FAIRPLAY_R2_ENDPOINT: `http://127.0.0.1:${S3_PORT}`, FAIRPLAY_R2_ACCESS_KEY_ID: "demo", FAIRPLAY_R2_SECRET_ACCESS_KEY: "demo-not-a-secret",
      FAIRPLAY_R2_BUCKET: BUCKET, FAIRPLAY_BUNDLE_SIGNING_KEY: pem, FAIRPLAY_RETENTION_SWEEP: "off", VISION_ENABLED: "false" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  api.stdout?.on("data", (d) => (apiLog += d));
  api.stderr?.on("data", (d) => (apiLog += d));
  await waitFor("the API", async () => (await fetch(`${base}/health`)).ok, 180);

  await seedRbac(prisma);
  const run = randomBytes(3).toString("hex");
  const comp = await prisma.sbCompetition.create({ data: { slug: `fp-demo-${run}`, name: "FairPlay demo (synthetic)", season: "2026" } });
  const [home, away] = await Promise.all(["Demo Lions", "Demo Eagles"].map((name) => prisma.sbTeam.create({ data: { competitionId: comp.id, slug: `${name.split(" ")[1].toLowerCase()}-${run}`, name } })));
  const match = await prisma.sbMatch.create({ data: { competitionId: comp.id, homeTeamId: home.id, awayTeamId: away.id, kickoffAt: new Date() } });
  const password = randomBytes(12).toString("hex");
  const presenter = await prisma.adminUser.create({ data: { email: `presenter-${run}@example.org`, name: "Demo Presenter", passwordHash: await bcrypt.hash(password, 10),
    roleId: (await prisma.adminRole.findUniqueOrThrow({ where: { slug: "super_admin" } })).id } });
  const device = await call<{ id: string; bootstrapToken: string }>("POST", "/fairplay/devices", { label: "Demo Edge (synthetic)" });
  const session = await call<{ id: string }>("POST", "/fairplay/sessions", { matchId: match.id, deviceId: device.id, angleMode: "multi",
    members: [{ adminUserId: presenter.id, permissions: EVERY_VENUE_JOB }] });
  const login = await call<{ token?: string; accessToken?: string }>("POST", "/admin/auth/login", { email: presenter.email, password }, {});
  const pin = String(randomInt(10000000, 100000000));
  await call("PUT", `/fairplay/sessions/${session.id}/members/me/pin`, { pin }, { Authorization: `Bearer ${login.token ?? login.accessToken}` });

  writeFileSync(file!, JSON.stringify({ apiPort: API_PORT, s3Port: S3_PORT, matchId: match.id, sessionId: session.id, bootstrapToken: device.bootstrapToken,
    email: presenter.email, password, pin, webProxy: `http://127.0.0.1:${API_PORT}` }, null, 2), { mode: 0o600 });
  console.log(`The demo's cloud is up on ${base}. Sign-in details are in ${file}. Ctrl-C stops it.`);
}

process.on("SIGINT", () => { stop(); process.exit(0); });
process.on("SIGTERM", () => { stop(); process.exit(0); });
main().catch((e) => {
  console.error(e);
  console.error(apiLog.slice(-3000));
  stop();
  process.exit(1);
});
