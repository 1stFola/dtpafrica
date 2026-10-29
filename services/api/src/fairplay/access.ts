import { hasPermission, scopedCompetitions, type AdminAuthContext } from "../admin/auth/admin-auth.types";
import { refusal } from "../vision/shared/refusals";

/**
 * Who may see what of FairPlay here. Two kinds of reader:
 *
 *   staff      a FairPlay permission other than `report.view`: sessions, incidents,
 *              findings and stored evidence, within the competitions their account is
 *              scoped to (none means all, as everywhere else in admin);
 *   organiser  `fairplay.report.view` alone (decisions.md D4): the report and released
 *              evidence of the competitions named on their account. An organiser account
 *              with no competitions is refused. Elsewhere in admin, no competitions means
 *              every competition, which is right for internal staff and wrong for someone
 *              from outside DTP.
 *
 * Authorization is decided here and in the services, on every request. It never rests on
 * what a page chose to show (prompt 5, item 7).
 */

export const STAFF_PERMISSIONS = [
  "fairplay.session.manage",
  "fairplay.edge.admin",
  "fairplay.incident.operate",
  "fairplay.incident.review",
  "fairplay.evidence.view_original",
  "fairplay.evidence.export",
] as const;

/** Staff who may read stored evidence here. `incident.operate` flags incidents; it does not judge them. */
export const EVIDENCE_READERS = ["fairplay.incident.review", "fairplay.evidence.export", "fairplay.session.manage"] as const;

export const ANY_FAIRPLAY = [...STAFF_PERMISSIONS, "fairplay.report.view"];

export type Reader = { kind: "staff" | "organiser"; competitions: string[] | null };

export function readerOf(ctx: AdminAuthContext): Reader {
  if (STAFF_PERMISSIONS.some((p) => hasPermission(ctx, p))) {
    return { kind: "staff", competitions: scopedCompetitions(ctx) };
  }
  if (hasPermission(ctx, "fairplay.report.view")) {
    const competitions = scopedCompetitions(ctx);
    if (!competitions) {
      throw refusal(403, "OrganiserUnscoped", "This account is not limited to any competition.",
        "Ask a DTP admin to assign the competitions this account may read.");
    }
    return { kind: "organiser", competitions };
  }
  throw refusal(403, "NoFairPlayAccess", "This account holds no FairPlay permission.", "Ask a DTP admin for access.");
}

export function mayReadCompetition(reader: Reader, competitionId: string): boolean {
  return !reader.competitions || reader.competitions.includes(competitionId);
}

/** The same refusal for "not there" and "not yours", so ids cannot be probed. */
export function assertCompetition(reader: Reader, competitionId: string, what: string, id: string): void {
  if (!mayReadCompetition(reader, competitionId)) throw refusal(404, "NotFound", `Unknown ${what} ${id}`, "Check the id.");
}

/** Prisma `where` for devices this reader may see and act on: none of their open sessions is another competition's. */
export function devicesWhere(reader: Reader) {
  return reader.competitions
    ? { sessions: { none: { endedAt: null, competitionId: { notIn: reader.competitions } } } }
    : {};
}

type ScopedAccount = { allCompetitions: boolean; competitionId: string | null; competitions: { competitionId: string }[] };

/**
 * Whether an account (not the caller) may read a competition, on the rule the admin sign-in
 * applies (admin-auth.service.ts): every competition when granted all, or when it has no
 * grants at all; otherwise the union of the join table and the legacy column.
 */
export function accountReads(account: ScopedAccount, competitionId: string): boolean {
  if (account.allCompetitions) return true;
  const granted = [...account.competitions.map((c) => c.competitionId), ...(account.competitionId ? [account.competitionId] : [])];
  return !granted.length || granted.includes(competitionId);
}

/** What `accountReads` needs: in a Prisma `select`, all three; in an `include`, the scalars come anyway. */
export const ACCOUNT_COMPETITIONS = { competitions: { select: { competitionId: true } } } as const;
export const ACCOUNT_SCOPE = { allCompetitions: true, competitionId: true, ...ACCOUNT_COMPETITIONS } as const;

export function actorFields(ctx: AdminAuthContext): { actorKind: string; actorId: string | null; actorEmail: string | null } {
  return { actorKind: ctx.method === "api_key" ? "api_key" : "admin", actorId: ctx.userId ?? null, actorEmail: ctx.email ?? null };
}
