import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "ContextIDE",
        short_name: "ContextIDE",
        description: "A writing desk for context engineering",
        theme_color: "#f4efe6",
        background_color: "#f4efe6",
        display: "standalone",
        icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
      },
      workbox: { globPatterns: ["**/*.{js,css,html,svg,woff2}"], maximumFileSizeToCacheInBytes: 8 * 1024 * 1024 },
    }),
  ],
  worker: { format: "es" },
  test: { include: ["src/**/*.test.ts"] },
});
