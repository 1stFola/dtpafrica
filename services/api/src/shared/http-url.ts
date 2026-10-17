import { Transform } from "class-transformer";
import { registerDecorator, type ValidationOptions } from "class-validator";

/**
 * Links that end up as an `<a href>` in the web app.
 *
 * A stored `javascript:alert(document.cookie)` runs in the session of whoever clicks it, and
 * the support report's `pageUrl` is written by anonymous visitors and clicked by admins. So
 * anything rendered as a link is checked here to be an absolute http or https URL. The web
 * app checks again when it renders (apps/web/src/lib/safe-href.ts), for rows stored before.
 */
export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed !== value) return false;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return false;
  }
  return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
}

/** Empty or missing passes, so an optional link can still be cleared. */
export function IsHttpUrl(options?: ValidationOptions) {
  return function decorate(object: object, propertyName: string) {
    registerDecorator({
      name: "isHttpUrl",
      target: object.constructor,
      propertyName,
      options: { message: `${propertyName} must be an http or https link`, ...options },
      validator: {
        validate(value: unknown) {
          if (value == null || value === "") return true;
          return isHttpUrl(value);
        },
      },
    });
  };
}

// A leading `name:` is a scheme. Anything else typed into a website box ("www.club.com",
// "club.com/about") is a bare host the person meant as a web address.
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * What someone types into a "website" box, as a link: trimmed, with `https://` in front of a
 * bare host. A value that names a scheme is left as it is for `IsHttpUrl` to judge, so
 * `javascript:...` is refused rather than turned into `https://javascript:...`.
 */
export function normalizeWebsiteUrl(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed || HAS_SCHEME.test(trimmed) || trimmed.startsWith("//")) return trimmed;
  return `https://${trimmed}`;
}

/** `normalizeWebsiteUrl` as a DTO transform; pair it with `@IsHttpUrl()`. */
export const NormalizeWebsiteUrl = () => Transform(({ value }) => normalizeWebsiteUrl(value));
