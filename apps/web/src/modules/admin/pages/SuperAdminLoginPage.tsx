import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@dtp/ui";
import { BrandLogo } from "../../../components/BrandLogo";
import { useAdminAuth } from "../AdminAuthContext";
import { usePageTitle } from "../../../hooks/usePageTitle";

/**
 * Super admin door, on its own route at /superadmin.
 *
 * The API key grants unrestricted access, so it is kept off the everyday
 * /admin/login page that contracted recorders and role-assigned staff use —
 * they should never be shown a field that hints at a master credential.
 */
export function SuperAdminLoginPage() {
  usePageTitle("Super admin login");
  const { login, checkStored, isAuthenticated } = useAdminAuth();
  const navigate = useNavigate();
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

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const key = new FormData(e.currentTarget).get("apiKey") as string;
    try {
      await login(key);
      navigate("/admin", { replace: true });
    } catch {
      setError("Invalid API key, or the server has no ADMIN_API_KEY configured.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-login-page admin-login-page--super">
      <div className="admin-login-card admin-login-card--super home-form">
        <Link to="/" className="admin-login-card__brand">
          <BrandLogo variant="white-vertical" size="login" />
        </Link>

        <span className="admin-login-badge">Super admin</span>
        <h1>Restricted access</h1>

        <form onSubmit={onSubmit}>
          <p className="muted">
            Sign in with the admin API key. This grants unrestricted access to every
            competition and every admin area.
          </p>
          <label>
            Admin API key
            <input
              name="apiKey"
              type="password"
              required
              autoComplete="off"
              autoFocus
              spellCheck={false}
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          <Button type="submit" disabled={loading}>
            {loading ? "Signing in…" : "Sign in as super admin"}
          </Button>
        </form>

        <p className="muted admin-login-alt">
          Staff and match recorders sign in at <Link to="/admin/login">/admin/login</Link>.
        </p>
        <p className="muted">
          <Link to="/">← Back to site</Link>
        </p>
      </div>
    </div>
  );
}
