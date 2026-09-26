import { Route, Routes } from "react-router-dom";
import { AdminAuthProvider } from "./AdminAuthContext";
import { AdminToastProvider } from "./components/AdminToast";
import { AdminRequireAuth } from "./AdminRequireAuth";
import { AdminLayout } from "./AdminLayout";
import { AdminLoginPage } from "./pages/AdminLoginPage";
import { AdminBlogEditPage } from "./pages/AdminBlogEditPage";
import { AdminBlogListPage } from "./pages/AdminBlogListPage";
import { AdminAcademiesPage } from "./pages/AdminAcademiesPage";
import { AdminCalibrationPage } from "./pages/AdminCalibrationPage";
import { AdminFixturesPage } from "./pages/AdminFixturesPage";
import { AdminMatchStatsPage } from "./pages/AdminMatchStatsPage";
import { AdminTrainingPage } from "./pages/AdminTrainingPage";
import { AdminContentPage } from "./pages/AdminContentPage";
import { AdminIndexRoute } from "./AdminIndexRoute";
import { AdminDatabasePage } from "./pages/AdminDatabasePage";
import { AdminAdsPage } from "./pages/AdminAdsPage";
import { AdminHomepagePage } from "./pages/AdminHomepagePage";
import { AdminHomeVideoHighlightsPage } from "./pages/AdminHomeVideoHighlightsPage";
import { AdminInboxPage } from "./pages/AdminInboxPage";
import { AdminPlayersPage } from "./pages/AdminPlayersPage";
import { AdminOpsSupportPage } from "./pages/AdminOpsSupportPage";
import { AdminScoreboardApp } from "./scoreboard/AdminScoreboardApp";
import { AdminRequirePermission } from "./AdminRequirePermission";
import { AdminRolesPage } from "./settings/AdminRolesPage";
import { AdminUsersPage } from "./settings/AdminUsersPage";
import { AdminScoreboardEntitiesPage } from "./scoreboard/pages/AdminScoreboardEntitiesPage";
import { AdminVisionStatusPage } from "./vision/AdminVisionStatusPage";
import { AdminVisionSourcesPage } from "./vision/AdminVisionSourcesPage";
import { AdminVisionSourceDetailPage } from "./vision/AdminVisionSourceDetailPage";
import { AdminVisionAnnotationPage } from "./vision/AdminVisionAnnotationPage";

export function AdminApp() {
  return (
    <AdminAuthProvider>
      <AdminToastProvider>
        <Routes>
        <Route path="login" element={<AdminLoginPage />} />
        <Route element={<AdminRequireAuth />}>
          <Route element={<AdminLayout />}>
            <Route index element={<AdminIndexRoute />} />
            <Route path="inbox" element={<AdminInboxPage />} />
            <Route path="players" element={<AdminPlayersPage />} />
            <Route
              element={
                <AdminRequirePermission
                  permission={["scoreboard.fixtures.read", "scoreboard.read"]}
                />
              }
            >
              <Route path="fixtures" element={<AdminFixturesPage />} />
            </Route>
            <Route path="match-stats" element={<AdminMatchStatsPage />} />
            <Route path="training" element={<AdminTrainingPage />} />
            <Route path="calibration" element={<AdminCalibrationPage />} />
            <Route path="ops-support" element={<AdminOpsSupportPage />} />
            <Route path="homepage" element={<AdminHomepagePage />} />
            <Route path="homepage/video-highlights" element={<AdminHomeVideoHighlightsPage />} />
            <Route path="ads" element={<AdminAdsPage />} />
            <Route path="academies" element={<AdminAcademiesPage />} />
            <Route path="content" element={<AdminContentPage />} />
            <Route path="database" element={<AdminDatabasePage />} />
            <Route element={<AdminRequirePermission permission="scoreboard.records.manage" />}>
              <Route path="records" element={<AdminScoreboardEntitiesPage />} />
            </Route>
            <Route element={<AdminRequirePermission permission="vision.read" />}>
              <Route path="vision" element={<AdminVisionStatusPage />} />
              <Route path="vision/sources" element={<AdminVisionSourcesPage />} />
              <Route path="vision/sources/:id" element={<AdminVisionSourceDetailPage />} />
            </Route>
            {/* Claiming and labelling need `vision.annotate`; reading the queue does
                not. The workstation itself mounts outside AdminLayout — see App.tsx. */}
            <Route element={<AdminRequirePermission permission="vision.annotate" />}>
              <Route path="vision/annotation" element={<AdminVisionAnnotationPage />} />
            </Route>
            <Route path="blog" element={<AdminBlogListPage />} />
            <Route path="blog/new" element={<AdminBlogEditPage />} />
            <Route path="blog/:id" element={<AdminBlogEditPage />} />
            <Route path="scoreboard/*" element={<AdminScoreboardApp />} />
            <Route element={<AdminRequirePermission permission="admin.roles.manage" />}>
              <Route path="settings/roles" element={<AdminRolesPage />} />
            </Route>
            <Route element={<AdminRequirePermission permission="admin.users.manage" />}>
              <Route path="settings/users" element={<AdminUsersPage />} />
            </Route>
          </Route>
        </Route>
      </Routes>
      </AdminToastProvider>
    </AdminAuthProvider>
  );
}
