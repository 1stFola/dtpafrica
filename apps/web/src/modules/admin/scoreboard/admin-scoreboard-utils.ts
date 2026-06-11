import { AdminApiError } from "../../../api/admin";

/** Parse NestJS / API error payloads into a short user-facing string. */
export function formatAdminScoreboardError(err: unknown): string {
  if (err instanceof AdminApiError) {
    try {
      const body = JSON.parse(err.message) as {
        message?: string | string[] | { message?: string; errors?: string[] };
        errors?: string[];
        error?: string;
      };
      if (Array.isArray(body.errors) && body.errors.length) {
        return body.errors.join("\n");
      }
      if (
        body.message &&
        typeof body.message === "object" &&
        !Array.isArray(body.message) &&
        Array.isArray(body.message.errors)
      ) {
        return body.message.errors.join("\n");
      }
      if (Array.isArray(body.message)) return body.message.join(". ");
      if (typeof body.message === "string") return body.message;
    } catch {
      /* plain text */
    }
    if (err.message && err.message.length < 200) return err.message;
    if (err.status === 403) {
      return "Action blocked — complete matchday rosters and lock lineups on the spotter tablet.";
    }
    return err.message || `Request failed (${err.status})`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
