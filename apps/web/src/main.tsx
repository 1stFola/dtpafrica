import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { RootErrorBoundary } from "./components/RootErrorBoundary";
import { AdConfigProvider } from "./context/AdConfigContext";
import "./styles/global.css";
// Figma sync layer — loaded last so redesigned public surfaces win over
// the legacy stylesheet without touching the dark internal modules.
import "./styles/figma-tokens.css";
import "./styles/dtp-figma.css";
/* Admin fixtures calendar. Loaded last so its scoped .afx-* rules win over the
   generic .admin-page styles in global.css. */
import "./styles/admin-fixtures.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <BrowserRouter>
        <AdConfigProvider>
          <App />
        </AdConfigProvider>
      </BrowserRouter>
    </RootErrorBoundary>
  </React.StrictMode>
);
