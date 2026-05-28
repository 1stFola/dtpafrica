import { Navigate, Route, Routes } from "react-router-dom";
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
import { ValuationApp } from "./modules/valuation/ValuationApp";
import { AdminApp } from "./modules/admin/AdminApp";
import { AcademyDashboardApp } from "./modules/academy/AcademyDashboardApp";

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route element={<MarketingLayout />}>
          <Route index element={<HomePage />} />
          <Route path="featured-players" element={<FeaturedPlayersPage />} />
          <Route path="player/:slugOrId" element={<PlayerProfilePage />} />
          <Route path="register" element={<RegisterPage />} />
          <Route path="academy" element={<AcademyPage />} />
          <Route path="blog" element={<BlogPage />} />
          <Route path="blog/:slug" element={<BlogPostPage />} />
          <Route path="about" element={<AboutPage />} />
          <Route path="contact" element={<ContactPage />} />
        </Route>
        <Route path="comparison" element={<Navigate to="/scouting/compare" replace />} />
        <Route path="scouting/*" element={<ScoutingApp />} />
        <Route path="scoreboard/*" element={<ScoreboardApp />} />
        <Route path="valuation/*" element={<ValuationApp />} />
        <Route path="admin/*" element={<AdminApp />} />
        <Route path="spotter-tablet" element={<SpotterTabletPage />} />
        <Route path="academy/:slug/dashboard/*" element={<AcademyDashboardApp />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
