// Ledger mapping configuration screen.
// Lets users review/override the group + type each Tally/Busy ledger name will
// be assigned to, and persist those choices for future imports.

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Loader2, Save, Wand2, RotateCcw, Tags, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  ACCOUNT_GROUPS,
  GROUP_BY_CODE,
  defaultLedgerTypeForGroup,
} from "@/lib/account-groups";
import { LEDGER_TYPES, type LedgerTypeValue } from "@/lib/constants";
import {
  applyMappingsToLedgers,
  applyFuzzySuggestions,
  buildFuzzySuggestions,
  fetchLedgerMappings,
  saveLedgerMappings,
  type FuzzySuggestion,
  type LedgerMappingRow,
  type LedgerRecord,
  type LedgerType,
} from "@/lib/tally-busy-import";

interface Props {
  companyId: string;
  ledgers: LedgerRecord[];
  onChange: (next: LedgerRecord[]) => void;
  disabled?: boolean;
  previewLimit?: number;
}

export function LedgerMappingPanel({
  companyId, ledgers, onChange, disabled, previewLimit = 200,
}: Props) {
  const [saved, setSaved] = useState<Map<string, LedgerMappingRow>>(new Map());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "mapped" | "unmapped">("all");

  // Fuzzy matching settings + review state.
  const [fuzzyOn, setFuzzyOn] = useState(true);
  const [threshold, setThreshold] = useState(0.82); // 0..1
  const [reviewOpen, setReviewOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<FuzzySuggestion[]>([]);
  const [accepted, setAccepted] = useState<Set<number>>(new Set());

  // Load existing saved mappings on mount / company change.
  useEffect(() => {
    if (!companyId) return;
    let active = true;
    setLoading(true);
    fetchLedgerMappings(companyId)
      .then((m) => { if (active) setSaved(m); })
      .catch((e: { message?: string }) => toast.error(`Could not load mappings: ${e.message || "unknown"}`))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [companyId]);

  function applySaved() {
    const next = applyMappingsToLedgers(ledgers, saved);
    onChange(next);
    const hits = ledgers.filter((r) => saved.has(r.name.toLowerCase())).length;
    toast.success(`Applied ${hits} saved mapping${hits === 1 ? "" : "s"}`);
  }

  function openFuzzyReview() {
    if (saved.size === 0) {
      toast.info("No saved mappings yet — save some first to enable fuzzy match.");
      return;
    }
    const sugg = buildFuzzySuggestions(ledgers, saved, threshold);
    if (sugg.length === 0) {
      toast.info("No close matches found above the current threshold.");
      return;
    }
    setSuggestions(sugg);
    setAccepted(new Set(sugg.map((s) => s.index))); // accept all by default
    setReviewOpen(true);
  }

  function applyAcceptedFuzzy() {
    const picks = suggestions.filter((s) => accepted.has(s.index));
    if (picks.length === 0) {
      setReviewOpen(false);
      return;
    }
    const next = applyFuzzySuggestions(ledgers, picks);
    onChange(next);
    toast.success(`Auto-matched ${picks.length} ledger${picks.length === 1 ? "" : "s"}`);
    setReviewOpen(false);
  }

  function autoMatchAndApply() {
    if (saved.size === 0) {
      toast.info("No saved mappings yet — save some first.");
      return;
    }
    // First exact, then fuzzy in one shot.
    const exact = applyMappingsToLedgers(ledgers, saved);
    const sugg = buildFuzzySuggestions(exact, saved, threshold);
    const next = applyFuzzySuggestions(exact, sugg);
    onChange(next);
    const exactHits = ledgers.filter((r) => saved.has(r.name.toLowerCase())).length;
    toast.success(
      `Auto-mapped ${exactHits} exact + ${sugg.length} fuzzy match${sugg.length === 1 ? "" : "es"}`,
    );
  }

  function setRowGroup(idx: number, code: string) {
    const next = ledgers.slice();
    const cur = next[idx];
    next[idx] = {
      ...cur,
      group_code: code,
      type: (defaultLedgerTypeForGroup(code) as LedgerType) ?? cur.type,
    };
    onChange(next);
  }

  function setRowType(idx: number, type: LedgerType) {
    const next = ledgers.slice();
    next[idx] = { ...next[idx], type };
    onChange(next);
  }

  async function persist(scope: "all" | "changed") {
    const rows = scope === "changed"
      ? ledgers.filter((r) => {
          const m = saved.get(r.name.toLowerCase());
          return !m || m.group_code !== r.group_code || m.ledger_type !== r.type;
        })
      : ledgers;
    if (rows.length === 0) {
      toast.info("Nothing to save");
      return;
    }
    setSaving(true);
    try {
      const out = await saveLedgerMappings(
        companyId,
        rows.map((r) => ({ name: r.name, group_code: r.group_code, type: r.type })),
      );
      // Refresh saved cache
      const fresh = await fetchLedgerMappings(companyId);
      setSaved(fresh);
      toast.success(`Saved ${out.saved} mapping${out.saved === 1 ? "" : "s"}`);
    } catch (e) {
      const err = e as { message?: string };
      toast.error(`Save failed: ${err.message || "unknown"}`);
    } finally {
      setSaving(false);
    }
  }

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return ledgers
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => {
        if (term && !r.name.toLowerCase().includes(term)) return false;
        const has = saved.has(r.name.toLowerCase());
        if (filter === "mapped" && !has) return false;
        if (filter === "unmapped" && has) return false;
        return true;
      });
  }, [ledgers, q, filter, saved]);

  const visible = filtered.slice(0, previewLimit);
  const mappedCount = ledgers.filter((r) => saved.has(r.name.toLowerCase())).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Tags className="h-4 w-4" /> Ledger group mapping
        </CardTitle>
        <CardDescription>
          Review how each Tally/Busy ledger name will be classified. Saved mappings are reused on future imports.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{ledgers.length} ledger{ledgers.length === 1 ? "" : "s"}</Badge>
          <Badge variant="outline">{mappedCount} previously saved</Badge>
          <Badge variant="outline">{ledgers.length - mappedCount} new</Badge>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={applySaved}
              disabled={disabled || loading || saved.size === 0}>
              <Wand2 className="mr-1 h-3.5 w-3.5" /> Apply saved
            </Button>
            <Button size="sm" variant="outline" onClick={openFuzzyReview}
              disabled={disabled || loading || saved.size === 0 || !fuzzyOn}>
              <Sparkles className="mr-1 h-3.5 w-3.5" /> Review fuzzy matches
            </Button>
            <Button size="sm" variant="outline" onClick={autoMatchAndApply}
              disabled={disabled || loading || saved.size === 0}>
              <Sparkles className="mr-1 h-3.5 w-3.5" /> Auto-match all
            </Button>
            <Button size="sm" variant="outline" onClick={() => persist("changed")}
              disabled={disabled || saving}>
              {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
              Save changed
            </Button>
            <Button size="sm" onClick={() => persist("all")} disabled={disabled || saving}>
              {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
              Save all as future defaults
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/30 px-3 py-2">
          <div className="flex items-center gap-2">
            <Switch id="fuzzy-on" checked={fuzzyOn} onCheckedChange={setFuzzyOn} disabled={disabled} />
            <Label htmlFor="fuzzy-on" className="text-xs">
              Fuzzy match when exact name not found
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Sensitivity</span>
            <Slider
              value={[Math.round(threshold * 100)]}
              onValueChange={(v) => setThreshold((v[0] ?? 80) / 100)}
              min={60} max={98} step={1}
              className="w-[160px]"
              disabled={disabled || !fuzzyOn}
            />
            <Badge variant="outline" className="text-[10px] tabular-nums">
              ≥ {Math.round(threshold * 100)}%
            </Badge>
          </div>
          <span className="text-[11px] text-muted-foreground">
            Higher = stricter matches. Use <strong>Review fuzzy matches</strong> to confirm before applying.
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search ledger name…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-8 max-w-xs"
          />
          <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
            <SelectTrigger className="h-8 w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="mapped">Previously saved</SelectItem>
              <SelectItem value="unmapped">New / unsaved</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">
            Showing {visible.length} of {filtered.length}
          </span>
          {filtered.length > previewLimit && (
            <Badge variant="outline" className="text-[10px]">
              Capped at {previewLimit} — refine search to edit more
            </Badge>
          )}
        </div>

        <div className="max-h-[420px] overflow-auto rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source ledger name</TableHead>
                <TableHead>Group</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="w-[120px]">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map(({ r, i }) => {
                const m = saved.get(r.name.toLowerCase());
                const isSaved = !!m;
                const drift = isSaved && (m.group_code !== r.group_code || m.ledger_type !== r.type);
                return (
                  <TableRow key={`${r.name}-${i}`}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell>
                      <Select
                        value={r.group_code}
                        onValueChange={(v) => setRowGroup(i, v)}
                        disabled={disabled}
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue>{GROUP_BY_CODE[r.group_code]?.label || r.group_code}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {ACCOUNT_GROUPS.map((g) => (
                            <SelectItem key={g.code} value={g.code}>{g.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={r.type}
                        onValueChange={(v) => setRowType(i, v as LedgerType)}
                        disabled={disabled}
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {LEDGER_TYPES.map((t: { value: LedgerTypeValue; label: string }) => (
                            <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-xs">
                      {!isSaved && <Badge variant="outline">New</Badge>}
                      {isSaved && !drift && <Badge variant="secondary">Saved</Badge>}
                      {drift && (
                        <span className="inline-flex items-center gap-1">
                          <Badge>Changed</Badge>
                          <Button
                            size="icon" variant="ghost" className="h-6 w-6"
                            title="Revert to saved"
                            onClick={() => {
                              const next = ledgers.slice();
                              next[i] = { ...next[i], group_code: m.group_code, type: m.ledger_type };
                              onChange(next);
                            }}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {visible.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-xs text-muted-foreground">
                    No ledgers match the current filter.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <p className="text-[11px] text-muted-foreground">
          <strong>Apply saved</strong> reuses your previous choices.{" "}
          <strong>Save changed</strong> stores only edits made here.{" "}
          <strong>Save all</strong> remembers every visible ledger so future imports of the same names auto-map.
        </p>

        <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4" /> Fuzzy match suggestions
              </DialogTitle>
              <DialogDescription>
                {suggestions.length} ledger{suggestions.length === 1 ? "" : "s"} look similar to a saved mapping.
                Uncheck any you don't want to apply.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[420px] overflow-auto rounded border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">
                      <input
                        type="checkbox"
                        checked={accepted.size === suggestions.length && suggestions.length > 0}
                        onChange={(e) => setAccepted(
                          e.target.checked ? new Set(suggestions.map((s) => s.index)) : new Set(),
                        )}
                      />
                    </TableHead>
                    <TableHead>Source ledger</TableHead>
                    <TableHead>Matched saved name</TableHead>
                    <TableHead>Group</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {suggestions.map((s) => {
                    const on = accepted.has(s.index);
                    return (
                      <TableRow key={s.index}>
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={(e) => {
                              const next = new Set(accepted);
                              if (e.target.checked) next.add(s.index); else next.delete(s.index);
                              setAccepted(next);
                            }}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{s.source}</TableCell>
                        <TableCell className="text-xs">{s.match.source_name}</TableCell>
                        <TableCell className="text-xs">
                          {GROUP_BY_CODE[s.match.group_code]?.label || s.match.group_code}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {(s.score * 100).toFixed(0)}%
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setReviewOpen(false)}>Cancel</Button>
              <Button onClick={applyAcceptedFuzzy} disabled={accepted.size === 0}>
                Apply {accepted.size} match{accepted.size === 1 ? "" : "es"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}