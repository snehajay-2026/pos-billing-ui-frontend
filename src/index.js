import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import reportWebVitals from "./reportWebVitals";
import "bootstrap/dist/css/bootstrap.min.css";
import { UiProvider } from "./context/UiContext";
import { DataProvider } from "./context/DataContext";
import AppErrorBoundary from "./components/common/AppErrorBoundary";

const root = ReactDOM.createRoot(document.getElementById("root"));

root.render(
  <React.StrictMode>
    {/* Outer boundary: catches anything thrown above the route-level
        boundary (providers, theme listener, etc). Without this, a startup
        error would white-screen the entire app. */}
    <AppErrorBoundary>
      <UiProvider>
        <DataProvider>
          <App />
        </DataProvider>
      </UiProvider>
    </AppErrorBoundary>
  </React.StrictMode>
);

reportWebVitals();
