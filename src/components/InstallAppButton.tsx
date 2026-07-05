// Shows a small "Install app" button in the top bar when the browser fires
// the `beforeinstallprompt` event. Hidden if already installed (standalone
// display mode), inside an iframe (Lovable preview), or the user dismissed it
// this session.

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "pwa-install-dismissed-at";
const DISMISS_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function recentlyDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    return Date.now() - Number(raw) < DISMISS_MS;
  } catch {
    return false;
  }
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  // iOS Safari
  return (window.navigator as unknown as { standalone?: boolean }).standalone === true;
}

export function InstallAppButton() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.self !== window.top) return; // never in iframe/preview
    if (isStandalone()) return;
    if (recentlyDismissed()) return;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      setHidden(true);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (hidden || !deferred) return null;

  const onInstall = async () => {
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "dismissed") {
        try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* ignore */ }
      }
    } finally {
      setDeferred(null);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onInstall}
      className="gap-1.5"
      title="Install as a desktop / mobile app for offline use"
    >
      <Download className="h-3.5 w-3.5" />
      <span className="hidden sm:inline text-xs">Install app</span>
    </Button>
  );
}
