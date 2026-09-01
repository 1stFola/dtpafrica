function apiOrigin(): string {
  const env = import.meta.env as Record<string, string | undefined>;
  const configured =
    env.VITE_API_ORIGIN?.trim() ||
    env.VITE_API_URL?.trim() ||
    env.VITE_API_BASE_URL?.trim() ||
    env.VITE_API_PROXY?.trim();
  if (configured) return configured;

  const { hostname, port, protocol } = window.location;
  const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1";
  if (isLocalHost && port && port !== "3000") {
    return `${protocol}//${hostname}:3000`;
  }

  return window.location.origin;
}

export function liveAudioSocketUrl(path: string): string {
  const url = new URL(path, apiOrigin());
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}
