const STORAGE_KEY = "dtp_academy_token";

export function getAcademyToken(): string | null {
  return sessionStorage.getItem(STORAGE_KEY);
}

export function setAcademyToken(token: string) {
  sessionStorage.setItem(STORAGE_KEY, token);
}

export function clearAcademyToken() {
  sessionStorage.removeItem(STORAGE_KEY);
}

export class AcademyAuthError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

export async function academyAuthFetch<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const token = getAcademyToken();
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new AcademyAuthError(text || res.statusText, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export type AcademyLoginResponse = {
  token: string;
  academy: {
    id: string;
    slug: string;
    name: string;
    loginUsername: string | null;
  };
};

export type AcademyDirectoryEntry = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  city: string;
  seed: number | null;
  badges: string[];
};

export function academyLogin(username: string, password: string) {
  return academyAuthFetch<AcademyLoginResponse>("/academy/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function verifyAcademySession() {
  return academyAuthFetch<{
    ok: boolean;
    academy: AcademyLoginResponse["academy"];
  }>("/academy/auth/session");
}

export function fetchAcademyDirectory(signal?: AbortSignal) {
  return academyAuthFetch<AcademyDirectoryEntry[]>("/academy/directory", { signal });
}
