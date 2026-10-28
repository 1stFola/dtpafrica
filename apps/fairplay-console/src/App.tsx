import { useCallback, useEffect, useState } from "react";
import { DtpLogo } from "@dtp/ui";
import { ApiError, get, post, type AuthStatus, type Me } from "./api";
import { ShadowBanner } from "./Banner";
import { Console } from "./Console";

export function App() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [checked, setChecked] = useState(false);

  const refresh = useCallback(async () => {
    setStatus(await get<AuthStatus>("/edge/v1/auth/status").catch(() => null));
    try {
      setMe(await get<Me>("/edge/v1/auth/me"));
    } catch {
      setMe(null);
    }
    setChecked(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!checked) return <p className="fp-center">Connecting to the Edge…</p>;
  if (!me) return <SignIn status={status} onSignedIn={setMe} />;
  return (
    <Console
      me={me}
      onSignedOut={async () => {
        await post("/edge/v1/auth/logout").catch(() => undefined);
        setMe(null);
        void refresh();
      }}
    />
  );
}

function SignIn({ status, onSignedIn }: { status: AuthStatus | null; onSignedIn: (me: Me) => void }) {
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await post<Me>("/edge/v1/auth/login", { email, pin }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "the Edge did not answer");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fp-signin-page">
      <ShadowBanner dev={Boolean(status?.dev)} />
      <form className="fp-signin" onSubmit={submit} aria-labelledby="signin-title">
        <div className="fp-brand">
          <DtpLogo />
          <h1 id="signin-title">FairPlay Edge</h1>
        </div>
        <p className="fp-muted">
          {status?.device ?? "venue"} · works with no internet ·{" "}
          {status?.secure ? "encrypted connection" : "this machine only"}
        </p>
        {status && !status.bundleLoaded && (
          <p className="fp-warn" role="alert">No operator list is installed on this Edge: {status.problem}</p>
        )}
        {status?.bundleLoaded && (
          <p className="fp-muted">
            Operator list {status.sessionLabel ? `“${status.sessionLabel}” ` : ""}valid until{" "}
            {new Date(status.expiresUtc!).toLocaleString()}
          </p>
        )}
        <label>
          Email
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Matchday PIN
          <input type="password" inputMode="numeric" autoComplete="current-password" minLength={6} value={pin}
                 onChange={(e) => setPin(e.target.value)} required />
        </label>
        {error && <p className="fp-error" role="alert">{error}</p>}
        <button type="submit" className="fp-btn fp-btn--primary" disabled={busy || !status?.bundleLoaded}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
