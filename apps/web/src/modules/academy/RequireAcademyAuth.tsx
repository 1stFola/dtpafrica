import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAcademyAuth } from "./AcademyAuthContext";

export function RequireAcademyAuth() {
  const { checkStored, isAuthenticated } = useAcademyAuth();
  const [ready, setReady] = useState(false);
  const location = useLocation();

  useEffect(() => {
    checkStored().finally(() => setReady(true));
  }, [checkStored]);

  if (!ready) {
    return <p className="academy-login-loading muted">Checking club session…</p>;
  }

  if (!isAuthenticated) {
    const returnPath = location.pathname + location.search;
    return (
      <Navigate
        to={`/academy/login?redirect=${encodeURIComponent(returnPath)}`}
        replace
      />
    );
  }

  return <Outlet />;
}
