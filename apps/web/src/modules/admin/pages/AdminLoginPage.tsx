import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@dtp/ui";
import { BrandLogo } from "../../../components/BrandLogo";
import { useAdminAuth } from "../AdminAuthContext";
import { usePageTitle } from "../../../hooks/usePageTitle";

/**
 * Everyday admin sign-in: email and password against a role-assigned account.
 *
 * The API key route deliberately does not appear here — it lives on its own
 * page at /superadmin, so the master credential is not advertised to staff and
 * contracted match recorders.
 */
export function AdminLoginPage() {
  usePageTitle("Admin login");
  const { loginWithPassword, checkStored, isAuthenticated } = useAdminAuth();
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

        <form onSubmit={onSubmitPassword}>
          <p className="muted">
            Sign in with your admin account. What you can see and do depends on the
            role you have been assigned.
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

        <p className="muted">
          <Link to="/">← Back to site</Link>
        </p>
      </div>
    </div>
  );
}
