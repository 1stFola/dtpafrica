/**
 * Player records that are probably one person, with the evidence for each.
 *
 *   pnpm --filter @dtp/api db:report:duplicate-players
 *
 * **Read-only. It changes nothing, and there is no `--apply`.** That is a decision,
 * not an omission. A Player is referenced by fourteen other tables — squads, match
 * squads, events as scorer, events as assister, competition stats, aggregated
 * metrics, tactical scores, philosophy fits, valuations, academy change requests —
 * and merging two means deciding, per table, which row survives and what happens to
 * the loser's history. Getting that wrong credits one child's goals to another.
 * So this prints the list and stops; a merge should be a separate, deliberate tool
 * built after somebody has read the list and said which pairs are real.
 *
 * Why this exists: `db:sync:event-player-links` reported ninety-five goal labels it
 * refused to link because more than one player answered to the name. Every one was
 * a name and its reverse on the same team — `Clems Henry` and `Henry Clems`. A
 * Nigerian name gets written surname-first or given-name-first depending on who is
 * filling the form, and both spellings became separate Player rows. The effect on
 * the product is that those players have two profiles each, their goals are split
 * between them, and neither profile shows their real record.
 *
 * `db:repair:squad-duplicates` does not cover this. It removes squad rows pointing
 * at the *same* player id; these are two different ids.
 */
import { PrismaClient } from "@prisma/client";
import { loadApiEnv } from "../src/shared/load-dotenv";
import {
  groupProbableDuplicates,
  reorderKey,
  type DuplicateGroup,
} from "../src/players/duplicate-detection";

loadApiEnv();

const prisma = new PrismaClient();

type Row = {
  id: string;
  displayName: string;
  slug: string;
  createdAt: Date;
  isPublic: boolean;
  playerPhotoUrl: string | null;
  academyId: string | null;
};

/** What a person can point at, and how much of it would need reconciling. */
type Evidence = {
  goals: number;
  assists: number;
  teams: string[];
  hasProfile: boolean;
};

function describe(row: Row, ev: Evidence, width: number) {
  const marks = [
    ev.goals ? `${ev.goals} goal${ev.goals === 1 ? "" : "s"}` : null,
    ev.assists ? `${ev.assists} assist${ev.assists === 1 ? "" : "s"}` : null,
    ev.hasProfile ? "has a profile" : null,
    row.isPublic ? "public" : null,
  ].filter(Boolean);
  const created = row.createdAt.toISOString().slice(0, 10);
  return (
    `    ${row.displayName.padEnd(width)}  ${(marks.join(", ") || "nothing attached").padEnd(34)}` +
    `  ${created}  /${row.slug}`
  );
}

async function main() {
  console.log("Players that are probably the same person\n");
  console.log("  Read-only. Nothing here changes any data.\n");

  const players = await prisma.player.findMany({
    select: {
      id: true,
      displayName: true,
      slug: true,
      createdAt: true,
      isPublic: true,
      playerPhotoUrl: true,
      academyId: true,
    },
  });
  console.log(`  ${players.length} player records scanned`);

  const groups = groupProbableDuplicates(players as Row[]);
  if (!groups.length) {
    console.log("\n  No two records share a name. Nothing to review.");
    return;
  }

  const ids = groups.flatMap((g) => g.members.map((m) => m.id));
  const [goals, assists, squads] = await Promise.all([
    prisma.sbMatchEvent.groupBy({
      by: ["playerId"],
      where: { playerId: { in: ids } },
      _count: { _all: true },
    }),
    prisma.sbMatchEvent.groupBy({
      by: ["assistPlayerId"],
      where: { assistPlayerId: { in: ids } },
      _count: { _all: true },
    }),
    prisma.sbTeamSquad.findMany({
      where: { playerId: { in: ids } },
      select: { playerId: true, team: { select: { name: true } } },
    }),
  ]);

  const goalBy = new Map(goals.map((g) => [g.playerId, g._count._all]));
  const assistBy = new Map(assists.map((a) => [a.assistPlayerId, a._count._all]));
  const teamsBy = new Map<string, string[]>();
  for (const s of squads) {
    if (!s.playerId) continue;
    teamsBy.set(s.playerId, [...(teamsBy.get(s.playerId) ?? []), s.team.name]);
  }

  const evidenceFor = (row: Row): Evidence => ({
    goals: goalBy.get(row.id) ?? 0,
    assists: assistBy.get(row.id) ?? 0,
    teams: [...new Set(teamsBy.get(row.id) ?? [])],
    hasProfile: Boolean(row.playerPhotoUrl || row.academyId),
  });

  /* Goals currently credited to nobody because the name was ambiguous. This is the
     number that says what the duplication is costing right now: the sync refuses to
     guess, so these sit on the fixture and reach no profile at all. */
  const labelled = await prisma.sbMatchEvent.findMany({
    where: { playerId: null, playerLabel: { not: null } },
    select: { playerLabel: true },
  });
  const strandedBy = new Map<string, number>();
  for (const e of labelled) {
    const key = reorderKey(e.playerLabel ?? "");
    if (key) strandedBy.set(key, (strandedBy.get(key) ?? 0) + 1);
  }

  /* Two records in the same squad is the strongest evidence available here: one
     team does not field two players of the same name written two ways. */
  const shareATeam = (g: DuplicateGroup<Row>) => {
    const seen = new Set<string>();
    for (const m of g.members) {
      for (const t of evidenceFor(m).teams) {
        if (seen.has(t)) return t;
        seen.add(t);
      }
    }
    return null;
  };

  const ranked = groups
    .map((g) => ({ group: g, shared: shareATeam(g), stranded: strandedBy.get(g.key) ?? 0 }))
    .sort(
      (a, b) =>
        Number(Boolean(b.shared)) - Number(Boolean(a.shared)) ||
        b.stranded - a.stranded ||
        a.group.key.localeCompare(b.group.key)
    );

  const confident = ranked.filter((r) => r.shared);
  const rest = ranked.filter((r) => !r.shared);
  const strandedTotal = ranked.reduce((sum, r) => sum + r.stranded, 0);

  console.log(
    `  ${groups.length} name(s) held by more than one record` +
      `\n  ${confident.length} of them have two records in the same squad` +
      `\n  ${strandedTotal} goal or assist label(s) currently reach nobody because of the ambiguity\n`
  );

  const section = (title: string, rows: typeof ranked, note: string) => {
    if (!rows.length) return;
    console.log(`${title}\n${"-".repeat(title.length)}`);
    console.log(`  ${note}\n`);
    for (const { group, shared, stranded } of rows) {
      const width = Math.max(...group.members.map((m) => m.displayName.length));
      console.log(`  ${shared ?? group.members[0]!.displayName}`);
      for (const member of group.members) {
        console.log(describe(member, evidenceFor(member), width));
      }
      const ev = group.members.map(evidenceFor);
      const split = ev.reduce((s, e) => s + e.goals + e.assists, 0);
      const parts = [
        split ? `${split} event(s) split across ${group.members.length} records` : null,
        stranded ? `${stranded} more reaching nobody` : null,
      ].filter(Boolean);
      if (parts.length) console.log(`      → ${parts.join(", ")}`);
      console.log("");
    }
  };

  /* Where they came from. The duplicates are not scattered randomly through time:
     they cluster on a handful of days, which says this is a small number of imports
     that each re-created people already in the directory rather than a slow drift of
     hand-entered typos. Fixing the import is what stops it happening again. */
  const byDay = new Map<string, number>();
  for (const { group } of ranked) {
    for (const m of group.members) {
      const day = m.createdAt.toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
  }
  if (byDay.size > 1) {
    console.log("Where these records were created");
    console.log("--------------------------------");
    console.log("  Duplicates clustering on a few days means a few imports, not slow drift.");
    console.log("");
    for (const [day, n] of [...byDay].sort()) {
      console.log(`    ${day}   ${String(n).padStart(3)} of the records above`);
    }
    console.log("");
  }

  section(
    `Same squad (${confident.length})`,
    confident,
    "Both records appear in one team. A squad does not field two players of the same name."
  );
  section(
    `Different squads, or none (${rest.length})`,
    rest,
    "Weaker: these could be two people who happen to share a name. Check before merging."
  );

  console.log("-".repeat(64));
  console.log(
    "Nothing was changed. Merging means deciding, for each of fourteen relations,\n" +
      "which record survives and what becomes of the other's history — so it is a\n" +
      "separate job, done once somebody has read this list and said which are real."
  );
  /* Named explicitly because it is the cheapest fix for the commonest case: the
     sync stops refusing as soon as one of the two records leaves the squad. */
  console.log(
    "\nFor a pair in the same squad, removing the wrong record from that squad is\n" +
      "often enough on its own: db:sync:event-player-links then has one candidate\n" +
      "instead of two, and links the goals that currently reach nobody."
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
