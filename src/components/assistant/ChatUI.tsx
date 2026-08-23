import { Bot, BrainCircuit, Trash2, Volume2, VolumeX, Cpu, Zap, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ModelPreference } from "@/lib/ai/model-preference";

interface ChatHeaderProps {
  ttsOn: boolean;
  onToggleTts: () => void;
  modelPref: ModelPreference;
  onClearChat: () => void;
}

export function ChatHeader({ ttsOn, onToggleTts, modelPref, onClearChat }: ChatHeaderProps) {
  return (
    <div className="flex items-center justify-between border-b px-4 py-3">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
          <BrainCircuit className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-sm font-semibold leading-none">Mehtaji</h2>
          <p className="text-[10px] text-muted-foreground">Local-first Accounting Intelligence</p>
        </div>
      </div>
      
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className={cn("h-8 w-8", ttsOn && "text-primary bg-primary/10")}
          onClick={onToggleTts}
          title={ttsOn ? "Mute Voice" : "Enable Voice"}
        >
          {ttsOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
        </Button>
        
        <div className="flex items-center gap-1 rounded-md border bg-muted/50 px-2 py-1">
          <Cpu className="h-3 w-3 text-muted-foreground" />
          <span className="text-[10px] font-medium text-muted-foreground">
            {modelPref === "local" ? "Device" : modelPref === "cloud" ? "Cloud" : "Auto"}
          </span>
        </div>
        
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          onClick={onClearChat}
          title="Clear Chat"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export function ChatFooterMetadata() {
  return (
    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1">
          <Zap className="h-3 w-3 text-amber-500" />
          Local Compute Only
        </span>
        <span className="flex items-center gap-1">
          <Check className="h-3 w-3 text-emerald-500" />
          Zero Data Tracking
        </span>
      </div>
    </div>
  );
}
