import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getChannel, setChannel, type ReleaseChannel } from "@/lib/rollout";

export function ReleaseChannelPicker() {
  const [channel, setChannelState] = useState<ReleaseChannel>(() => getChannel());

  function pick(next: ReleaseChannel) {
    if (next === channel) return;
    setChannel(next);
    setChannelState(next);
    toast.success(
      next === "beta"
        ? "Switched to Beta — you will get new features first."
        : "Switched to Stable — only released features from now on.",
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
        Current: <strong>{channel}</strong>
      </span>
    </div>
  );
}
