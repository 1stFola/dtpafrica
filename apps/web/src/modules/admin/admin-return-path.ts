/** Keep sign-in redirects inside the admin application. */
export function adminReturnPath(state: unknown): string {
  const from = (state as { from?: unknown } | null)?.from;
  if (typeof from !== "string" || !from.startsWith("/admin/") || /[\\\s]/.test(from)) return "/admin";
  const path = from.split(/[?#]/)[0];
  if (path === "/admin/login" || path === "/admin/superadmin") return "/admin";
  return from;
}
