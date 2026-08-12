const APP_SW_PATH = "/sw.js";

function isPreviewHost(hostname: string): boolean {
  return (
    hostname.startsWith("id-preview--") ||
    hostname.startsWith("preview--") ||
    hostname === "lovableproject.com" ||
    hostname.endsWith(".lovableproject.com") ||
    hostname === "lovableproject-dev.com" ||
    hostname.endsWith(".lovableproject-dev.com") ||
    hostname === "beta.lovable.dev" ||
    hostname.endsWith(".beta.lovable.dev")
  );
}

function shouldRegisterAppShellCache(): boolean {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return false;
  if (!import.meta.env.PROD) return false;
  if (import.meta.env.TAURI_ENV_PLATFORM) return false;
  if (window.self !== window.top) return false;
  if (isPreviewHost(window.location.hostname)) return false;
  if (new URLSearchParams(window.location.search).get("sw") === "off") return false;
  return true;
}

async function unregisterAppShellCache(): Promise<void> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.allSettled(
      registrations
        .filter((registration) => {
          const script = registration.active?.scriptURL || registration.installing?.scriptURL || registration.waiting?.scriptURL || "";
          return script.endsWith(APP_SW_PATH) || registration.scope === `${window.location.origin}/`;
        })
        .map((registration) => registration.unregister()),
    );
  } catch {
    /* best-effort cleanup */
  }
}

export function setupAppShellCache(): void {
  if (!shouldRegisterAppShellCache()) {
    void unregisterAppShellCache();
    return;
  }

  void navigator.serviceWorker.register(APP_SW_PATH).catch(() => {
    /* registration is optional; app must still run online */
  });
}