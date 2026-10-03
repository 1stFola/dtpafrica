import { Navigate, Route, Routes } from "react-router-dom";
import { AdminRequirePermission } from "../AdminRequirePermission";
import { AdminVisionAnnotationPage } from "./AdminVisionAnnotationPage";
import { AdminVisionDatasetsPage } from "./AdminVisionDatasetsPage";
import { AdminVisionEventsPage } from "./AdminVisionEventsPage";
import { AdminVisionFootagePage } from "./AdminVisionFootagePage";
import { AdminVisionLayout } from "./AdminVisionLayout";
import { AdminVisionModelsPage } from "./AdminVisionModelsPage";
import { AdminVisionOverviewPage } from "./AdminVisionOverviewPage";
import { AdminVisionPipelinePage } from "./AdminVisionPipelinePage";
import { AdminVisionSourceDetailPage } from "./AdminVisionSourceDetailPage";
import { AdminVisionSourcesPage } from "./AdminVisionSourcesPage";

/** The Vision environment's routes, under `/admin/vision`. `vision.read` is checked by the admin app before this mounts. */
export function AdminVisionApp() {
  return (
    <Routes>
      <Route element={<AdminVisionLayout />}>
        <Route index element={<AdminVisionOverviewPage />} />
        <Route path="sources" element={<AdminVisionSourcesPage />} />
        <Route path="sources/:id" element={<AdminVisionSourceDetailPage />} />
        <Route path="footage" element={<AdminVisionFootagePage />} />
        <Route path="pipeline" element={<AdminVisionPipelinePage />} />
        {/* Claiming and labelling need `vision.annotate`; the workstation itself mounts outside the shell (App.tsx). */}
        <Route element={<AdminRequirePermission permission="vision.annotate" />}>
          <Route path="annotation" element={<AdminVisionAnnotationPage />} />
        </Route>
        <Route path="datasets" element={<AdminVisionDatasetsPage />} />
        <Route path="models" element={<AdminVisionModelsPage />} />
        <Route path="events" element={<AdminVisionEventsPage />} />
        <Route path="*" element={<Navigate to="/admin/vision" replace />} />
      </Route>
    </Routes>
  );
}
