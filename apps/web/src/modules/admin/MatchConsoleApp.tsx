import { Route, Routes } from "react-router-dom";
import { AdminAuthProvider } from "./AdminAuthContext";
import { AdminRequireAuth } from "./AdminRequireAuth";
import { AdminMatchStatsConsolePage } from "./pages/AdminMatchStatsConsolePage";

/**
 * The recorder console, mounted outside the marketing AppShell.
 *
 * The site header is sticky and would sit on top of the console's own frozen
 * panel, stealing space that pitch-side entry needs. Mounting here keeps the
 * /admin/match-stats/:matchId URL while giving the console the whole viewport.
 */
export function MatchConsoleApp() {
  return (
    <AdminAuthProvider>
      <Routes>
        <Route element={<AdminRequireAuth />}>
          <Route path="*" element={<AdminMatchStatsConsolePage />} />
        </Route>
      </Routes>
    </AdminAuthProvider>
  );
}
