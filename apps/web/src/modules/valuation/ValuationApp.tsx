import { Route, Routes } from "react-router-dom";
import { ValuationLayout } from "./ValuationLayout";
import { CompareValuationPage } from "./pages/CompareValuationPage";
import { GenerateValuationPage } from "./pages/GenerateValuationPage";
import { ValuationDashboardPage } from "./pages/ValuationDashboardPage";
import { ValuationHubPage } from "./pages/ValuationHubPage";

export function ValuationApp() {
  return (
    <Routes>
      <Route element={<ValuationLayout />}>
        <Route index element={<ValuationHubPage />} />
        <Route path="generate" element={<GenerateValuationPage />} />
        <Route path="player/:playerId" element={<ValuationDashboardPage />} />
        <Route path="compare" element={<CompareValuationPage />} />
      </Route>
    </Routes>
  );
}
