/**
 * FairPlay Phase 5.4: the cloud's security checks, through the API's real HTTP routes.
 *
 *   FAIRPLAY_CHECK_DATABASE_URL=postgresql://…/fp54_scratch pnpm --filter @dtp/api fairplay:securitycheck
 *
 * It needs Docker with `adobe/s3mock:5.2.3` (local; nothing is pulled) and a scratch database
 * built by `prisma migrate deploy`, and it builds the admin web app and the venue console.
 *
 *   - pairing: no, a guessed, a used or a retired device's bootstrap token is refused;
 *   - every device route refuses no token, a guessed one, an admin key or session, and a
 *     token in the wrong header; re-pairing rotates the token and the old one stops at once;
 *   - every admin route refuses no sign-in and an account with no FairPlay role, and an
 *     organiser is refused every route that is not theirs (read from the controller);
 *   - a competition's manager and organiser are kept to their competition: another's
 *     session, report, sync state, members and evidence look the same as ones that do not
 *     exist, and so does a guessed id;
 *   - a role taken away mid-match ends access at the next request and leaves the member out
 *     of the next bundle; a deactivated account is signed out;
 *   - every read of evidence is audited, with who and why;
 *   - no secret in the API's log, in its responses, or in either web bundle.
 *
 * Every byte of "video" is synthetic. FairPlay's audit tables are insert-only, so this runs
 * only on a throwaway database.
 */
import "reflect-metadata";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash, generateKeyPairSync, randomBytes, randomInt, randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { REQUIRE_PERMISSIONS_KEY } from "../src/admin/decorators/require-permissions.decorator";
import { canonical, sha256Hex } from "../src/fairplay/canonical";
import { FairPlayAdminController } from "../src/fairplay/fairplay-admin.controller";
import { seedRbac } from "../src/seed/seed-rbac";

const url = process.env.FAIRPLAY_CHECK_DATABASE_URL ?? "";
if (!/scratch|test|ci/i.test(url.split("/").pop()?.split("?")[0] ?? "")) {
  console.error("Refused: FAIRPLAY_CHECK_DATABASE_URL must name a throwaway database (scratch, test or ci).");
  process.exit(2);
}

const API_PORT = 3191;
const S3_PORT = 9191;
const BUCKET = "fp-sec-evidence";
const S3_NAME = `fp54-sec-s3-${randomBytes(3).toString("hex")}`;
const base = `http://127.0.0.1:${API_PORT}/api/v1`;
const apiKey = randomBytes(24).toString("hex");
const r2Secret = randomBytes(24).toString("hex");
const prisma = new PrismaClient({ datasourceUrl: url });
const secrets: { name: string; value: string }[] = [];
const keep = (name: string, value: string) => (secrets.push({ name, value }), value);
/** Every answer the API gave, to look for secrets in. */
const answers: { method: string; path: string; status: number; text: string }[] = [];
// The routes whose job is to hand out a credential, once, to whoever asked for it.
const ISSUERS = /^POST \/(fairplay\/devices|fairplay\/devices\/[^/]+\/re-pair|fairplay\/device\/register|admin\/auth\/login)$/;
let passed = 0;
const failures: string[] = [];
let api: ChildProcess | null = null;
let apiLog = "";

function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) passed += 1;
  else failures.push(label);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok || detail === undefined ? "" : `  ${JSON.stringify(detail)}`}`);
}

type Answer = { status: number; body: Record<string, unknown> | null; text: string };

async function http(method: string, path: string, headers: Record<string, string> = {}, body?: unknown): Promise<Answer> {
  const send = () => fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await send().catch((e: { cause?: { code?: string } }) => {
    if (e.cause?.code === "ECONNRESET") return send();
    throw e;
  });
  const text = await res.text();
  answers.push({ method, path, status: res.status, text });
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed, text };
}

async function ok<T>(method: string, path: string, headers: Record<string, string>, body?: unknown): Promise<T> {
  const r = await http(method, path, headers, body);
  if (r.status >= 300) throw new Error(`${method} ${path}: ${r.status} ${r.text}`);
  return r.body as T;
}

async function waitFor(what: string, probe: () => Promise<boolean>, seconds = 90) {
  for (let i = 0; i < seconds * 2; i += 1) {
    if (await probe().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${what} did not come up within ${seconds} s`);
}

const hash = (payload: unknown) => sha256Hex(canonical(payload));
const item = (entityType: string, entityId: string, version: number, payload: Record<string, unknown>) =>
  ({ idempotencyKey: `${entityType}:${entityId}:${version}`, entityType, entityId, version, payloadHash: hash(payload), payload });
/** A 404's words with the id taken out, so another record's answer can be set beside a guessed one's. */
const shape = (a: Answer) => JSON.stringify({ status: a.status, error: a.body?.error, message: String(a.body?.message ?? "").replace(/[0-9a-f-]{36}/g, "<id>") });

/** The admin routes, read from the controller: method, path and the permissions any one of which lets a caller in. */
function adminRoutes() {
  const proto = FairPlayAdminController.prototype as unknown as Record<string, object>;
  return Object.getOwnPropertyNames(proto).filter((n) => n !== "constructor").flatMap((name) => {
    const handler = proto[name];
    const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
    if (path === undefined) return [];
    const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number];
    const perms = (Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, handler) ?? []) as string[];
    return [{ name, method, path: `/fairplay/${path}`, perms }];
  });
}
const fill = (path: string, id: string = randomUUID()) => path.replace(/:(\w+)/g, () => id);

/** A session's records, synced by its Edge as the real one would: rights, an incident reviewed, its evidence released, uploaded. */
async function syncReleasedEvidence(token: string, edgeId: string, sessionId: string, matchId: string, reviewer: string) {
  const t0 = "2026-10-30T15:00:00.000Z";
  const incidentId = randomUUID();
  const reviewId = randomUUID();
  const evidenceId = randomUUID();
  const clip = Buffer.from(`synthetic clip ${evidenceId}`.repeat(500));
  const manifest = Buffer.from(JSON.stringify({ schema: "fairplay.evidence-manifest/v1", id: evidenceId }));
  const rights = { id: randomUUID(), session_id: sessionId, footage_kind: "synthetic", status: "not_recorded", minors_present: "no",
    basis: null, consent_reference: null, recorded_by: reviewer, recorded_name: "assessor", created_utc: t0, supersedes: null };
  const inc = (version: number, state: string, extra: Record<string, unknown> = {}) => ({ id: incidentId, session_id: sessionId, match_id: matchId,
    event_utc: "2026-10-30T15:23:10.000Z", basis: "manual", pre_roll_ms: 20000, post_roll_ms: 10000, category: "foul", note: "contact",
    period: "first_half", match_minute: 23, match_second: 10, sheet_event_id: null, player_ref: null, observed_windows: null, state, version,
    hold_id: null, current_review_id: null, reopened_count: 0, created_by: reviewer, created_utc: t0, updated_utc: t0, ...extra });
  const review = (version: number, state: string, extra: Record<string, unknown> = {}) => ({ id: reviewId, incident_id: incidentId, incident_version: 2,
    reviewer_id: reviewer, reviewer_name: "Assessor", state, authority_mode: "shadow", on_field_decision: "play on", result: null,
    factual_notes: null, evidence_ids: null, footage_states: null, version, started_utc: t0, completed_at: null, superseded_by: null,
    superseded_reason: null, ...extra });
  const ev = (state: string, extra: Record<string, unknown> = {}) => ({ id: evidenceId, incident_id: incidentId, incident_version: 3, session_id: sessionId,
    source: "ground", job_id: randomUUID(), state, derivation: "copy", footage_kind: "synthetic", window_start_utc: "2026-10-30T15:22:50.000Z",
    window_duration_ms: 30000, coverage: "full", covered_ms: 30000, duration_ms: 30120, rel_path: `x/${evidenceId}.mp4`, bytes: clip.length,
    sha256: sha256Hex(clip), manifest_rel_path: `x/${evidenceId}.json`, manifest_sha256: sha256Hex(manifest), source_segment_ids: ["seg-1"],
    approved_by: null, approved_name: null, approved_utc: null, created_by: reviewer, created_utc: t0, ...extra });
  const items = [
    item("rights", rights.id, 1, rights),
    item("incident", incidentId, 1, inc(1, "flagged")),
    item("incident", incidentId, 2, inc(2, "reviewing", { current_review_id: reviewId })),
    item("review", reviewId, 1, review(1, "open")),
    item("review", reviewId, 2, review(2, "completed", { result: "supports_original", factual_notes: "Ball first.", completed_at: "2026-10-30T15:59:00.000Z" })),
    item("incident", incidentId, 3, inc(3, "reviewed", { current_review_id: reviewId })),
    item("evidence", evidenceId, 1, ev("ready")),
    item("evidence", evidenceId, 2, ev("approved", { approved_by: reviewer, approved_name: "Assessor", approved_utc: "2026-10-30T16:00:00.000Z" })),
  ];
  const device = { "x-fairplay-device-token": token };
  const sent = await ok<{ results: { status: string; message?: string }[] }>("POST", "/fairplay/sync/batch", device, { deviceId: edgeId, items });
  if (!sent.results.every((r) => r.status === "applied")) throw new Error(`sync: ${JSON.stringify(sent.results)}`);
  for (const [kind, bytes] of [["clip", clip], ["manifest", manifest]] as const) {
    const put = await ok<{ upload: { url: string; headers: Record<string, string> } }>("POST", `/fairplay/device/evidence/${evidenceId}/uploads`, device,
      { kind, bytes: bytes.length, sha256: sha256Hex(bytes) });
    const res = await fetch(put.upload.url, { method: "PUT", headers: put.upload.headers, body: bytes });
    if (!res.ok) throw new Error(`PUT ${kind}: ${res.status} ${await res.text()}`);
    await ok("POST", `/fairplay/device/evidence/${evidenceId}/uploads/${kind}/confirm`, device);
  }
  return { evidenceId, sha256: sha256Hex(clip) };
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? filesUnder(p) : [p];
  });
}

async function main() {
  console.log("\nStarting the S3 server and the API");
  const s3 = spawnSync("docker", ["run", "-d", "--rm", "--pull", "never", "--name", S3_NAME, "-p", `127.0.0.1:${S3_PORT}:9090`,
    "-e", `COM_ADOBE_TESTING_S3MOCK_STORE_INITIAL_BUCKETS=${BUCKET}`, "adobe/s3mock:5.2.3"], { encoding: "utf8" });
  if (s3.status !== 0) throw new Error(`s3mock: ${s3.stderr}`);
  await waitFor("s3mock", async () => (await fetch(`http://127.0.0.1:${S3_PORT}/${BUCKET}`)).ok);
  const pem = generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  keep("the bundle signing key", pem.split("\n")[1]);
  keep("the admin API key", apiKey);
  keep("the R2 secret", r2Secret);
  api = spawn(process.execPath, ["-r", "@swc-node/register", "src/main.ts"], {
    cwd: resolve(__dirname, ".."),
    env: { ...process.env, PORT: String(API_PORT), DATABASE_URL: url, ADMIN_API_KEY: apiKey, FAIRPLAY_STORAGE_BACKEND: "r2",
      FAIRPLAY_R2_ENDPOINT: `http://127.0.0.1:${S3_PORT}`, FAIRPLAY_R2_ACCESS_KEY_ID: "sec-check", FAIRPLAY_R2_SECRET_ACCESS_KEY: r2Secret,
      FAIRPLAY_R2_BUCKET: BUCKET, FAIRPLAY_BUNDLE_SIGNING_KEY: pem, FAIRPLAY_RETENTION_SWEEP: "off", VISION_ENABLED: "false" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  api.stdout?.on("data", (d) => (apiLog += d));
  api.stderr?.on("data", (d) => (apiLog += d));
  await waitFor("the API", async () => (await fetch(`${base}/health`)).ok, 180).catch((e) => {
    console.error(apiLog.slice(-4000));
    throw e;
  });

  console.log("\nSetting up: two competitions, their people, devices and sessions");
  await seedRbac(prisma);
  const run = randomUUID().slice(0, 8);
  const admin = { "x-admin-api-key": apiKey };
  const comp = (n: string) => prisma.sbCompetition.create({ data: { slug: `fp-sec-${n}-${run}`, name: `FP sec ${n} ${run}`, season: "2026" } });
  const [c1, c2] = [await comp("one"), await comp("two")];
  const team = (c: { id: string }, n: string) => prisma.sbTeam.create({ data: { competitionId: c.id, slug: `${n}-${run}`, name: n } });
  const [lions, eagles, rams, bulls] = [await team(c1, "Lions"), await team(c1, "Eagles"), await team(c2, "Rams"), await team(c2, "Bulls")];
  const matchA = await prisma.sbMatch.create({ data: { competitionId: c1.id, homeTeamId: lions.id, awayTeamId: eagles.id, kickoffAt: new Date() } });
  const matchC = await prisma.sbMatch.create({ data: { competitionId: c2.id, homeTeamId: rams.id, awayTeamId: bulls.id, kickoffAt: new Date() } });
  const roleId = async (slug: string) => (await prisma.adminRole.findUniqueOrThrow({ where: { slug } })).id;
  const person = async (name: string, role: string, competitions: string[] = []) => {
    const password = keep(`${name}'s password`, randomBytes(12).toString("hex"));
    const user = await prisma.adminUser.create({ data: { email: `${name}-${run}@example.org`, name, passwordHash: await bcrypt.hash(password, 10),
      roleId: await roleId(role), competitions: { create: competitions.map((competitionId) => ({ competitionId })) } } });
    const login = await ok<{ token?: string; accessToken?: string }>("POST", "/admin/auth/login", {}, { email: user.email, password });
    const jwt = keep(`${name}'s session`, String(login.token ?? login.accessToken));
    return { user, auth: { Authorization: `Bearer ${jwt}` } };
  };
  const manager1 = await person("manager", "fairplay_admin", [c1.id]);
  const assessor = await person("assessor", "fairplay_assessor");
  const org1 = await person("organiser-one", "fairplay_organiser_viewer", [c1.id]);
  const org2 = await person("organiser-two", "fairplay_organiser_viewer", [c2.id]);
  const recorder = await person("recorder", "match_recorder");

  const d1 = await ok<{ id: string; bootstrapToken: string }>("POST", "/fairplay/devices", admin, { label: "Sec Edge one" });
  const d2 = await ok<{ id: string; bootstrapToken: string }>("POST", "/fairplay/devices", admin, { label: "Sec Edge two" });
  const d3 = await ok<{ id: string; bootstrapToken: string }>("POST", "/fairplay/devices", admin, { label: "Sec Edge retired" });
  for (const d of [d1, d2, d3]) keep("a bootstrap token", d.bootstrapToken);
  const edge1 = randomUUID();
  const edge2 = randomUUID();

  console.log("\nPairing");
  const register = (headers: Record<string, string>, edgeId = randomUUID()) => http("POST", "/fairplay/device/register", headers, { edgeDeviceId: edgeId });
  check("pairing with no bootstrap token is refused", (await register({})).status === 401);
  check("pairing with a guessed bootstrap token is refused", (await register({ "x-fairplay-bootstrap-token": randomBytes(32).toString("hex") })).status === 401);
  check("the admin API key is not a bootstrap token", (await register({ "x-fairplay-bootstrap-token": apiKey, ...admin })).status === 401);
  await ok("POST", `/fairplay/devices/${d3.id}/retire`, admin);
  check("a retired device's bootstrap token is refused", (await register({ "x-fairplay-bootstrap-token": d3.bootstrapToken })).status === 401);
  const reg1 = await ok<{ deviceToken: string }>("POST", "/fairplay/device/register", { "x-fairplay-bootstrap-token": d1.bootstrapToken }, { edgeDeviceId: edge1 });
  const reg2 = await ok<{ deviceToken: string }>("POST", "/fairplay/device/register", { "x-fairplay-bootstrap-token": d2.bootstrapToken }, { edgeDeviceId: edge2 });
  keep("a device token", reg1.deviceToken);
  keep("a device token", reg2.deviceToken);
  check("a used bootstrap token is refused", (await register({ "x-fairplay-bootstrap-token": d1.bootstrapToken })).status === 401);
  check("a used bootstrap token is not a device token",
    (await http("GET", "/fairplay/device/bundle", { "x-fairplay-device-token": d1.bootstrapToken })).status === 401);

  const s1 = await ok<{ id: string }>("POST", "/fairplay/sessions", admin, { matchId: matchA.id, deviceId: d1.id,
    members: [{ adminUserId: assessor.user.id, permissions: ["fairplay.incident.operate", "fairplay.incident.review"] }] });
  const sC = await ok<{ id: string }>("POST", "/fairplay/sessions", admin, { matchId: matchC.id, deviceId: d2.id });
  const pin = keep("the matchday PIN", String(randomInt(100000, 1000000)));
  await ok("PUT", `/fairplay/sessions/${s1.id}/members/me/pin`, assessor.auth, { pin });
  const ev1 = await syncReleasedEvidence(reg1.deviceToken, edge1, s1.id, matchA.id, assessor.user.id);
  const evC = await syncReleasedEvidence(reg2.deviceToken, edge2, sC.id, matchC.id, assessor.user.id);
  check("two sessions in two competitions, each with released evidence in the bucket, set up through the API", true);

  console.log("\nDevice routes");
  const deviceRoutes = [
    ["GET", "/fairplay/device/bundle"],
    ["POST", "/fairplay/sync/batch"],
    ["POST", `/fairplay/device/evidence/${ev1.evidenceId}/uploads`],
    ["POST", `/fairplay/device/evidence/${ev1.evidenceId}/uploads/clip/confirm`],
  ] as const;
  const wrongCredentials: [string, Record<string, string>][] = [
    ["no token", {}],
    ["a guessed token", { "x-fairplay-device-token": randomBytes(32).toString("hex") }],
    ["the admin API key", admin],
    ["the admin API key in the device header", { "x-fairplay-device-token": apiKey }],
    ["an admin's session", manager1.auth],
    ["the device token as a bearer", { Authorization: `Bearer ${reg1.deviceToken}` }],
  ];
  for (const [what, headers] of wrongCredentials) {
    const statuses = await Promise.all(deviceRoutes.map(([m, p]) => http(m, p, headers, m === "POST" ? {} : undefined).then((a) => a.status)));
    check(`every device route refuses ${what}`, statuses.every((s) => s === 401), statuses);
  }
  const otherDevice = await http("POST", `/fairplay/device/evidence/${ev1.evidenceId}/uploads`, { "x-fairplay-device-token": reg2.deviceToken },
    { kind: "clip", bytes: 1, sha256: "a".repeat(64) });
  check("one device cannot ask for an upload of another's evidence", otherDevice.status === 404, otherDevice.status);

  console.log("\nToken rotation");
  const rePair = await ok<{ bootstrapToken: string }>("POST", `/fairplay/devices/${d1.id}/re-pair`, admin, { reason: "security check: rotate the token" });
  keep("a bootstrap token", rePair.bootstrapToken);
  check("re-pairing stops the old device token at once",
    (await http("GET", "/fairplay/device/bundle", { "x-fairplay-device-token": reg1.deviceToken })).status === 401);
  const reg1b = await ok<{ deviceToken: string }>("POST", "/fairplay/device/register", { "x-fairplay-bootstrap-token": rePair.bootstrapToken }, { edgeDeviceId: edge1 });
  keep("a device token", reg1b.deviceToken);
  const tok1 = { "x-fairplay-device-token": reg1b.deviceToken };
  check("the new token works, and differs from the old", reg1b.deviceToken !== reg1.deviceToken
    && (await http("GET", "/fairplay/device/bundle", tok1)).status === 200);
  check("the re-pair is audited with its reason",
    (await prisma.fairPlayAuditLog.count({ where: { action: "device.re_pair_started", targetId: d1.id, reason: "security check: rotate the token" } })) === 1);

  console.log("\nAdmin routes");
  const routes = adminRoutes();
  check("the controller lists fifteen admin routes", routes.length === 15, routes.map((r) => r.name));
  const sendTo = (r: { method: string; path: string }, headers: Record<string, string>) =>
    http(r.method, fill(r.path), headers, r.method === "GET" ? undefined : {});
  for (const [what, headers] of [["no sign-in", {}], ["a guessed session", { Authorization: `Bearer ${randomBytes(32).toString("hex")}` }],
    ["a device token", tok1], ["a device token as a bearer", { Authorization: `Bearer ${reg1b.deviceToken}` }]] as const) {
    const refused = await Promise.all(routes.map(async (r) => [r.name, (await sendTo(r, headers)).status] as const));
    check(`every admin route refuses ${what}`, refused.every(([, s]) => s === 401), refused.filter(([, s]) => s !== 401));
  }
  const noRole = await Promise.all(routes.map(async (r) => [r.name, (await sendTo(r, recorder.auth)).status] as const));
  check("every admin route refuses an account with no FairPlay role", noRole.every(([, s]) => s === 403), noRole.filter(([, s]) => s !== 403));
  const organiser = await Promise.all(routes.map(async (r) => {
    const status = (await sendTo(r, org1.auth)).status;
    return { name: r.name, status, allowed: r.perms.includes("fairplay.report.view") };
  }));
  check("an organiser is refused every route not open to report.view, and reaches those that are",
    organiser.every((o) => (o.status === 403) === !o.allowed), organiser.filter((o) => (o.status === 403) === o.allowed));

  console.log("\nAnother competition, and guessed ids");
  const m1 = manager1.auth;
  const pairs: [string, string, string, unknown?][] = [
    ["its session", "GET", "/fairplay/sessions/:id"],
    ["its report", "GET", "/fairplay/sessions/:id/report"],
    ["its sync state", "GET", "/fairplay/sessions/:id/sync"],
    ["its members", "PUT", "/fairplay/sessions/:id/members", { members: [] }],
  ];
  for (const [what, method, path, body] of pairs) {
    const other = await http(method, fill(path, sC.id), m1, body);
    const guess = await http(method, fill(path), m1, body);
    check(`a competition's manager gets for another competition's ${what.slice(4)} what a guessed id gets`,
      other.status === 404 && shape(other) === shape(guess), [shape(other), shape(guess)]);
  }
  const read = (who: Record<string, string>, id: string, reason = "security check") =>
    http("POST", `/fairplay/evidence/${id}/read-url`, who, { kind: "clip", reason });
  for (const [who, auth] of [["manager", m1], ["organiser", org1.auth]] as const) {
    const other = await read(auth, evC.evidenceId);
    const guess = await read(auth, randomUUID());
    check(`a competition's ${who} cannot read another competition's evidence, and is told what a guessed id gets`,
      other.status === 404 && shape(other) === shape(guess), [shape(other), shape(guess)]);
  }
  const orgOther = await http("GET", `/fairplay/sessions/${sC.id}/report`, org1.auth);
  check("an organiser cannot see another competition's report", orgOther.status === 404, orgOther.status);
  const listed = await ok<{ id: string }[]>("GET", "/fairplay/sessions", m1);
  check("a competition's manager's session list leaves out the other competition", listed.some((s) => s.id === s1.id) && !listed.some((s) => s.id === sC.id));
  const devicesSeen = await ok<{ id: string }[]>("GET", "/fairplay/devices", m1);
  check("and their device list leaves out the other competition's Edge", !devicesSeen.some((d) => d.id === d2.id));
  const foreign = await http("POST", "/fairplay/sessions", m1, { matchId: matchC.id, deviceId: d1.id });
  check("a competition's manager cannot open a session for another competition's match", foreign.status >= 400 && foreign.status < 500, foreign.status);
  const notUuid = await http("GET", "/fairplay/sessions/' OR 1=1 --", m1);
  check("an id that is not a UUID is refused before it reaches the database", notUuid.status === 400, notUuid.status);
  const own2 = await read(org2.auth, evC.evidenceId);
  const bytes = own2.status === 201 ? Buffer.from(await (await fetch(String(own2.body?.url))).arrayBuffer()) : Buffer.alloc(0);
  check("the other competition's organiser reads it, and gets the Edge's exact bytes",
    createHash("sha256").update(bytes).digest("hex") === evC.sha256, own2.status);
  const urlTtl = new URL(String(own2.body?.url ?? "http://x/")).searchParams.get("X-Amz-Expires");
  check("the read URL lasts at most five minutes", Number(urlTtl) > 0 && Number(urlTtl) <= 300, urlTtl);

  console.log("\nA role taken away mid-match");
  const a = assessor.auth;
  check("the assessor reads the session and its evidence", (await http("GET", `/fairplay/sessions/${s1.id}`, a)).status === 200
    && (await read(a, ev1.evidenceId)).status === 201);
  type Bundle = { bundle?: { bundle?: { members?: { userId: string }[] } } };
  const inBundle = async () => ((await ok<Bundle>("GET", "/fairplay/device/bundle", tok1)).bundle?.bundle?.members ?? []).some((m) => m.userId === assessor.user.id);
  check("and is in the venue's bundle", await inBundle());
  await prisma.adminUser.update({ where: { id: assessor.user.id }, data: { roleId: await roleId("match_recorder") } });
  check("with their role taken away, the same session is refused at the next request",
    (await http("GET", `/fairplay/sessions/${s1.id}`, a)).status === 403 && (await read(a, ev1.evidenceId)).status === 403);
  check("and the next bundle leaves them out", !(await inBundle()));
  await prisma.adminUser.update({ where: { id: assessor.user.id }, data: { roleId: await roleId("fairplay_assessor"), isActive: false } });
  check("a deactivated account is signed out at the next request", (await http("GET", `/fairplay/sessions/${s1.id}`, a)).status === 401);
  check("and is not in the bundle", !(await inBundle()));

  console.log("\nEvery read audited");
  const before = await prisma.fairPlayAuditLog.count({ where: { action: "evidence.read" } });
  const reads = [await read(m1, ev1.evidenceId, "check one"), await read(org1.auth, ev1.evidenceId, "check two"), await read(org2.auth, evC.evidenceId, "check three")];
  const after = await prisma.fairPlayAuditLog.findMany({ where: { action: "evidence.read" }, orderBy: { createdAt: "asc" }, skip: before });
  check("three reads, three audit entries, each with who and why", reads.every((r) => r.status === 201) && after.length === 3
    && after.map((e) => e.reason).join() === "check one,check two,check three"
    && after.map((e) => e.actorId).join() === [manager1.user.id, org1.user.id, org2.user.id].join(), after.map((e) => [e.actorId, e.reason]));
  const refusedReads = await prisma.fairPlayAuditLog.count({ where: { action: "evidence.read", targetId: evC.evidenceId, actorId: org1.user.id } });
  check("a refused read hands out nothing to audit", refusedReads === 0);
  check("each bundle handed to a device is audited", (await prisma.fairPlayAuditLog.count({ where: { action: "bundle.issued", targetId: s1.id } })) >= 1);

  console.log("\nRetiring a device");
  await ok("POST", `/fairplay/devices/${d2.id}/retire`, admin);
  const retired = await Promise.all(deviceRoutes.map(([m, p]) => http(m, p, { "x-fairplay-device-token": reg2.deviceToken }, m === "POST" ? {} : undefined).then((r) => r.status)));
  check("a retired device's token is refused on every device route", retired.every((s) => s === 401), retired);

  console.log("\nSecrets");
  await http("POST", "/admin/auth/login", {}, { email: manager1.user.email, password: keep("a wrong password", randomBytes(12).toString("hex")) });
  for (const r of routes.filter((x) => x.method === "GET" && !x.path.includes(":"))) await http("GET", r.path, m1);
  for (const p of [`/fairplay/sessions/${s1.id}`, `/fairplay/sessions/${s1.id}/report`, `/fairplay/sessions/${s1.id}/sync`, "/health"]) await http("GET", p, admin);
  const tokenHashes = secrets.filter((s) => /token/.test(s.name)).map((s) => ({ name: `the hash of ${s.name}`, value: sha256Hex(Buffer.from(s.value)) }));
  const leaks = (text: string) => [...secrets, ...tokenHashes].filter((s) => text.includes(s.value)).map((s) => s.name);
  const bundles = answers.filter((x) => x.path.startsWith("/fairplay/device/bundle"));
  const others = answers.filter((x) => !bundles.includes(x) && !(x.status < 300 && ISSUERS.test(`${x.method} ${x.path}`)));
  const found = others.flatMap((x) => leaks(x.text).map((n) => `${x.method} ${x.path}: ${n}`));
  check(`no secret, and no token's hash, in any of ${others.length} responses (the ones that issue a credential aside)`, found.length === 0, found);
  check("no PIN hash in any response but a device's bundle", !others.some((x) => x.text.includes("scrypt$")),
    others.filter((x) => x.text.includes("scrypt$")).map((x) => x.path));
  check("a bundle carries PIN hashes and never a PIN", bundles.some((x) => x.text.includes("scrypt$")) && !bundles.some((x) => x.text.includes(pin)));
  check("no secret in the API's log", leaks(apiLog).length === 0, leaks(apiLog));

  console.log("\nThe web bundles");
  const root = resolve(__dirname, "../../..");
  // A key, a connection string, a server-only setting given a value, or a header only an Edge sends. (A message
  // that names a setting, as the super-admin sign-in does for ADMIN_API_KEY, is not a value.)
  const browserOnly = /BEGIN [A-Z ]*PRIVATE KEY|\b(FAIRPLAY_[A-Z_]+|ADMIN_API_KEY|DATABASE_URL|[A-Z_]*SECRET[A-Z_]*)\s*[:=]\s*["'`][^"'`\s]{8,}|x-fairplay-device-token|x-fairplay-bootstrap-token|AKIA[0-9A-Z]{16}|postgres(ql)?:\/\//;
  for (const [pkg, dir] of [["@dtp/web", "apps/web"], ["@dtp/fairplay-console", "apps/fairplay-console"]] as const) {
    const built = spawnSync("pnpm", ["--filter", pkg, "build"], { cwd: root, encoding: "utf8", shell: process.platform === "win32" });
    if (built.status !== 0) {
      check(`${pkg} builds`, false, (built.stdout + built.stderr).slice(-1500));
      continue;
    }
    const files = filesUnder(join(root, dir, "dist")).filter((f) => /\.(js|html|css|json|map|txt)$/.test(f));
    const found = files.flatMap((f) => {
      const text = readFileSync(f, "utf8");
      const m = text.match(browserOnly);
      return [...(m ? [`${f.slice(root.length)}: ${m[0]}`] : []), ...leaks(text).map((n) => `${f.slice(root.length)}: ${n}`)];
    });
    check(`${pkg}'s bundle (${files.length} files) holds no secret, no server-only name and no device header`, found.length === 0, found);
  }

  console.log(`\n${passed}/${passed + failures.length} passed${failures.length ? ` — FAILED: ${failures.join("; ")}` : ""}`);
  process.exitCode = failures.length ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    console.error(`\nAPI log, last part:\n${apiLog.slice(-3000)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    api?.kill();
    spawnSync("docker", ["stop", S3_NAME], { encoding: "utf8" });
    await prisma.$disconnect();
  });
