import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAdminAuth } from "./AdminAuthContext";

export function AdminRequireAuth() {
  const { checkStored, isAuthenticated } = useAdminAuth();
  const [ready, setReady] = useState(false);
  const location = useLocation();

  useEffect(() => {
    checkStored().finally(() => setReady(true));
  }, [checkStored]);

  if (!ready) {
    return <p className="muted admin-loading">Checking session…</p>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/admin/login" state={{ from: location.pathname }} replace />;
  }

  return <Outlet />;
}
