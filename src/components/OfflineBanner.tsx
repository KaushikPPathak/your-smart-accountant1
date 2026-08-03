// Global connectivity banner.
//
// Store certification requires the app to degrade gracefully with zero
// connectivity. The app is offline-first, so this is purely informational:
// it tells the user that online-only extras (sign-in, cloud backup, portal
// lookups) are paused, and confirms when the connection returns.

import { useEffect, useRef, useState } from "react";
import { WifiOff } from "lucide-react";
import { toast } from "sonner";
import { useOnlineStatus } from "@/lib/offline/online-status";

export function OfflineBanner() {
  const online = useOnlineStatus();
  const wasOffline = useRef(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!online) {
      wasOffline.current = true;
      setVisible(true);
      return;
    }
    setVisible(false);
    if (wasOffline.current) {
      wasOffline.current = false;
      try {
        toast.success("Back online", {
          description: "Sign-in and cloud features are available again.",
        });
      } catch {
        /* toast host not mounted yet — safe to ignore */
      }
    }
  }, [online]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="print:hidden flex items-center justify-center gap-2 bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-300"
    >
      <WifiOff className="h-3.5 w-3.5" aria-hidden />
      <span>
        You are offline. All accounting work continues normally — only online extras (sign-in,
        cloud backup, portal lookups) are paused.
      </span>
    </div>
  );
}
