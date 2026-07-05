// Stub for `virtual:pwa-register` used in Tauri builds where vite-plugin-pwa
// is not loaded. Provides a no-op registerSW so imports resolve.
export function registerSW(_opts?: unknown): () => Promise<void> {
  return async () => {};
}
