import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const tableRows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT to_regclass('public.sb_team_squad') IS NOT NULL AS exists
  `;

  if (!tableRows[0]?.exists) {
    console.log("sb_team_squad duplicate player links: table not present yet");
    return;
  }

  const rows = await prisma.$queryRaw<Array<{ duplicate_count: bigint }>>`
    SELECT COALESCE(SUM(counted.row_count - 1), 0)::bigint AS duplicate_count
    FROM (
      SELECT player_id, COUNT(*) AS row_count
      FROM sb_team_squad
      WHERE player_id IS NOT NULL
      GROUP BY player_id
      HAVING COUNT(*) > 1
    ) counted
  `;

  const duplicateCount = Number(rows[0]?.duplicate_count ?? 0);
  if (duplicateCount === 0) {
    console.log("sb_team_squad duplicate player links: none");
    return;
  }

  const matchSquadRows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT to_regclass('public.sb_match_squad_players') IS NOT NULL AS exists
  `;

  if (matchSquadRows[0]?.exists) {
    await prisma.$executeRaw`
      WITH ranked AS (
        SELECT
          squad.id,
          ROW_NUMBER() OVER (
            PARTITION BY squad.player_id
            ORDER BY
              (
                SELECT COUNT(*)
                FROM sb_match_squad_players match_squad
                WHERE match_squad.squad_id = squad.id
              ) DESC,
              squad.id ASC
          ) AS keep_rank
        FROM sb_team_squad squad
        WHERE squad.player_id IS NOT NULL
      )
      UPDATE sb_team_squad
      SET player_id = NULL
      WHERE id IN (
        SELECT id
        FROM ranked
        WHERE keep_rank > 1
      )
    `;
  } else {
    await prisma.$executeRaw`
      WITH ranked AS (
        SELECT
          squad.id,
          ROW_NUMBER() OVER (
            PARTITION BY squad.player_id
            ORDER BY squad.id ASC
          ) AS keep_rank
        FROM sb_team_squad squad
        WHERE squad.player_id IS NOT NULL
      )
      UPDATE sb_team_squad
      SET player_id = NULL
      WHERE id IN (
        SELECT id
        FROM ranked
        WHERE keep_rank > 1
      )
    `;
  }

  console.log(
    `sb_team_squad duplicate player links repaired: ${duplicateCount} duplicate link(s) cleared`
  );
}

main()
  .catch((error) => {
    console.error("Failed to repair sb_team_squad duplicate player links:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
