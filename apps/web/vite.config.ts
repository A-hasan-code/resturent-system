import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// A production build opened on localhost leaves a service worker that keeps serving the old
// bundle once the dev server takes over the same origin. In dev, /sw.js removes it and reloads.
const SW_KILL_SWITCH = `
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await self.registration.unregister();
    for (const key of await caches.keys()) await caches.delete(key);
    for (const client of await self.clients.matchAll({ type: "window" })) client.navigate(client.url);
  })());
});
`;

function devServiceWorkerKillSwitch(): Plugin {
  return {
    name: "dev-service-worker-kill-switch",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/sw.js", (_req, res) => {
        res.setHeader("Content-Type", "application/javascript");
        res.setHeader("Cache-Control", "no-store");
        res.end(SW_KILL_SWITCH);
      });
    },
  };
}

export default defineConfig({
  plugins: [
    devServiceWorkerKillSwitch(),
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      includeAssets: ["icons/icon-192.png", "icons/icon-512.png", "login-hero.jpg"],
      manifest: {
        name: "Hotel System POS",
        short_name: "Hotel POS",
        description: "Offline restaurant POS — orders, kitchen, billing",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "any",
        background_color: "#101820",
        theme_color: "#0f7a6c",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api/, /^\/socket\.io/, /^\/downloads/, /^\/branding/],
        globPatterns: ["**/*.{js,css,html,png,jpg,svg,woff2}"],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  server: {
    port: 3000,
    host: true,
    proxy: {
      "/api": { target: "http://localhost:4000", changeOrigin: true },
      "/socket.io": { target: "http://localhost:4000", ws: true, changeOrigin: true },
      "/downloads": { target: "http://localhost:4000", changeOrigin: true },
      "/branding": { target: "http://localhost:4000", changeOrigin: true },
    },
  },
});
