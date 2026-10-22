import { Route, Routes } from "react-router-dom";
import { AdminAuthProvider } from "./AdminAuthContext";
import { AdminRequireAuth } from "./AdminRequireAuth";
import { AdminRequirePermission } from "./AdminRequirePermission";
import { AdminVisionCalibrationPage } from "./vision/AdminVisionCalibrationPage";
import { AdminVisionIdentityPage } from "./vision/AdminVisionIdentityPage";
import { AdminVisionTaskPage } from "./vision/AdminVisionTaskPage";
import { ANNOTATION_SCREEN_PERMISSIONS } from "./vision/annotation-access";

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
 * A task opens for `vision.annotate` or `vision.review`, not `vision.read`: it is where
 * labels are submitted and where a second person approves them, and someone who may only
 * read the catalogue has no business doing either. The page shows each person only the
 * controls their own permission allows.
 *
 * The identity review screen sits here too, under `vision.review`: it names
 * children on footage, and the API refuses everyone but a signed-in reviewer.
 */
export function VisionWorkstationApp() {
  return (
    <AdminAuthProvider>
      <Routes>
        <Route element={<AdminRequireAuth />}>
          <Route element={<AdminRequirePermission permission="vision.review" />}>
            <Route path="identity/:assetId" element={<AdminVisionIdentityPage />} />
            <Route path="calibration/:assetId" element={<AdminVisionCalibrationPage />} />
          </Route>
          <Route element={<AdminRequirePermission permission={ANNOTATION_SCREEN_PERMISSIONS} />}>
            <Route path=":taskId" element={<AdminVisionTaskPage />} />
          </Route>
        </Route>
      </Routes>
    </AdminAuthProvider>
  );
}
