/**
 * Which web origins may read the API's responses from a browser.
 *
 * `origin: true` reflected any Origin back, so a page on any site could call the API from
 * a visitor's browser and read the answer. The site itself never needed that: dtp.africa
 * serves the SPA and the API from one origin through CloudFront, and in development Vite
 * proxies /api, so the browser sees one origin there too. The list is for what is left:
 * the two production hostnames, and in development a Vite or preview server called
 * directly.
 *
 * CORS only governs what a *browser* lets a page read. Servers, workers and curl send no
 * Origin and are unaffected, and an Origin not on the list gets no CORS headers rather
 * than an error: the browser does the refusing.
 */

/** The production site. Always allowed. */
export const PRODUCTION_ORIGINS = ["https://dtp.africa", "https://www.dtp.africa"] as const;

/** Vite's dev server (5173) and `vite preview` (4173), by either loopback name. Development only. */
export const DEVELOPMENT_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
] as const;

/**
 * The allow-list. CORS_ORIGINS, comma-separated, replaces the production pair when set
 * (a staging hostname, say); outside production the development origins are added either
 * way. An origin is scheme, host and port, with no path and no trailing slash, which is
 * how a browser sends it, so entries are normalised to that.
 */
export function corsOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = (env.CORS_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(normaliseOrigin);
  const base = configured.length > 0 ? configured : [...PRODUCTION_ORIGINS];
  const development = env.NODE_ENV === "production" ? [] : [...DEVELOPMENT_ORIGINS];
  return [...new Set([...base, ...development])];
}

function normaliseOrigin(entry: string): string {
  try {
    return new URL(entry).origin;
  } catch {
    throw new Error(`CORS_ORIGINS has an entry that is not an origin: "${entry}". Use e.g. https://dtp.africa`);
  }
}
