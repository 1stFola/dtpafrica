import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  clearAdminApiKey,
  getAdminApiKey,
  verifyAdminSession,
} from "../../../api/admin";

type AdminApiKeyGateProps = {
  title: string;
  children: ReactNode;
};

export function AdminApiKeyGate({ title, children }: AdminApiKeyGateProps) {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    let active = true;

    const run = async () => {
      if (!getAdminApiKey()) {
        if (active) {
          setAuthed(false);
          setReady(true);
        }
        return;
      }
      try {
        await verifyAdminSession();
        if (active) setAuthed(true);
      } catch {
        clearAdminApiKey();
        if (active) setAuthed(false);
      } finally {
        if (active) setReady(true);
      }
    };

    void run();
    return () => {
      active = false;
    };
  }, []);

  if (!ready) {
    return <p className="muted admin-loading">Checking admin access…</p>;
  }

  if (!authed) {
    return (
      <div className="admin-api-key-gate">
        <h1>{title}</h1>
        <p className="muted">
          This tool requires an admin API key. Sign in through the admin panel first, or enter
          your key on the login screen.
        </p>
        <Link to="/admin/login" className="dtp-btn dtp-btn--primary">
          Go to admin login
        </Link>
      </div>
    );
  }

  return children;
}
