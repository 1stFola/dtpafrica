import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { AppShell } from "./layout/AppShell";
import { HomePage } from "./modules/directopro/HomePage";
import { MarketingLayout } from "./modules/directopro/MarketingLayout";

const AboutPage = lazy(() =>
  import("./modules/directopro/pages/AboutPage").then((module) => ({
    default: module.AboutPage,
  }))
);
const AcademyPage = lazy(() =>
  import("./modules/directopro/pages/AcademyPage").then((module) => ({
    default: module.AcademyPage,
  }))
);
const BlogPage = lazy(() =>
  import("./modules/directopro/pages/BlogPage").then((module) => ({
    default: module.BlogPage,
  }))
);
const BlogPostPage = lazy(() =>
  import("./modules/directopro/pages/BlogPostPage").then((module) => ({
    default: module.BlogPostPage,
  }))
);
const ContactPage = lazy(() =>
  import("./modules/directopro/pages/ContactPage").then((module) => ({
    default: module.ContactPage,
  }))
);
const FeaturedPlayersPage = lazy(() =>
  import("./modules/directopro/pages/FeaturedPlayersPage").then((module) => ({
    default: module.FeaturedPlayersPage,
  }))
);
const PlayerProfilePage = lazy(() =>
  import("./modules/directopro/pages/PlayerProfilePage").then((module) => ({
    default: module.PlayerProfilePage,
  }))
);
const RegisterPage = lazy(() =>
  import("./modules/directopro/pages/RegisterPage").then((module) => ({
    default: module.RegisterPage,
  }))
);
const ScoreboardApp = lazy(() =>
  import("./modules/scoreboard/ScoreboardApp").then((module) => ({
    default: module.ScoreboardApp,
  }))
);
const ScoutingApp = lazy(() =>
  import("./modules/scouting/ScoutingApp").then((module) => ({
    default: module.ScoutingApp,
  }))
);
const MatchConsoleApp = lazy(() =>
  import("./modules/admin/MatchConsoleApp").then((module) => ({
    default: module.MatchConsoleApp,
  }))
);
const SuperAdminApp = lazy(() =>
  import("./modules/admin/SuperAdminApp").then((module) => ({
    default: module.SuperAdminApp,
  }))
);
const AdminApp = lazy(() =>
  import("./modules/admin/AdminApp").then((module) => ({ default: module.AdminApp }))
);
const AcademyApp = lazy(() =>
  import("./modules/academy/AcademyApp").then((module) => ({
    default: module.AcademyApp,
  }))
);

function RouteFallback() {
  return (
    <div className="route-loading" role="status" aria-live="polite">
      Loading...
    </div>
  );
}

function LazyRoute({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>;
}

function ValuationPlayerRedirect() {
  const { playerId } = useParams<{ playerId: string }>();
  return <Navigate to={`/scouting/valuation/${playerId ?? ""}`} replace />;
}

export default function App() {
  return (
    <Routes>
      {/* Outside AppShell: the recorder console owns the full viewport, with no
          site header sitting on top of its frozen panel. */}
      <Route
        path="admin/match-stats/:matchId/*"
        element={<LazyRoute><MatchConsoleApp /></LazyRoute>}
      />
      <Route element={<AppShell />}>
        <Route element={<MarketingLayout />}>
          <Route index element={<HomePage />} />
          <Route path="featured-players" element={<LazyRoute><FeaturedPlayersPage /></LazyRoute>} />
          <Route path="players/:slugOrId" element={<LazyRoute><PlayerProfilePage /></LazyRoute>} />
          <Route path="player/:slugOrId" element={<LazyRoute><PlayerProfilePage /></LazyRoute>} />
          <Route path="register" element={<LazyRoute><RegisterPage /></LazyRoute>} />
          <Route path="partners/academies" element={<LazyRoute><AcademyPage /></LazyRoute>} />
          <Route path="blog" element={<LazyRoute><BlogPage /></LazyRoute>} />
          <Route path="blog/:slug" element={<LazyRoute><BlogPostPage /></LazyRoute>} />
          <Route path="about" element={<LazyRoute><AboutPage /></LazyRoute>} />
          <Route path="contact" element={<LazyRoute><ContactPage /></LazyRoute>} />
        </Route>
        <Route path="comparison" element={<Navigate to="/scouting/compare" replace />} />
        <Route path="scouting/*" element={<LazyRoute><ScoutingApp /></LazyRoute>} />
        <Route path="scoreboard/*" element={<LazyRoute><ScoreboardApp /></LazyRoute>} />
        <Route path="valuation" element={<Navigate to="/scouting" replace />} />
        <Route path="valuation/generate" element={<Navigate to="/scouting/generate" replace />} />
        <Route path="valuation/compare" element={<Navigate to="/scouting/compare" replace />} />
        <Route path="valuation/player/:playerId" element={<ValuationPlayerRedirect />} />
        <Route path="admin/*" element={<LazyRoute><AdminApp /></LazyRoute>} />
        {/* Super admin sign-in lives outside the /admin tree so the API key
            field is never rendered on the page staff use. */}
        <Route path="superadmin" element={<LazyRoute><SuperAdminApp /></LazyRoute>} />
        <Route path="academy/*" element={<LazyRoute><AcademyApp /></LazyRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
