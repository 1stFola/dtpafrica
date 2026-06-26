import { Route, Routes } from "react-router-dom";
import { ScoutingLayout } from "./ScoutingLayout";
import { ComparePage } from "./pages/ComparePage";
import { GeneratePage } from "./pages/GeneratePage";
import { ScoutingHubPage } from "./pages/ScoutingHubPage";
import { StrongXiPage } from "./pages/StrongXiPage";
import { ValuationReportPage } from "./pages/ValuationReportPage";

export function ScoutingApp() {
  return (
    <Routes>
      <Route element={<ScoutingLayout />}>
        <Route index element={<ScoutingHubPage />} />
        <Route path="strong-xi" element={<StrongXiPage />} />
        <Route path="compare" element={<ComparePage />} />
        <Route path="generate" element={<GeneratePage />} />
        <Route path="valuation/:playerId" element={<ValuationReportPage />} />
      </Route>
    </Routes>
  );
}
