import type { Prisma } from "@prisma/client";
import { refusal } from "../shared/refusals";

/**
 * What the audit screen may ask for, read from a query string.
 *
 * Kept apart from the controller so the rules can be tested without a database:
 * what narrows the trail, how far back one answer reaches, and what is refused
 * rather than quietly ignored. A filter that is silently dropped would show
 * somebody every row and let them believe they were looking at a few.
 */

export const AUDIT_PAGE_DEFAULT = 50;
export const AUDIT_PAGE_MAX = 200;

/** How a row's actor came in. `none` is a row written with no actor at all. */
export const AUDIT_METHODS = ["jwt", "api_key", "provision_key", "none"] as const;
export type AuditMethod = (typeof AUDIT_METHODS)[number];

export type AuditQueryInput = {
  action?: string;
  targetKind?: string;
  targetId?: string;
  actor?: string;
  method?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: string;
};

export type AuditQuery = {
  where: Prisma.VisionAuditLogWhereInput;
  limit: number;
  cursor: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME = /^[a-z][a-z0-9_.]*$/;

function invalid(field: string, why: string, remediation: string) {
  return refusal(400, "AuditFilterInvalid", `${field}: ${why}`, remediation, { field });
}

function text(value: string | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || null;
}

function moment(field: "from" | "to", value: string | undefined): Date | null {
  const raw = text(value);
  if (!raw) return null;
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) throw invalid(field, `"${raw}" is not a time.`, "Send an ISO 8601 time, such as 2026-10-04T00:00:00Z.");
  return at;
}

export function auditQuery(input: AuditQueryInput): AuditQuery {
  const where: Prisma.VisionAuditLogWhereInput = {};

  const action = text(input.action);
  if (action) {
    if (!NAME.test(action)) throw invalid("action", `"${action}" is not an action name.`, "Send an action such as media.raw.read, or a family ending in a dot such as identity.");
    // `identity.` is every action of that family; `identity.assigned` is that one.
    where.action = action.endsWith(".") ? { startsWith: action } : action;
  }

  const targetKind = text(input.targetKind);
  if (targetKind) {
    if (!NAME.test(targetKind)) throw invalid("targetKind", `"${targetKind}" is not a target kind.`, "Send a kind such as vision_video_asset.");
    where.targetKind = targetKind;
  }

  const targetId = text(input.targetId);
  if (targetId) where.targetId = targetId;

  const actor = text(input.actor);
  if (actor) {
    // An id is matched whole. Anything else is looked for in the email, which is
    // what a person remembers about a colleague.
    if (UUID.test(actor)) where.actorId = actor;
    else where.actorEmail = { contains: actor, mode: "insensitive" };
  }

  const method = text(input.method);
  if (method) {
    if (!(AUDIT_METHODS as readonly string[]).includes(method)) {
      throw invalid("method", `"${method}" is not a way of signing in.`, `Send one of ${AUDIT_METHODS.join(", ")}.`);
    }
    where.actorMethod = method === "none" ? null : method;
  }

  const from = moment("from", input.from);
  const to = moment("to", input.to);
  if (from && to && from > to) throw invalid("from", "it is after `to`.", "Send a `from` that is not later than `to`.");
  if (from || to) where.createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };

  let limit = AUDIT_PAGE_DEFAULT;
  const rawLimit = text(input.limit);
  if (rawLimit) {
    if (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1) throw invalid("limit", `"${rawLimit}" is not a count.`, `Send a whole number from 1 to ${AUDIT_PAGE_MAX}.`);
    limit = Math.min(Number(rawLimit), AUDIT_PAGE_MAX);
  }

  const cursor = text(input.cursor);
  if (cursor && !UUID.test(cursor)) throw invalid("cursor", "it is not a row of the trail.", "Send the `nextCursor` of the answer before, unchanged.");

  return { where, limit, cursor };
}
