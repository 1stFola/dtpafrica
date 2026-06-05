import { Route, Routes } from "react-router-dom";
import { ScoutingLayout } from "./ScoutingLayout";
import { ComparePage } from "./pages/ComparePage";
import { PhilosophyFitPage } from "./pages/PhilosophyFitPage";
import { ScoutingHubPage } from "./pages/ScoutingHubPage";
import { StrongXiPage } from "./pages/StrongXiPage";
import { TacticalSearchPage } from "./pages/TacticalSearchPage";

export function ScoutingApp() {
  return (
    <Routes>
      <Route element={<ScoutingLayout />}>
        <Route index element={<ScoutingHubPage />} />
        <Route path="strong-xi" element={<StrongXiPage />} />
        <Route path="philosophy" element={<PhilosophyFitPage />} />
        <Route path="search" element={<TacticalSearchPage />} />
        <Route path="compare" element={<ComparePage />} />
      </Route>
    </Routes>
  );
}
