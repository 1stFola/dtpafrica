import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { RootErrorBoundary } from "./components/RootErrorBoundary";
import { AdConfigProvider } from "./context/AdConfigContext";
import "./styles/global.css";

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
