import { defineConfig } from "@vite-pwa/assets-generator/config";

// Generates the PWA / home-screen icons from public/app-icon.svg:
//   npx pwa-assets-generator
const background = "#0e5a4a";

export default defineConfig({
  headLinkOptions: { preset: "2023" },
  preset: {
    transparent: { sizes: [64, 192, 512], favicons: [[48, "favicon.ico"]], padding: 0 },
    maskable: { sizes: [512], padding: 0.3, resizeOptions: { background } },
    apple: { sizes: [180], padding: 0.3, resizeOptions: { background } },
  },
  images: ["public/app-icon.svg"],
});
