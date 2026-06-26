import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@dtp/ui";
import { BrandLogo } from "../../../components/BrandLogo";
import { useAdminAuth } from "../AdminAuthContext";
import { usePageTitle } from "../../../hooks/usePageTitle";

export function AdminLoginPage() {
  usePageTitle("Admin login");
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
      setError("Invalid API key or server not configured with ADMIN_API_KEY.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-login-page">
      <form className="admin-login-card home-form" onSubmit={onSubmit}>
        <Link to="/" className="admin-login-card__brand">
          <BrandLogo variant="white-vertical" size="login" />
        </Link>
        <h1>DTP Admin</h1>
        <p className="muted">
          Enter the admin API key from <code>services/api/.env</code> (
          <code>ADMIN_API_KEY</code>).
        </p>
        <label>
          Admin API key
          <input name="apiKey" type="password" required autoComplete="off" />
        </label>
        {error && <p className="form-error">{error}</p>}
        <Button type="submit" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </Button>
        <p className="muted">
          <Link to="/">← Back to site</Link>
        </p>
      </form>
    </div>
  );
}
