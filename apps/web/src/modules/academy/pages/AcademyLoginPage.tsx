import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@dtp/ui";
import { BrandLogo } from "../../../components/BrandLogo";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { useAcademyAuth } from "../AcademyAuthContext";

function safeRedirectPath(value: string | null): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

export function AcademyLoginPage() {
  usePageTitle("Club login");
  const { login, isAuthenticated } = useAcademyAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const redirectTarget = useMemo(() => {
    const fromQuery = safeRedirectPath(
      searchParams.get("redirect") ?? searchParams.get("next")
    );
    const fromState = safeRedirectPath(
      (location.state as { from?: string } | null)?.from ?? null
    );
    return fromQuery ?? fromState ?? "/academy";
  }, [location.state, searchParams]);
  const slugHint = searchParams.get("slug") ?? "";
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isAuthenticated) navigate(redirectTarget, { replace: true });
  }, [isAuthenticated, redirectTarget, navigate]);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const data = new FormData(e.currentTarget);
    const username = String(data.get("username") ?? "");
    const password = String(data.get("password") ?? "");
    try {
      await login(username, password);
      navigate(redirectTarget, { replace: true });
    } catch {
      setError("Invalid username or password. Contact DTP admin if credentials are not set.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="academy-login-page">
      <form className="academy-login-card" onSubmit={onSubmit}>
        <Link to="/" className="academy-login-card__brand">
          <BrandLogo variant="white-vertical" size="login" />
        </Link>
        <p className="academy-login-eyebrow">DTP Club Portal</p>
        <h1>Club Login</h1>
        <p className="academy-login-lead muted">
          Sign in with the username and password set in the admin academies panel.
          Legacy academies without credentials must be configured before login.
        </p>
        <label className="academy-login-field">
          <span>Username</span>
          <input
            name="username"
            type="text"
            required
            autoComplete="username"
            defaultValue={slugHint}
          />
        </label>
        <label className="academy-login-field">
          <span>Password</span>
          <input name="password" type="password" required autoComplete="current-password" />
        </label>
        {error && <p className="form-error">{error}</p>}
        <Button type="submit" disabled={loading} className="academy-login-submit">
          {loading ? "Signing in…" : "Enter club portal"}
        </Button>
        <p className="muted academy-login-footer">
          <Link to="/">← Back to site</Link>
        </p>
      </form>
    </div>
  );
}
