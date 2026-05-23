// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Tauri exposes the desktop build via the TAURI_ENV_* variables (Tauri v2)
// or TAURI_PLATFORM (Tauri v1) during `tauri dev` / `tauri build`. When that
// env is present we tighten a few defaults so the Vite dev server cooperates
// with the Tauri watch loop:
//   - relative asset base (Tauri loads index.html via the tauri:// scheme,
//     absolute "/" paths break asset resolution exactly like in Electron)
//   - fixed dev port (1420) with strictPort so Tauri's webview can attach
//   - don't clear the terminal (Tauri prints its own status above Vite)
//   - HMR over the same port so reloads work inside the native webview
const isTauri = Boolean(process.env.TAURI_ENV_PLATFORM || process.env.TAURI_PLATFORM);

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
              // Tauri owns the src-tauri/ folder — avoid Vite restarting on
              // Rust file changes.
              ignored: ["**/src-tauri/**"],
            },
          },
          envPrefix: ["VITE_", "TAURI_ENV_"],
        },
      }
    : {},
);
