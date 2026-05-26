import { Route, Routes } from "react-router-dom";
import { ScoreboardLayout } from "./ScoreboardLayout";
import { BrowsePage } from "./pages/BrowsePage";
import { CompetitionPage } from "./pages/CompetitionPage";
import { HighlightsPage } from "./pages/HighlightsPage";
import { LiveMatchesPage } from "./pages/LiveMatchesPage";
import { MatchCenterPage } from "./pages/MatchCenterPage";
import { ScoreboardHubPage } from "./pages/ScoreboardHubPage";
import { SupervisorPage } from "./pages/SupervisorPage";
import { TeamPage } from "./pages/TeamPage";

export function ScoreboardApp() {
  return (
    <Routes>
      <Route element={<ScoreboardLayout />}>
        <Route index element={<ScoreboardHubPage />} />
        <Route path="live" element={<LiveMatchesPage />} />
        <Route path="browse" element={<BrowsePage />} />
        <Route path="competition/:slug" element={<CompetitionPage />} />
        <Route path="team/:id" element={<TeamPage />} />
        <Route path="match/:id" element={<MatchCenterPage />} />
        <Route path="highlights" element={<HighlightsPage />} />
        <Route path="supervisor" element={<SupervisorPage />} />
      </Route>
    </Routes>
  );
}
