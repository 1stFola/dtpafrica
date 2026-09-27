/**
 * Put the venues and the scorer names right on the JOEMARK Oto-Awori fixtures.
 *
 *   pnpm --filter @dtp/api db:repair:joemark-venues          # report only
 *   pnpm --filter @dtp/api db:repair:joemark-venues --apply  # write
 *
 * The first version of that seed shipped every fixture with a null venue. The
 * parser built from the printed fixture sheet never captured the venue column, and
 * the generator read a key that did not exist, so an empty string reached the
 * database as NULL on all 101 rows. Scorelines, goals, minutes and kickoff times
 * were verified against the league's own export and are correct; only the venue
 * was lost.
 *
 * Re-seeding does not fix it. A match that has kicked off or has events recorded is
 * deliberately preserved by the seed, which is right — it stops a re-run trampling
 * whatever an admin recorded — but it means the 66 played fixtures keep their null
 * venue however many times the seed runs. Verified: a re-seed against the broken
 * state repairs 35 of 101 and leaves the other 66 untouched.
 *
 * Hence this, in the shape of the repair script that already exists for squad
 * duplicates: narrow, named for exactly what it does, and safe to run twice.
 *
 * It writes two things and nothing else: a fixture's venue, and a goal's scorer
 * name. Scores, minutes, kickoff times, teams and squads are matched on but never
 * changed. A venue that is already set is left alone, so an admin's correction is
 * never overwritten.
 */
import { PrismaClient } from "@prisma/client";
import { loadApiEnv } from "../src/shared/load-dotenv";
import {
  JOEMARK_MATCH_GOALS,
  JOEMARK_MATCH_VENUES,
} from "../prisma/seed-joemark-oto-awori-super-league-2026";

loadApiEnv();

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(`JOEMARK venue repair — ${APPLY ? "APPLYING" : "dry run, pass --apply to write"}\n`);

  const comp = await prisma.sbCompetition.findUnique({
    where: { slug: "joemark-oto-awori-super-league-2026" },
    select: { id: true },
  });
  if (!comp) {
    console.log("The competition is not seeded here. Nothing to repair.");
    return;
  }

  const matches = await prisma.sbMatch.findMany({
    where: { competitionId: comp.id },
    select: {
      id: true, venue: true, homeTeamId: true, awayTeamId: true,
      homeTeam: { select: { name: true } }, awayTeam: { select: { name: true } },
    },
  });

  let missing = 0;
  let filled = 0;
  let unknown = 0;
  let alreadySet = 0;

  for (const match of matches) {
    const venue = JOEMARK_MATCH_VENUES[match.id];
    if (match.venue) {
      alreadySet += 1;
      continue;
    }
    missing += 1;
    if (!venue) {
      // A fixture the seed does not know about — added by hand, most likely. Left
      // alone and reported rather than guessed at.
      unknown += 1;
      console.log(`  ? no venue on file for ${match.homeTeam.name} v ${match.awayTeam.name}`);
      continue;
    }
    if (APPLY) {
      await prisma.sbMatch.update({ where: { id: match.id }, data: { venue } });
    }
    filled += 1;
  }

  console.log(`\n  fixtures            ${matches.length}`);
  console.log(`  venue already set   ${alreadySet}`);
  console.log(`  venue missing       ${missing}`);
  console.log(`  ${APPLY ? "repaired" : "would repair"}      ${filled}`);
  if (unknown) console.log(`  not in the seed     ${unknown}  (left untouched)`);

  /* Scorer names, for the same reason the venues need repairing: a played fixture
     is preserved on re-seed, so the labels it was first given stay put. Three were
     recorded by one name only and are completed from the club's own team list, and
     the rest carried the fixture sheet's original casing.

     Only the label text is rewritten. The minute, the team and the event itself are
     matched on, never changed, so an event an admin edited keeps its timing. */
  let labelsFixed = 0;
  let labelsUnmatched = 0;
  for (const match of matches) {
    const wanted = JOEMARK_MATCH_GOALS[match.id];
    if (!wanted) continue;
    const events = await prisma.sbMatchEvent.findMany({
      where: { matchId: match.id, type: { in: ["goal", "own_goal"] } },
      select: { id: true, minute: true, playerLabel: true, teamId: true },
    });
    /* Claim each event once. Two goals can share a minute and a side — JP Young
       Stars scored twice on 45' against Alaska — and without this the same event
       would be matched by both, renaming one goal twice and leaving the other. */
    const claimed = new Set<string>();
    // Exact matches first, so a goal whose label is already right claims its own
    // event before a differing one can take it.
    for (const pass of ["exact", "differing"] as const) {
      for (const goal of wanted) {
        const teamId = goal.side === "home" ? match.homeTeamId : match.awayTeamId;
        const hit = events.find(
          (e) =>
            !claimed.has(e.id) &&
            e.minute === goal.minute &&
            e.teamId === teamId &&
            (pass === "exact" ? e.playerLabel === goal.scorer : true)
        );
        if (!hit) continue;
        claimed.add(hit.id);
        if (hit.playerLabel === goal.scorer) continue;
        if (APPLY) {
          await prisma.sbMatchEvent.update({
            where: { id: hit.id },
            data: { playerLabel: goal.scorer },
          });
        }
        labelsFixed += 1;
      }
    }
    labelsUnmatched += wanted.length - claimed.size;
  }
  console.log(`  scorer names ${APPLY ? "corrected" : "to correct"}  ${labelsFixed}`);
  if (labelsUnmatched) console.log(`  events not matched  ${labelsUnmatched}`);

  if (APPLY) {
    const remaining = await prisma.sbMatch.count({
      where: { competitionId: comp.id, venue: null },
    });
    console.log(`\n  fixtures still without a venue: ${remaining}`);
    if (remaining > unknown) {
      console.log("  WARNING: more rows are still null than this script skipped. Investigate.");
      process.exitCode = 1;
    }
  }
}

main()
  .catch((error) => {
    console.error("Repair failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
