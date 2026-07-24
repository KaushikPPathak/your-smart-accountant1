import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { readFileSync } from "node:fs";

const isTauri = Boolean(process.env.TAURI_ENV_PLATFORM || process.env.TAURI_PLATFORM);
const desktopVersion = isTauri
  ? String(JSON.parse(readFileSync(new URL("./src-tauri/tauri.conf.json", import.meta.url), "utf8")).version)
  : null;

const pwaPlugins = isTauri
  ? []
  : [
      (await import("vite-plugin-pwa")).VitePWA({
        registerType: "autoUpdate",
        injectRegister: null,
        filename: "sw.js",
        devOptions: { enabled: false },
        manifest: {
          name: "Smart Accountant",
          short_name: "SmartAcc",
          display: "standalone",
          start_url: "/",
          scope: "/",
          theme_color: "#0b1e3f",
          background_color: "#0b1e3f",
          description: "GST-ready offline accounting for Indian businesses. Works on any computer, no internet required.",
          icons: [
            { src: "/pwa-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "/pwa-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            { src: "/pwa-icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
            { src: "/pwa-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }
          ]
        },
        workbox: {
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          navigateFallback: "/index.html",
          navigateFallbackDenylist: [/^\/~oauth/],
          globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
          globIgnores: ["**/webllm-*.js"],
          maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
          runtimeCaching: [
            {
              urlPattern: ({ request }) => request.mode === "navigate",
              handler: "NetworkFirst",
              options: {
                cacheName: "app-html",
                networkTimeoutSeconds: 2,
                expiration: { maxEntries: 8, maxAgeSeconds: 7 * 24 * 60 * 60 },
              },
            },
            {
              urlPattern: ({ url, request }) => url.origin === self.location.origin && ["script", "style", "worker"].includes(request.destination),
              handler: "StaleWhileRevalidate",
              options: {
                cacheName: "app-assets",
                expiration: { maxEntries: 80, maxAgeSeconds: 30 * 24 * 60 * 60 },
              },
            },
          ],
        }
      })
    ];

const sharedBuild = {
  target: "es2020" as const,
  cssMinify: true as const,
  reportCompressedSize: false,
  chunkSizeWarningLimit: 7000,
  assetsInlineLimit: 4096,
  rollupOptions: {
    output: {
      manualChunks(id: string) {
        if (!id.includes("node_modules")) return;
        if (/[\\/]node_modules[\\/](jspdf|jspdf-autotable|pdf-lib)[\\/]/.test(id)) return "exports-pdf";
        if (/[\\/]node_modules[\\/](xlsx|exceljs)[\\/]/.test(id)) return "exports-xlsx";
        if (/[\\/]node_modules[\\/](docx|html-docx-js)[\\/]/.test(id)) return "exports-docx";
        if (/[\\/]node_modules[\\/](recharts|d3-[^/\\]+)[\\/]/.test(id)) return "charts";
        if (/[\\/]node_modules[\\/]@mlc-ai[\\/]/.test(id)) return "webllm";
        if (/[\\/]node_modules[\\/](tesseract\.js|pdfjs-dist)[\\/]/.test(id)) return "ocr";
      },
    },
  },
};

export default defineConfig({
  base: isTauri ? "./" : "/",
  // Keep the frontend's update-safety marker identical to the native bundle
  // version stamped by CI. Previously every desktop build reported 0.0.0.
  define: desktopVersion
    ? { "import.meta.env.VITE_APP_VERSION": JSON.stringify(desktopVersion) }
    : undefined,
  clearScreen: false,
  envPrefix: ["VITE_", "TAURI_ENV_"],
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    ...pwaPlugins,
    tsconfigPaths(),
  ],

  server: isTauri
    ? {
        port: 1420,
        strictPort: true,
        host: process.env.TAURI_DEV_HOST || "localhost",
        hmr: process.env.TAURI_DEV_HOST
          ? { protocol: "ws", host: process.env.TAURI_DEV_HOST, port: 1421 }
          : undefined,
        watch: { ignored: ["**/src-tauri/**"] },
      }
    : { host: "::", port: 8080 },
  worker: { format: "es" },
  build: {
    ...sharedBuild,
    outDir: isTauri ? "dist/client" : "dist",
    emptyOutDir: true,
  },
});
