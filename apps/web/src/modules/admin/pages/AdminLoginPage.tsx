import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@dtp/ui";
import { BrandLogo } from "../../../components/BrandLogo";
import { useAdminAuth } from "../AdminAuthContext";
import { usePageTitle } from "../../../hooks/usePageTitle";

type LoginMode = "api_key" | "password";

export function AdminLoginPage() {
  usePageTitle("Admin login");
  const { login, loginWithPassword, checkStored, isAuthenticated } = useAdminAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<LoginMode>("api_key");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    checkStored().then((ok) => {
      if (ok) navigate("/admin", { replace: true });
    });
  }, [checkStored, navigate]);

  if (isAuthenticated) {
    return <p className="muted admin-loading">Redirecting to admin…</p>;
  }

  const onSubmitApiKey = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const key = new FormData(e.currentTarget).get("apiKey") as string;
    try {
      await login(key);
      navigate("/admin", { replace: true });
    } catch {
      setError("Invalid API key or server not configured with ADMIN_API_KEY.");
    } finally {
      setLoading(false);
    }
  };

  const onSubmitPassword = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const data = new FormData(e.currentTarget);
    try {
      await loginWithPassword(
        data.get("email") as string,
        data.get("password") as string
      );
      navigate("/admin", { replace: true });
    } catch {
      setError("Invalid email or password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-login-page">
      <div className="admin-login-card home-form">
        <Link to="/" className="admin-login-card__brand">
          <BrandLogo variant="white-vertical" size="login" />
        </Link>
        <h1>DTP Admin</h1>

        <div className="admin-login-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            className={mode === "api_key" ? "active" : ""}
            onClick={() => {
              setMode("api_key");
              setError(null);
            }}
          >
            API key
          </button>
          <button
            type="button"
            role="tab"
            className={mode === "password" ? "active" : ""}
            onClick={() => {
              setMode("password");
              setError(null);
            }}
          >
            Email & password
          </button>
        </div>

        {mode === "api_key" ? (
          <form onSubmit={onSubmitApiKey}>
            <p className="muted">
              Enter the admin API key from <code>services/api/.env</code> (
              <code>ADMIN_API_KEY</code>). Grants full super-admin access.
            </p>
            <label>
              Admin API key
              <input name="apiKey" type="password" required autoComplete="off" />
            </label>
            {error && <p className="form-error">{error}</p>}
            <Button type="submit" disabled={loading}>
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        ) : (
          <form onSubmit={onSubmitPassword}>
            <p className="muted">
              Sign in with a role-assigned admin user account. Permissions depend on
              your assigned role.
            </p>
            <label>
              Email
              <input name="email" type="email" required autoComplete="username" />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            <Button type="submit" disabled={loading}>
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        )}

        <p className="muted">
          <Link to="/">← Back to site</Link>
        </p>
      </div>
    </div>
  );
}
