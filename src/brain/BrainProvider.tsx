import { useEffect, useState } from "react";
import { Brain } from "lucide-react";
import { getBrainDb, isTauriRuntime } from "./SqliteBrain";
import { ErrorBrainProvider } from "./ErrorBrain";
import { SpeedBrainProvider } from "./SpeedBrain";
import { CommandBrainProvider } from "./CommandBrain";

function BrainSplash() {
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="relative">
          <div className="absolute inset-0 animate-ping rounded-full bg-orange-500/30" />
          <div className="relative flex h-16 w-16 items-center justify-center rounded-full border-2 border-orange-500 bg-zinc-950">
            <Brain className="h-8 w-8 text-orange-400" />
          </div>
        </div>
        <div className="text-lg font-semibold text-orange-300">Mehtaji Engine Loading...</div>
        <div className="text-xs uppercase tracking-[0.2em] text-white/50">
          Initializing Native SQLite Brain Modules
        </div>
      </div>
    </div>
  );
}

export function BrainProvider({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isTauriRuntime()) {
        // Outside Tauri (web preview): skip SQLite init, render app directly.
        if (!cancelled) setIsReady(true);
        return;
      }
      try {
        await getBrainDb();
      } catch {
        // even on failure, allow app to render so user can see error toasts
      } finally {
        if (!cancelled) setIsReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!isReady) return <BrainSplash />;

  return (
    <ErrorBrainProvider>
      <SpeedBrainProvider>
        <CommandBrainProvider>{children}</CommandBrainProvider>
      </SpeedBrainProvider>
    </ErrorBrainProvider>
  );
}

export default BrainProvider;
