// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

const isTauri = Boolean(process.env.TAURI_ENV_PLATFORM || process.env.TAURI_PLATFORM);

// Shared production build tuning. Applied to both web and Tauri builds.
// NOTE: We intentionally do NOT manualChunk React or TanStack — they must stay
// with the SSR runtime chunk or hydration breaks. Only split heavy *optional*
// libs that are loaded on-demand (PDF/Excel/Word/chart exports).
const sharedBuild = {
  target: "es2020" as const,
  cssMinify: true as const,
  reportCompressedSize: false,
  chunkSizeWarningLimit: 1500,
  assetsInlineLimit: 4096,
  rollupOptions: {
    output: {
      manualChunks(id: string) {
        if (!id.includes("node_modules")) return;
        if (/[\\/]node_modules[\\/](jspdf|jspdf-autotable|pdf-lib)[\\/]/.test(id)) {
          return "exports-pdf";
        }
        if (/[\\/]node_modules[\\/](xlsx|exceljs)[\\/]/.test(id)) {
          return "exports-xlsx";
        }
        if (/[\\/]node_modules[\\/](docx|html-docx-js)[\\/]/.test(id)) {
          return "exports-docx";
        }
        if (/[\\/]node_modules[\\/](recharts|d3-[^/\\]+)[\\/]/.test(id)) {
          return "charts";
        }
      },
    },
  },
};

export default defineConfig(
  isTauri
    ? {
        vite: {
          base: "./",
          clearScreen: false,
          server: {
            port: 1420,
            strictPort: true,
            host: process.env.TAURI_DEV_HOST || "localhost",
            hmr: process.env.TAURI_DEV_HOST
              ? { protocol: "ws", host: process.env.TAURI_DEV_HOST, port: 1421 }
              : undefined,
            watch: {
              ignored: ["**/src-tauri/**"],
            },
          },
          envPrefix: ["VITE_", "TAURI_ENV_"],
          build: sharedBuild,
        },
      }
    : {
        vite: {
          build: sharedBuild,
        },
      },
);
