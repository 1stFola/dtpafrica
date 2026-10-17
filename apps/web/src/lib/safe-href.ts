/**
 * A stored link, made safe to put in an `<a href>`, or null when it is not.
 *
 * React does not stop `href="javascript:..."`: it warns, then renders it, and the script runs
 * in the session of whoever clicks. Support reports, academy websites and ad destinations are
 * all typed by someone other than the person who clicks them, so they go through here. Only
 * absolute http and https links survive. The API refuses anything else on the way in
 * (services/api/src/shared/http-url.ts); this covers rows stored before it did.
 */
export function safeHref(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.href;
}
