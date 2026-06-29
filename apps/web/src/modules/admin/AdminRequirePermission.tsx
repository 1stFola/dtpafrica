import { Navigate, Outlet } from "react-router-dom";
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

  if (!hasPermission(permission)) {
    return <Navigate to={redirectTo} replace />;
  }

  return <Outlet />;
}
