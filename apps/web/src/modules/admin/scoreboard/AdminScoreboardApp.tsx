import { Navigate, Route, Routes } from "react-router-dom";
import { AdminRequirePermission } from "../AdminRequirePermission";
import { AdminScoreboardLayout } from "./AdminScoreboardLayout";
import { AdminScoreboardHighlightsManagerPage } from "./pages/AdminScoreboardHighlightsManagerPage";
import { AdminScoreboardHighlightsPage } from "./pages/AdminScoreboardHighlightsPage";
import { AdminScoreboardHubPage } from "./pages/AdminScoreboardHubPage";
import { AdminScoreboardMatchCenterPage } from "./pages/AdminScoreboardMatchCenterPage";
import { AdminScoreboardRosterPage } from "./pages/AdminScoreboardRosterPage";
import { AdminScoreboardSquadManagementPage } from "./pages/AdminScoreboardSquadManagementPage";

export function AdminScoreboardApp() {
  return (
    <Routes>
      <Route element={<AdminScoreboardLayout />}>
        <Route index element={<AdminScoreboardHubPage />} />
        <Route path="entities" element={<Navigate to="/admin/records" replace />} />
        <Route
          element={
            <AdminRequirePermission
              permission="scoreboard.records.manage"
              redirectTo="/admin/scoreboard"
            />
          }
        >
          <Route path="squads" element={<AdminScoreboardSquadManagementPage />} />
        </Route>
        <Route path="roster" element={<AdminScoreboardRosterPage />} />
        <Route path="highlights" element={<AdminScoreboardHighlightsPage />} />
        <Route path="highlights-manager" element={<AdminScoreboardHighlightsManagerPage />} />
        <Route path="match-center" element={<AdminScoreboardMatchCenterPage />} />
        <Route path="*" element={<Navigate to="/admin/scoreboard" replace />} />
      </Route>
    </Routes>
  );
}
