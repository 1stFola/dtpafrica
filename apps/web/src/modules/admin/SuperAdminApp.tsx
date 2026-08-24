import { AdminAuthProvider } from "./AdminAuthContext";
import { SuperAdminLoginPage } from "./pages/SuperAdminLoginPage";

/**
 * Mounts the super admin login at the top-level /superadmin route.
 *
 * It needs its own AdminAuthProvider because it sits outside the /admin tree.
 * The credential is written to sessionStorage on success, so the provider that
 * mounts with /admin afterwards picks the session straight up.
 */
export function SuperAdminApp() {
  return (
    <AdminAuthProvider>
      <SuperAdminLoginPage />
    </AdminAuthProvider>
  );
}
