import { Navigate, Outlet, useParams } from "react-router-dom";
import { useAcademyAuth } from "./AcademyAuthContext";

export function RequireAcademySlug() {
  const { slug = "" } = useParams<{ slug: string }>();
  const { academy, isAuthenticated } = useAcademyAuth();

  if (!isAuthenticated || !academy) {
    return (
      <Navigate
        to={`/academy/login?redirect=${encodeURIComponent(`/academy/${slug}/dashboard`)}`}
        replace
      />
    );
  }

  if (academy.slug !== slug) {
    return <Navigate to={`/academy/${academy.slug}/dashboard`} replace />;
  }

  return <Outlet />;
}
