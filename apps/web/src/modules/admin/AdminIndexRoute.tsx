import { Navigate } from "react-router-dom";
import { useAdminAuth } from "./AdminAuthContext";
import { adminLandingPath } from "./admin-permissions";
import { AdminDashboardPage } from "./pages/AdminDashboardPage";

/**
 * Landing route for /admin.
 *
 * Contracted match recorders have no dashboard permission, so rendering the
 * dashboard for them would show an empty shell with nothing they can act on.
 * Send them straight to their match sheets instead.
 */
export function AdminIndexRoute() {
  const { session } = useAdminAuth();
  if (!session) return null;

  const landing = adminLandingPath(session);
  if (landing !== "/admin") return <Navigate to={landing} replace />;

  return <AdminDashboardPage />;
}
