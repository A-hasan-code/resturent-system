import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AuthProvider } from "./auth";
import { BrandProvider } from "./brand";
import { I18nProvider } from "./i18n";
import { ToastProvider } from "./toast";
import { ConfirmProvider } from "./components/ConfirmModal";
import { ConnectionOverlay } from "./components/ConnectionOverlay";
import { initConnection } from "./server";
import { isNative } from "./native";
import "@fontsource/outfit/400.css";
import "@fontsource/outfit/500.css";
import "@fontsource/outfit/600.css";
import "@fontsource/outfit/700.css";
import "@fontsource/source-serif-4/600.css";
import "@fontsource/source-serif-4/700.css";
import "./styles.css";

void initConnection();

// The Android app ships its own copy of the UI; a service worker there would only serve stale files.
if ("serviceWorker" in navigator && import.meta.env.PROD && window.isSecureContext && !isNative) {
  import("virtual:pwa-register").then(({ registerSW }) => registerSW({ immediate: true })).catch(() => undefined);
}

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <I18nProvider>
      <ToastProvider>
        <ConfirmProvider>
          <BrandProvider>
            <AuthProvider>
              <App />
            </AuthProvider>
            <ConnectionOverlay />
          </BrandProvider>
        </ConfirmProvider>
      </ToastProvider>
    </I18nProvider>
  </BrowserRouter>
);
