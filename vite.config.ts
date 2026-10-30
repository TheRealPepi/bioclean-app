import basicSsl from "@vitejs/plugin-basic-ssl";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// `npm run dev:https` serves over HTTPS on the local network so drivers' phones
// can use the camera and GPS while testing (browsers require a secure context).
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    ...(mode === "https" ? [basicSsl()] : []),
    // Installable app whose files are cached on the phone, so it opens without
    // signal. Data sync is handled by the outbox (src/lib/outbox.ts), not here.
    VitePWA({
      registerType: "autoUpdate",
      // The icons in public/ are already matched by `globPatterns`.
      includeManifestIcons: false,
      manifest: {
        name: "Bioclean Green Cozumel · Entregas",
        short_name: "Bioclean",
        description: "Registro de entregas de los choferes.",
        lang: "es",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        theme_color: "#0e5a4a",
        background_color: "#ffffff",
        icons: [
          { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "maskable-icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        // Spanish only needs the Latin font files.
        globIgnores: ["**/inter-{cyrillic,cyrillic-ext,greek,greek-ext,vietnamese}-*.woff2"],
        navigateFallback: "index.html",
        cleanupOutdatedCaches: true,
        // The PDF library chunk is large; it must be cached too.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
    }),
  ],
}));
