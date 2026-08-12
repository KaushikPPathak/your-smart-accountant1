import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getChannel, setChannel, type ReleaseChannel } from "@/lib/rollout";

export function ReleaseChannelPicker() {
  const [channel, setChannelState] = useState<ReleaseChannel>(() => getChannel());
  const [installedVersion, setInstalledVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    void import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then(setInstalledVersion)
      .catch(() => setInstalledVersion(import.meta.env.VITE_APP_VERSION || null));
  }, []);

  function pick(next: ReleaseChannel) {
    if (next === channel) return;
    setChannel(next);
    setChannelState(next);
    toast.success(
      next === "beta"
        ? "Beta features enabled for this installation."
        : "Stable features enabled for this installation.",
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant={channel === "stable" ? "default" : "outline"}
        onClick={() => pick("stable")}
      >
        Stable
      </Button>
      <Button
        size="sm"
        variant={channel === "beta" ? "default" : "outline"}
        onClick={() => pick("beta")}
      >
        Beta
      </Button>
      <span className="ml-2 text-xs text-muted-foreground">
        Channel: <strong>{channel}</strong>
        {installedVersion ? <> · Installed: <strong>v{installedVersion}</strong></> : null}
      </span>
    </div>
  );
}
