/**
 * One shape for a refusal, and one way to require a person.
 *
 * A Vision refusal tells the operator what to do next: `{ statusCode, error,
 * message, remediation }`. Most did. Some threw a bare string, which Nest turns
 * into `error: "Not Found"` with no remediation, and `requirePerson` had been
 * copied into five services (docs/vision/50, appendix B). These builders are
 * the shape, so a new refusal cannot leave part of it out.
 */
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, type HttpException } from "@nestjs/common";
import type { AdminAuthContext } from "../../admin/auth/admin-auth.types";

export type RefusalBody = { statusCode: number; error: string; message: string; remediation: string } & Record<string, unknown>;

const BY_STATUS = { 400: BadRequestException, 403: ForbiddenException, 404: NotFoundException, 409: ConflictException } as const;
export type RefusalStatus = keyof typeof BY_STATUS;

/** A refusal with every part of the shape. `extra` adds fields a screen reads, such as `problems`. */
export function refusal(statusCode: RefusalStatus, error: string, message: string, remediation: string, extra: Record<string, unknown> = {}): HttpException {
  // The shape last, so nothing passed beside it can replace a part of it.
  const body: RefusalBody = { ...extra, statusCode, error, message, remediation };
  return new BY_STATUS[statusCode](body);
}

/** `404 NotFound`: the thing asked for by id is not there. */
export function notFound(what: string, id: string, remediation = `Check the id; the ${what} may have been removed.`): HttpException {
  return refusal(404, "NotFound", `Unknown ${what} ${id}`, remediation);
}

/**
 * A check that the caller is a signed-in person, for one kind of act.
 *
 * The shared operator key has no user id. Anything with a name on it, and
 * anything a second person has to confirm, is refused to it with the error and
 * the reason of the service that asks.
 */
export function personFor(error: string, detail: string) {
  return (actor: AdminAuthContext | undefined, what: string): { userId: string; email?: string } => {
    if (!actor?.userId) {
      throw refusal(403, error, `Only a signed-in person may ${what}.`, "Sign in as yourself.", { detail });
    }
    return { userId: actor.userId, email: actor.email };
  };
}
