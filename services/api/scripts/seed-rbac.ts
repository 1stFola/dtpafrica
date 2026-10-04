/**
 * Seed the permission and role catalogue, and nothing else.
 *
 *   pnpm --filter @dtp/api seed:rbac
 *
 * `pnpm seed` runs the whole database seed -- demo competitions, players,
 * academies -- which is not something to run against a live database to pick up
 * a new role. This runs the one idempotent step it begins with: every permission
 * and default role in `permissions.catalog.ts` is upserted, existing users and
 * their role assignments are untouched, and a role that already exists keeps
 * its name and its grants exactly as an admin left them. Only `super_admin` is
 * topped up with a permission the catalogue added since; any other existing
 * role is given a new permission by hand, in Settings, Roles.
 *
 * On the live box, inside the API container:
 *
 *   sudo docker exec dtp-staging-api-1 pnpm --filter @dtp/api seed:rbac
 */
import { PrismaClient } from "@prisma/client";
import { loadApiEnv } from "../src/shared/load-dotenv";
import { seedRbac } from "../src/seed/seed-rbac";

loadApiEnv();
const prisma = new PrismaClient();

async function main() {
  const result = await seedRbac(prisma);
  console.log(JSON.stringify(result));
  const roles = await prisma.adminRole.findMany({ select: { slug: true, name: true, _count: { select: { users: true } } }, orderBy: { slug: "asc" } });
  for (const r of roles) console.log(`  ${r.slug.padEnd(28)} ${r.name.padEnd(28)} ${r._count.users} user(s)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
