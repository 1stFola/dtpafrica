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
import { AdminContentPage } from "./pages/AdminContentPage";
import { AdminDashboardPage } from "./pages/AdminDashboardPage";
import { AdminDatabasePage } from "./pages/AdminDatabasePage";
import { AdminAdsPage } from "./pages/AdminAdsPage";
import { AdminHomepagePage } from "./pages/AdminHomepagePage";
import { AdminHomeVideoHighlightsPage } from "./pages/AdminHomeVideoHighlightsPage";
import { AdminInboxPage } from "./pages/AdminInboxPage";
import { AdminPlayersPage } from "./pages/AdminPlayersPage";
import { AdminScoreboardApp } from "./scoreboard/AdminScoreboardApp";
import { AdminRequirePermission } from "./AdminRequirePermission";
import { AdminRolesPage } from "./settings/AdminRolesPage";
import { AdminUsersPage } from "./settings/AdminUsersPage";

export function AdminApp() {
  return (
    <AdminAuthProvider>
      <AdminToastProvider>
        <Routes>
        <Route path="login" element={<AdminLoginPage />} />
        <Route element={<AdminRequireAuth />}>
          <Route element={<AdminLayout />}>
            <Route index element={<AdminDashboardPage />} />
            <Route path="inbox" element={<AdminInboxPage />} />
            <Route path="players" element={<AdminPlayersPage />} />
            <Route path="calibration" element={<AdminCalibrationPage />} />
            <Route path="homepage" element={<AdminHomepagePage />} />
            <Route path="homepage/video-highlights" element={<AdminHomeVideoHighlightsPage />} />
            <Route path="ads" element={<AdminAdsPage />} />
            <Route path="academies" element={<AdminAcademiesPage />} />
            <Route path="content" element={<AdminContentPage />} />
            <Route path="database" element={<AdminDatabasePage />} />
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
