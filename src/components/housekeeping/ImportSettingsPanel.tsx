import { Settings2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import {
  DEFAULT_IMPORT_SETTINGS,
  type ImportSettings,
  type EncodingChoice,
} from "@/lib/tally-busy-import";

interface Props {
  value: ImportSettings;
  onChange: (next: ImportSettings) => void;
  disabled?: boolean;
}

const CHUNK_MIN = 100;
const CHUNK_MAX = 20000;
const PREVIEW_MIN = 25;
const PREVIEW_MAX = 5000;

export function ImportSettingsPanel({ value, onChange, disabled }: Props) {
  function set<K extends keyof ImportSettings>(k: K, v: ImportSettings[K]) {
    onChange({ ...value, [k]: v });
  }
  function clamp(n: number, min: number, max: number, fallback: number) {
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.round(n)));
  }
  return (
    <Accordion type="single" collapsible className="rounded-md border bg-muted/20">
      <AccordionItem value="settings" className="border-none">
        <AccordionTrigger className="px-3 py-2 text-sm hover:no-underline">
          <span className="flex items-center gap-2">
            <Settings2 className="h-4 w-4" /> Import settings
            <span className="text-xs text-muted-foreground">
              · preview {value.previewLimit} · chunk {value.chunkSize} · {value.encoding}
            </span>
          </span>
        </AccordionTrigger>
        <AccordionContent className="px-3 pb-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Preview row limit</Label>
              <Input
                type="number" min={PREVIEW_MIN} max={PREVIEW_MAX} step={25}
                value={value.previewLimit}
                disabled={disabled}
                onChange={(e) => set("previewLimit",
                  clamp(parseInt(e.target.value), PREVIEW_MIN, PREVIEW_MAX, DEFAULT_IMPORT_SETTINGS.previewLimit))}
              />
              <p className="text-[11px] text-muted-foreground">
                Max rows shown in preview tables. Higher = slower UI.
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Chunk size (records / batch)</Label>
              <Input
                type="number" min={CHUNK_MIN} max={CHUNK_MAX} step={100}
                value={value.chunkSize}
                disabled={disabled}
                onChange={(e) => set("chunkSize",
                  clamp(parseInt(e.target.value), CHUNK_MIN, CHUNK_MAX, DEFAULT_IMPORT_SETTINGS.chunkSize))}
              />
              <p className="text-[11px] text-muted-foreground">
                Records processed per UI yield. Lower = smoother, higher = faster.
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">File encoding</Label>
              <Select
                value={value.encoding}
                disabled={disabled}
                onValueChange={(v) => set("encoding", v as EncodingChoice)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto-detect (recommended)</SelectItem>
                  <SelectItem value="utf-8">Force UTF-8</SelectItem>
                  <SelectItem value="utf-16le">Force UTF-16 LE (Tally XML)</SelectItem>
                  <SelectItem value="utf-16be">Force UTF-16 BE</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Tally XML exports are usually UTF-16 LE.
              </p>
            </div>
            <div className="flex items-end justify-between gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Strip NUL bytes</Label>
                <p className="text-[11px] text-muted-foreground">
                  Removes stray <code>\\0</code> from misencoded files. Leave on.
                </p>
              </div>
              <Switch
                checked={value.stripNuls}
                disabled={disabled}
                onCheckedChange={(v) => set("stripNuls", v)}
              />
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <Button
              size="sm" variant="outline" disabled={disabled}
              onClick={() => onChange(DEFAULT_IMPORT_SETTINGS)}
            >
              <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reset to defaults
            </Button>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
