import { Route, Routes } from "react-router-dom";
import { AdminAuthProvider } from "./AdminAuthContext";
import { AdminRequireAuth } from "./AdminRequireAuth";
import { AdminLayout } from "./AdminLayout";
import { AdminLoginPage } from "./pages/AdminLoginPage";
import { AdminBlogEditPage } from "./pages/AdminBlogEditPage";
import { AdminBlogListPage } from "./pages/AdminBlogListPage";
import { AdminAcademiesPage } from "./pages/AdminAcademiesPage";
import { AdminCalibrationPage } from "./pages/AdminCalibrationPage";
import { AdminContentPage } from "./pages/AdminContentPage";
import { AdminDashboardPage } from "./pages/AdminDashboardPage";
import { AdminHomepagePage } from "./pages/AdminHomepagePage";
import { AdminInboxPage } from "./pages/AdminInboxPage";
import { AdminPlayersPage } from "./pages/AdminPlayersPage";

export function AdminApp() {
  return (
    <AdminAuthProvider>
      <Routes>
        <Route path="login" element={<AdminLoginPage />} />
        <Route element={<AdminRequireAuth />}>
          <Route element={<AdminLayout />}>
            <Route index element={<AdminDashboardPage />} />
            <Route path="inbox" element={<AdminInboxPage />} />
            <Route path="players" element={<AdminPlayersPage />} />
            <Route path="calibration" element={<AdminCalibrationPage />} />
            <Route path="homepage" element={<AdminHomepagePage />} />
            <Route path="academies" element={<AdminAcademiesPage />} />
            <Route path="content" element={<AdminContentPage />} />
            <Route path="blog" element={<AdminBlogListPage />} />
            <Route path="blog/new" element={<AdminBlogEditPage />} />
            <Route path="blog/:id" element={<AdminBlogEditPage />} />
          </Route>
        </Route>
      </Routes>
    </AdminAuthProvider>
  );
}
