import { useEffect } from "react";
import { getBrainDb, isTauriRuntime } from "./SqliteBrain";
import { ErrorBrainProvider } from "./ErrorBrain";
import { SpeedBrainProvider } from "./SpeedBrain";
import { CommandBrainProvider } from "./CommandBrain";

export function BrainProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isTauriRuntime()) {
        return;
      }
      try {
        await getBrainDb();
      } catch (error) {
        if (!cancelled) console.error("Mehtaji local brain init failed:", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ErrorBrainProvider>
      <SpeedBrainProvider>
        <CommandBrainProvider>{children}</CommandBrainProvider>
      </SpeedBrainProvider>
    </ErrorBrainProvider>
  );
}

export default BrainProvider;
