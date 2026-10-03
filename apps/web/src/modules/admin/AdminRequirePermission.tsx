import { Navigate, Outlet, useOutletContext } from "react-router-dom";
import { useAdminAuth } from "./AdminAuthContext";

type Props = {
  permission: string | string[];
  redirectTo?: string;
};

export function AdminRequirePermission({
  permission,
  redirectTo = "/admin",
}: Props) {
  const { hasPermission } = useAdminAuth();
  /* A guard in the middle of a layout's routes must hand the layout's outlet
     context on, or a page under it reads undefined where it expects the layout's. */
  const context = useOutletContext();

  if (!hasPermission(permission)) {
    return <Navigate to={redirectTo} replace />;
  }

  return <Outlet context={context} />;
}
