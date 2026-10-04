/**
 * What every Vision gate does before it writes and when it is stopped.
 *
 * A gate creates partners, footage, people and, for some, goals in a match, and
 * deletes them when it ends. Three things were left to the person running it
 * (docs/vision/50, appendix E):
 *
 *   - **Which database.** "Never production" was a comment. A gate run with a
 *     live `DATABASE_URL` in the shell would have written to live. Now a gate
 *     refuses unless the database and the API it talks to are on this machine,
 *     or the host is named on purpose.
 *   - **Ctrl-C.** Cleanup was in a `finally`, which an interrupt skips. The
 *     gate's rows, an active admin account among them, stayed.
 *   - **Whose match.** The event gate picked a real match with no goals and
 *     wrote six into it, then put the score and the scorer's totals back by
 *     hand. A gate now makes its own match and deletes it.
 */
import { existsSync, readFileSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";

/**
 * Hosts that are this machine.
 *
 * `postgres` and `db` were here as "a container beside it". The live API container
 * reaches the live database as `postgres` (infra/docker-compose.staging.yml), so a gate
 * run inside it passed this check (docs/vision/70). A compose service name says nothing
 * about whose database it is; a developer who runs gates inside a compose stack names
 * the host in the override.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0", "host.docker.internal"]);

/** Names the override must be set to: the host itself, so it cannot be a habit. */
export const ALLOW_DB_HOST = "VISION_GATE_ALLOW_DB_HOST";
export const ALLOW_API_HOST = "VISION_GATE_ALLOW_API_HOST";

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Why a gate may not run against this URL, or null when it may. `allowed` is
 * the override: it has to equal the host, so `=1` or `=true` allows nothing.
 */
export function hostProblem(what: "database" | "API", url: string | undefined, allowed: string | undefined, overrideName: string): string | null {
  if (!url) return `No ${what} URL is set, so a gate cannot tell where it would write.`;
  const host = hostOf(url);
  if (!host) return `The ${what} URL cannot be read, so a gate cannot tell where it would write.`;
  if (LOCAL_HOSTS.has(host)) return null;
  if (allowed && allowed.trim().toLowerCase() === host) return null;
  return `The ${what} is on ${host}, which is not this machine. A gate creates and deletes rows; it does not run against a shared or live ${what}. To run it there on purpose, set ${overrideName}=${host}.`;
}

/** `KEY=value` lines of an env file, for keys the process does not already have. */
export function readEnvFile(text: string, into: Record<string, string | undefined>): void {
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    // A comment does not match: `#` is not the start of a name.
    if (!m) continue;
    if (into[m[1]!] === undefined) into[m[1]!] = m[2]!.replace(/^(["'])(.*)\1$/, "$2");
  }
}

/**
 * Refuses to go on unless the database, and the API when the gate uses one, are
 * local. Called first thing in every gate's `main`.
 */
export function assertDevDatabase(opts: { api?: string } = {}): void {
  // Prisma reads `.env` for itself; this has to read it too, to see what Prisma will use.
  if (process.env.DATABASE_URL === undefined && existsSync(".env")) readEnvFile(readFileSync(".env", "utf8"), process.env);
  const problems = [
    hostProblem("database", process.env.DATABASE_URL, process.env[ALLOW_DB_HOST], ALLOW_DB_HOST),
    opts.api === undefined ? null : hostProblem("API", opts.api, process.env[ALLOW_API_HOST], ALLOW_API_HOST),
  ].filter((p): p is string => p !== null);
  if (!problems.length) return;
  for (const p of problems) console.error(`\nGate refused: ${p}`);
  process.exit(2);
}

/**
 * Runs the gate's cleanup when it is interrupted, then exits. `cleanup` is the
 * same function the gate's `finally` calls; it reads the fixture as it stands
 * at that moment. A second Ctrl-C while it runs exits at once.
 */
export function onInterrupt(cleanup: () => Promise<unknown>): void {
  let stopping = false;
  /* One listener for every signal: the first starts the cleanup, any after it exits. Two
     listeners, one of them "exit if already stopping", both run on the first signal, and
     the second ended the process before the cleanup had done anything. */
  const stop = (signal?: NodeJS.Signals) => {
    if (stopping) process.exit(130);
    stopping = true;
    console.error(`\n${signal ?? "Interrupted"}: cleaning up what this run created…`);
    cleanup()
      .then(() => console.error("Cleaned up."))
      .catch((e) => console.error("Cleanup failed; run `pnpm db:purge:gate-litter`:", e))
      .finally(() => process.exit(130));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

// ── A match of the gate's own ───────────────────────────────────────────────

export type GateSlot = { id: string; teamId: string; playerId: string; playerName: string; jerseyNumber: number; isStarter: boolean };

export type GateMatch = {
  id: string;
  competitionId: string;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  /** Four home players (three starters and a substitute) and three away (two and one), each a real `Player` row. */
  squadPlayers: GateSlot[];
  /** A squad slot in a second match of the same competition: "a slot from another match". */
  otherMatchSlotId: string;
  /** Everything to delete: the players are not reached by deleting the competition. */
  playerIds: string[];
  matchIds: string[];
};

/** The names a gate match's rows carry, so the litter purge can find them by run id. */
export const gateMatchNames = {
  competitionSlug: (run: string) => `gate-${run}`,
  playerSlug: (run: string, side: "h" | "a" | "o", n: number) => `gate-${run}-${side}${n}`,
};

/**
 * A competition, two teams, a match of 45-minute halves with no events, and
 * squads on both sides whose players are `Player` rows. Nothing in it existed
 * before, and `removeGateMatch` takes all of it out.
 */
export async function createGateMatch(prisma: PrismaClient, run: string): Promise<GateMatch> {
  const competition = await prisma.sbCompetition.create({ data: { slug: gateMatchNames.competitionSlug(run), name: `Vision gate ${run}`, season: "gate" } });
  const team = (side: string) => prisma.sbTeam.create({ data: { competitionId: competition.id, slug: `gate-${run}-${side}`, name: `Gate ${side} ${run}` } });
  const [home, away] = [await team("home"), await team("away")];
  const match = await prisma.sbMatch.create({ data: { competitionId: competition.id, homeTeamId: home.id, awayTeamId: away.id, slug: `gate-${run}` } });
  const other = await prisma.sbMatch.create({ data: { competitionId: competition.id, homeTeamId: away.id, awayTeamId: home.id, slug: `gate-${run}-other` } });

  const playerIds: string[] = [];
  const slot = async (matchId: string, teamId: string, side: "h" | "a" | "o", n: number, isStarter: boolean): Promise<GateSlot> => {
    const name = `Gate ${side.toUpperCase()}${n} ${run}`;
    const player = await prisma.player.create({
      data: { firstName: "Gate", lastName: `${side.toUpperCase()}${n} ${run}`, displayName: name, positionPrimary: "MF", slug: gateMatchNames.playerSlug(run, side, n) },
    });
    playerIds.push(player.id);
    const row = await prisma.sbMatchSquadPlayer.create({ data: { matchId, teamId, playerId: player.id, playerName: name, jerseyNumber: n, isStarter, sortOrder: n } });
    return { id: row.id, teamId, playerId: player.id, playerName: name, jerseyNumber: n, isStarter };
  };
  const squadPlayers: GateSlot[] = [];
  for (const n of [1, 2, 3]) squadPlayers.push(await slot(match.id, home.id, "h", n, true));
  squadPlayers.push(await slot(match.id, home.id, "h", 12, false));
  for (const n of [1, 2]) squadPlayers.push(await slot(match.id, away.id, "a", n, true));
  squadPlayers.push(await slot(match.id, away.id, "a", 12, false));
  const otherSlot = await slot(other.id, away.id, "o", 1, true);

  return { id: match.id, competitionId: competition.id, homeTeamId: home.id, awayTeamId: away.id, homeScore: 0, awayScore: 0, squadPlayers, otherMatchSlotId: otherSlot.id, playerIds, matchIds: [match.id, other.id] };
}

/** Takes a gate match out: its matches (events, squads and sheets go with them), its competition and teams, its players. */
export async function removeGateMatch(prisma: PrismaClient, gm: Pick<GateMatch, "competitionId" | "playerIds" | "matchIds"> | null | undefined): Promise<void> {
  if (!gm) return;
  await prisma.sbMatch.deleteMany({ where: { id: { in: gm.matchIds } } });
  await prisma.sbCompetition.deleteMany({ where: { id: gm.competitionId } });
  await prisma.player.deleteMany({ where: { id: { in: gm.playerIds } } });
}

/**
 * Workers a gate provisioned, and the audit rows that say it did (docs/vision/68).
 * A provision and a retire each write one, so a gate that removed only the worker
 * would leave a trail pointing at nothing.
 */
export async function removeGateWorkers(prisma: PrismaClient, workerIds: readonly string[]): Promise<void> {
  if (!workerIds.length) return;
  await prisma.visionAuditLog.deleteMany({ where: { targetKind: "vision_worker", targetId: { in: [...workerIds] } } });
  await prisma.visionWorker.deleteMany({ where: { id: { in: [...workerIds] } } });
}

// ── The audit trail a gate leaves ───────────────────────────────────────────

/**
 * The table each audit target kind points into (docs/vision/70).
 *
 * A gate makes things through the API, the API writes an audit row for each, and
 * the gate then deletes the things. The rows stayed: each gate removed them by a
 * list of ids it had kept, and every list missed some kind. This map is what lets
 * the question be asked the other way round, of any row: does its target exist?
 *
 * `gate-harness.spec.ts` reads every `targetKind` the Vision module writes and
 * fails if one is missing here.
 */
export const AUDIT_TARGET_MODELS: Readonly<Record<string, string>> = {
  vision_annotation_task: "visionAnnotationTask",
  vision_annotation_version: "visionAnnotationVersion",
  vision_benchmark_run: "visionBenchmarkRun",
  vision_camera_segment: "visionCameraSegment",
  vision_dataset_version: "visionDatasetVersion",
  vision_event_candidate: "visionEventCandidate",
  vision_identity_assignment: "visionIdentityAssignment",
  vision_job: "visionJob",
  vision_label_schema_version: "visionLabelSchemaVersion",
  vision_model: "visionModel",
  vision_model_version: "visionModelVersion",
  vision_partner_upload_grant: "visionPartnerUploadGrant",
  vision_promotion_request: "visionPromotionRequest",
  vision_rights_evidence: "visionRightsEvidence",
  vision_rights_scope: "visionRightsScope",
  vision_signatory: "visionPartnerAuthorizedSignatory",
  vision_source_partner: "visionSourcePartner",
  vision_source_video_record: "visionSourceVideoRecord",
  vision_track: "visionTrack",
  vision_upload_session: "visionUploadSession",
  vision_video_asset: "visionVideoAsset",
  vision_worker: "visionWorker",
};

export type AuditRowRef = { id: string; action: string; targetKind: string; targetId: string | null; actorId: string | null };

type IdFinder = { findMany(args: { where: { id: { in: string[] } }; select: { id: true } }): Promise<{ id: string }[]> };

/** Which of `ids` are rows of `model`. Asked a thousand at a time: a trail is long. */
async function existing(prisma: PrismaClient, model: string, ids: string[]): Promise<Set<string>> {
  const table = (prisma as unknown as Record<string, IdFinder>)[model];
  const found = new Set<string>();
  for (let i = 0; i < ids.length; i += 1000) {
    for (const row of await table.findMany({ where: { id: { in: ids.slice(i, i + 1000) } }, select: { id: true } })) found.add(row.id);
  }
  return found;
}

/**
 * Of `rows`, the ones that are a gate's leavings: the target is gone, and no
 * person who still exists stands behind the row.
 *
 * The second half matters. On a developer's database a person removes things too
 * (a camera segment, an abandoned task), and the row that says they did is the
 * trail doing its job. A gate's rows are the operator key's, a worker's, or a
 * scratch sign-in's that the gate has since removed. A kind this map does not
 * know is left alone: not knowing where a target lives is no reason to say it
 * is gone.
 */
export async function orphanedAuditRows(prisma: PrismaClient, rows: readonly AuditRowRef[]): Promise<AuditRowRef[]> {
  const byKind = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.targetId || !AUDIT_TARGET_MODELS[row.targetKind]) continue;
    if (!byKind.has(row.targetKind)) byKind.set(row.targetKind, new Set());
    byKind.get(row.targetKind)!.add(row.targetId);
  }
  const alive = new Map<string, Set<string>>();
  for (const [kind, ids] of byKind) alive.set(kind, await existing(prisma, AUDIT_TARGET_MODELS[kind], [...ids]));
  const people = await existing(prisma, "adminUser", [...new Set(rows.flatMap((r) => (r.actorId ? [r.actorId] : [])))]);
  return rows.filter((row) => {
    const targets = alive.get(row.targetKind);
    if (!row.targetId || !targets || targets.has(row.targetId)) return false;
    return !(row.actorId && people.has(row.actorId));
  });
}

/**
 * Why the purge may not clear orphaned audit rows from this database, or null
 * when it may. Only a database on this machine: on a live one a row is meant to
 * outlive its target, and "the target is gone" is history, not litter. There is
 * no override. The rest of the purge goes by names only a gate uses and is safe
 * anywhere; this part goes by absence, which is not.
 */
export function auditPurgeProblem(databaseUrl: string | undefined): string | null {
  const host = hostOf(databaseUrl);
  if (host && LOCAL_HOSTS.has(host)) return null;
  return `the database is ${host ? `on ${host}` : "not named"}, not on this machine, and there an audit row is meant to outlive what it is about`;
}

/** When this gate's process started, less a moment for two clocks to disagree by. */
export const GATE_STARTED_AT = new Date(Date.now() - 2000);

/**
 * Removes what this run left on the audit trail: every row written since the
 * gate started whose target the gate has since removed. Call it after the
 * gate's own cleanup. Returns how many rows went.
 */
export async function removeGateAuditTrail(prisma: PrismaClient, since: Date = GATE_STARTED_AT): Promise<number> {
  const rows = await prisma.visionAuditLog.findMany({ where: { createdAt: { gte: since } }, select: { id: true, action: true, targetKind: true, targetId: true, actorId: true } });
  const gone = await orphanedAuditRows(prisma, rows);
  if (!gone.length) return 0;
  return (await prisma.visionAuditLog.deleteMany({ where: { id: { in: gone.map((r) => r.id) } } })).count;
}

/**
 * How a gate ends, on every path: the trail is cleared of this run, then the
 * database is let go. It stands where `prisma.$disconnect()` stood, so a gate
 * cannot clean up its fixtures and forget its trail.
 */
export async function closeGate(prisma: PrismaClient): Promise<void> {
  await removeGateAuditTrail(prisma).catch((e) => console.error("Audit cleanup failed; run `pnpm db:purge:gate-litter`:", e));
  await prisma.$disconnect();
}
