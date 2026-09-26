import { Route, Routes } from "react-router-dom";
import { AdminAuthProvider } from "./AdminAuthContext";
import { AdminRequireAuth } from "./AdminRequireAuth";
import { AdminRequirePermission } from "./AdminRequirePermission";
import { AdminVisionTaskPage } from "./vision/AdminVisionTaskPage";

/**
 * The annotation workstation, mounted outside the marketing AppShell.
 *
 * Same reason as the recorder console: a frame-accurate video tool needs the whole
 * viewport, and a sticky site header steals the vertical space and the keyboard focus
 * that review depends on.
 *
 * **This wrapper is not optional.** Mounting the page directly on a top-level route
 * puts it outside `AdminAuthProvider`, which means no session, no guard, and no
 * permission check — a screen that presents youth footage would be reachable by
 * anyone who knew the URL. It carries its own auth stack for exactly the reason
 * `MatchConsoleApp` does.
 *
 * `vision.annotate` rather than `vision.read`: this screen claims work and submits
 * labels, and someone who may only read the catalogue has no business doing either.
 */
export function VisionWorkstationApp() {
  return (
    <AdminAuthProvider>
      <Routes>
        <Route element={<AdminRequireAuth />}>
          <Route element={<AdminRequirePermission permission="vision.annotate" />}>
            <Route path=":taskId" element={<AdminVisionTaskPage />} />
          </Route>
        </Route>
      </Routes>
    </AdminAuthProvider>
  );
}
