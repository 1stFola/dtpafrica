import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { AppShell } from "./layout/AppShell";
import { HomePage } from "./modules/directopro/HomePage";
import { MarketingLayout } from "./modules/directopro/MarketingLayout";
import { AboutPage } from "./modules/directopro/pages/AboutPage";
import { AcademyPage } from "./modules/directopro/pages/AcademyPage";
import { BlogPage } from "./modules/directopro/pages/BlogPage";
import { BlogPostPage } from "./modules/directopro/pages/BlogPostPage";
import { ContactPage } from "./modules/directopro/pages/ContactPage";
import { FeaturedPlayersPage } from "./modules/directopro/pages/FeaturedPlayersPage";
import { PlayerProfilePage } from "./modules/directopro/pages/PlayerProfilePage";
import { RegisterPage } from "./modules/directopro/pages/RegisterPage";
import { ScoreboardApp } from "./modules/scoreboard/ScoreboardApp";
import { SpotterTabletPage } from "./modules/scoreboard/pages/SpotterTabletPage";
import { ScoutingApp } from "./modules/scouting/ScoutingApp";
import { AdminApp } from "./modules/admin/AdminApp";
import { AcademyApp } from "./modules/academy/AcademyApp";

function ValuationPlayerRedirect() {
  const { playerId } = useParams<{ playerId: string }>();
  return <Navigate to={`/scouting/valuation/${playerId ?? ""}`} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route element={<MarketingLayout />}>
          <Route index element={<HomePage />} />
          <Route path="featured-players" element={<FeaturedPlayersPage />} />
          <Route path="players/:slugOrId" element={<PlayerProfilePage />} />
          <Route path="player/:slugOrId" element={<PlayerProfilePage />} />
          <Route path="register" element={<RegisterPage />} />
          <Route path="partners/academies" element={<AcademyPage />} />
          <Route path="blog" element={<BlogPage />} />
          <Route path="blog/:slug" element={<BlogPostPage />} />
          <Route path="about" element={<AboutPage />} />
          <Route path="contact" element={<ContactPage />} />
        </Route>
        <Route path="comparison" element={<Navigate to="/scouting/compare" replace />} />
        <Route path="scouting/*" element={<ScoutingApp />} />
        <Route path="scoreboard/*" element={<ScoreboardApp />} />
        <Route path="valuation" element={<Navigate to="/scouting" replace />} />
        <Route path="valuation/generate" element={<Navigate to="/scouting/generate" replace />} />
        <Route path="valuation/compare" element={<Navigate to="/scouting/compare" replace />} />
        <Route path="valuation/player/:playerId" element={<ValuationPlayerRedirect />} />
        <Route path="admin/*" element={<AdminApp />} />
        <Route path="spotter-tablet" element={<SpotterTabletPage />} />
        <Route path="academy/*" element={<AcademyApp />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
