function apiOrigin(): string {
  const env = import.meta.env as Record<string, string | undefined>;
  return (
    env.VITE_API_ORIGIN?.trim() ||
    env.VITE_API_URL?.trim() ||
    env.VITE_API_BASE_URL?.trim() ||
    env.VITE_API_PROXY?.trim() ||
    window.location.origin
  );
}

export function liveAudioSocketUrl(path: string): string {
  const url = new URL(path, apiOrigin());
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}
