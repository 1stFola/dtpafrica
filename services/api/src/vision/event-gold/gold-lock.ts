import type { Prisma } from "@prisma/client";

/** Share the reservation lock with dataset freeze: neither side can pass an obsolete leakage check. */
export async function lockGoldReservations(tx: Pick<Prisma.TransactionClient, "$executeRaw">) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(70660001)`;
}
