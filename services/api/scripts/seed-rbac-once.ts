import { PrismaClient } from "@prisma/client";
import { seedRbac } from "../src/seed/seed-rbac";

const prisma = new PrismaClient();

seedRbac(prisma)
  .then((r) => console.log("RBAC seeded:", r))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
