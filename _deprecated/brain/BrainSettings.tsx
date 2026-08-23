import { useCallback, useEffect, useState } from "react";
import { Download, Trash2, RefreshCcw, Brain } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { isTauriRuntime, safeBrainExec, safeBrainSelect } from "./SqliteBrain";

type Language = "en" | "hi" | "hinglish";
type CacheMode = "light" | "normal" | "aggressive";

interface BrainSettingsState {
  language: Language;
  autoRetry: boolean;
  cacheMode: CacheMode;
  soundOn: boolean;
}

interface SettingRow {
  setting_key: string;
  setting_value: string;
}

interface ErrorLogRow {
  id: number;
  timestamp: string;
  error_code: string;
  error_message: string;
  component: string;
  action_attempted: string;
  auto_fixed: number;
  fix_applied: string;
}

const DEFAULTS: BrainSettingsState = {
  language: "hinglish",
  autoRetry: true,
  cacheMode: "normal",
  soundOn: false,
};

async function saveSetting(key: string, value: string) {
  await safeBrainExec(
    `INSERT INTO brain_settings (setting_key, setting_value) VALUES ($1, $2)
     ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`,
    [key, value],
  );
}

function toCsv(rows: ErrorLogRow[]): string {
  const head = ["id", "timestamp", "error_code", "error_message", "component", "action_attempted", "auto_fixed", "fix_applied"];
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [head.join(","), ...rows.map((r) => head.map((h) => esc((r as unknown as Record<string, unknown>)[h])).join(","))].join("\n");
}

export function BrainSettings() {
  const [settings, setSettings] = useState<BrainSettingsState>(DEFAULTS);
  const [logs, setLogs] = useState<ErrorLogRow[]>([]);
  const [loading, setLoading] = useState(false);

  const loadAll = useCallback(async () => {
    if (!isTauriRuntime()) return;
    setLoading(true);
    const [rows, logRows] = await Promise.all([
      safeBrainSelect<SettingRow>(`SELECT setting_key, setting_value FROM brain_settings`),
      safeBrainSelect<ErrorLogRow>(`SELECT * FROM brain_error_log ORDER BY timestamp DESC LIMIT 100`),
    ]);
    const next = { ...DEFAULTS };
    for (const r of rows) {
      if (r.setting_key === "language") next.language = r.setting_value as Language;
      else if (r.setting_key === "autoRetry") next.autoRetry = r.setting_value === "1";
      else if (r.setting_key === "cacheMode") next.cacheMode = r.setting_value as CacheMode;
      else if (r.setting_key === "soundOn") next.soundOn = r.setting_value === "1";
    }
    setSettings(next);
    setLogs(logRows);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const update = useCallback(async <K extends keyof BrainSettingsState>(key: K, value: BrainSettingsState[K]) => {
    setSettings((s) => ({ ...s, [key]: value }));
    const serialized = typeof value === "boolean" ? (value ? "1" : "0") : String(value);
    await saveSetting(key, serialized);
    toast.success("Setting saved");
  }, []);

  const exportCsv = useCallback(async () => {
    const csv = toCsv(logs);
    const fileName = `brain-log-${new Date().toISOString().slice(0, 10)}.csv`;
    if (isTauriRuntime()) {
      try {
        const mod = await import("@/lib/native-bridge");
        const res = await mod.saveWithPickerNative(fileName, csv, [
          { name: "CSV", extensions: ["csv"] },
        ]);
        if (res.ok) {
          toast.success("Log exported", { description: res.path });
          return;
        }
      } catch {
        // fall through to download
      }
    }
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Log downloaded");
  }, [logs]);

  const clearOldLogs = useCallback(async () => {
    const res = await safeBrainExec(`DELETE FROM brain_error_log WHERE timestamp < date('now', '-30 days')`);
    if (res.ok) {
      toast.success("Old logs cleared (>30 days)");
      void loadAll();
    } else {
      toast.error(res.error ?? "Failed to clear logs");
    }
  }, [loadAll]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Brain className="h-5 w-5 text-orange-500" />
        <h2 className="text-lg font-semibold">Mehtaji Brain</h2>
      </div>

      <div className="grid gap-4 rounded-lg border bg-card p-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Interface Language</Label>
          <Select value={settings.language} onValueChange={(v) => void update("language", v as Language)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="hi">हिन्दी</SelectItem>
              <SelectItem value="hinglish">Hinglish</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Cache Mode</Label>
          <Select value={settings.cacheMode} onValueChange={(v) => void update("cacheMode", v as CacheMode)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="normal">Normal</SelectItem>
              <SelectItem value="aggressive">Aggressive</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <Label>Automated Retry</Label>
            <p className="text-xs text-muted-foreground">Auto-recover on transient errors</p>
          </div>
          <Switch checked={settings.autoRetry} onCheckedChange={(v) => void update("autoRetry", v)} />
        </div>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <Label>Error Sound</Label>
            <p className="text-xs text-muted-foreground">Play tone on error toast</p>
          </div>
          <Switch checked={settings.soundOn} onCheckedChange={(v) => void update("soundOn", v)} />
        </div>
      </div>

      <div className="rounded-lg border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
          <h3 className="text-sm font-semibold">Diagnostic Log (last 100)</h3>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void loadAll()} disabled={loading}>
              <RefreshCcw className="mr-1 h-3.5 w-3.5" /> Reload
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!logs.length}>
              <Download className="mr-1 h-3.5 w-3.5" /> Export CSV
            </Button>
            <Button variant="destructive" size="sm" onClick={clearOldLogs}>
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Clear &gt;30d
            </Button>
          </div>
        </div>
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted/60">
              <tr className="text-left">
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Component</th>
                <th className="px-3 py-2">Error</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">No log entries</td></tr>
              ) : (
                logs.map((l) => (
                  <tr key={l.id} className="border-t">
                    <td className="px-3 py-1.5 whitespace-nowrap font-mono text-[11px]">{l.timestamp?.slice(0, 19).replace("T", " ")}</td>
                    <td className="px-3 py-1.5">{l.component}</td>
                    <td className="px-3 py-1.5">
                      <div className="font-medium">{l.error_code}</div>
                      <div className="text-muted-foreground">{l.error_message}</div>
                    </td>
                    <td className="px-3 py-1.5">{l.auto_fixed ? "✓ Fixed" : l.fix_applied || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default BrainSettings;
