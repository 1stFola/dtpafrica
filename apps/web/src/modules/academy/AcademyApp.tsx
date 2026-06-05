import { Route, Routes } from "react-router-dom";
import { AcademyAuthProvider } from "./AcademyAuthContext";
import { AcademyDashboardApp } from "./AcademyDashboardApp";
import { RequireAcademyAuth } from "./RequireAcademyAuth";
import { AcademyClubDirectoryPage } from "./pages/AcademyClubDirectoryPage";
import { AcademyLoginPage } from "./pages/AcademyLoginPage";

export function AcademyApp() {
  return (
    <AcademyAuthProvider>
      <Routes>
        <Route path="login" element={<AcademyLoginPage />} />
        <Route path=":slug/dashboard/*" element={<AcademyDashboardApp />} />
        <Route element={<RequireAcademyAuth />}>
          <Route index element={<AcademyClubDirectoryPage />} />
        </Route>
      </Routes>
    </AcademyAuthProvider>
  );
}
