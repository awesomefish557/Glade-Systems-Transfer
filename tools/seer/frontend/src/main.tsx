import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { SeerSettingsProvider } from "./settingsContext";
import "./app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SeerSettingsProvider>
      <App />
    </SeerSettingsProvider>
  </StrictMode>
);
