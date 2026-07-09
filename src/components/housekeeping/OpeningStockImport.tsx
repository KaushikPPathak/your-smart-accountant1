// Offline Opening-Stock import: upload an item/stock summary image or PDF,
// OCR-extract item name, HSN, qty, unit, rate, value. Map to existing items
// (or create new) and write opening_stock_qty / opening_stock_rate_paise.
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Upload, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { extractTextFromFile, type OcrProgress } from "@/lib/ocr";
import { parseStockOpeningText, type ExtractedStockItem } from "@/lib/statement-parse";
import { GST_RATES, UNITS } from "@/lib/constants";
import { formatINR, rupeesToPaise } from "@/lib/money";

interface ItemOpt {
  id: string;
  name: string;
  hsn_code: string | null;
  unit: string;
  gst_rate: number;
}

interface EditableRow extends ExtractedStockItem {
  _key: string;
  _selected: boolean;
  item_id: string; // empty = create new
  gst_rate: number;
}

interface Props {
  companyId: string;
  disabled: boolean;
  /** Annual turnover in paise — drives 4-digit vs 6-digit HSN rule. */
  annualTurnoverPaise: number;
}

// 5 crore INR = 5,00,00,000 INR = 50,00,00,00,000 paise = 5e10 paise
const HSN_THRESHOLD_PAISE = 5_00_00_000_00; // ₹5 Cr in paise

function hsnDigitsRequired(turnoverPaise: number): 4 | 6 {
  return turnoverPaise >= HSN_THRESHOLD_PAISE ? 6 : 4;
}

export function OpeningStockImport({ companyId, disabled, annualTurnoverPaise }: Props) {
  const requiredHsn = hsnDigitsRequired(annualTurnoverPaise);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [rawText, setRawText] = useState("");
  const [showRaw, setShowRaw] = useState(false);
  const [items, setItems] = useState<ItemOpt[]>([]);
  const [posting, setPosting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!companyId) return;
    supabase
      .from("items")
      .select("id, name, hsn_code, unit, gst_rate")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => setItems((data || []) as ItemOpt[]));
  }, [companyId]);

  useEffect(() => {
    if (!file) { setPreview(""); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function autoMatch(name: string): string {
    const norm = name.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
    const exact = items.find((i) => i.name.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim() === norm);
    if (exact) return exact.id;
    const partial = items.find((i) => {
      const n = i.name.toLowerCase();
      return n.includes(norm) || norm.includes(n);
    });
    return partial?.id ?? "";
  }

  async function runOcr() {
    if (!file) return;
    setBusy(true);
    try {
      const text = await extractTextFromFile(file, setProgress);
      setRawText(text);
      const parsed = parseStockOpeningText(text);
      setRows(parsed.map((p, i) => ({
        ...p,
        _key: `r${i}`,
        _selected: true,
        item_id: autoMatch(p.name),
        gst_rate: 18,
      })));
      toast.success(`Extracted ${parsed.length} stock items.`);
    } catch (e) {
      const err = e as Error;
      toast.error(err.message || "OCR failed");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  function update(key: string, patch: Partial<EditableRow>) {
    setRows((rs) => rs.map((r) => (r._key === key ? { ...r, ...patch } : r)));
  }
  function remove(key: string) {
    setRows((rs) => rs.filter((r) => r._key !== key));
  }
  function addBlank() {
    setRows((rs) => [...rs, {
      _key: `n${Date.now()}`,
      _selected: true,
      item_id: "",
      name: "",
      hsn_code: "",
      qty: 0,
      unit: "NOS",
      rate: 0,
      value: 0,
      gst_rate: 18,
    }]);
  }

  const stats = useMemo(() => {
    const sel = rows.filter((r) => r._selected);
    const totalValue = sel.reduce((a, r) => a + r.value, 0);
    const badHsn = sel.filter((r) => !r.hsn_code || r.hsn_code.length < requiredHsn).length;
    return { count: sel.length, totalValue, badHsn };
  }, [rows, requiredHsn]);

  async function postOpenings() {
    const sel = rows.filter((r) => r._selected && r.name.trim() && r.qty > 0);
    if (!sel.length) { toast.error("Nothing to post"); return; }
    if (stats.badHsn > 0) {
      toast.error(`HSN must be at least ${requiredHsn} digits for this turnover bracket. Fix ${stats.badHsn} row(s).`);
      return;
    }
    setPosting(true);
    try {
      let created = 0, updated = 0;
      for (const r of sel) {
        const ratePaise = r.rate > 0
          ? rupeesToPaise(r.rate)
          : (r.qty > 0 ? rupeesToPaise(r.value / r.qty) : 0);
        if (!r.item_id) {
          const { data, error } = await supabase
            .from("items")
            .insert({
              company_id: companyId,
              name: r.name.trim(),
              hsn_code: r.hsn_code || null,
              unit: r.unit,
              gst_rate: r.gst_rate,
              opening_stock_qty: r.qty,
              opening_stock_rate_paise: ratePaise,
            })
            .select("id")
            .single();
          if (error) throw error;
          if (data) created++;
        } else {
          const { error } = await supabase
            .from("items")
            .update({
              hsn_code: r.hsn_code || null,
              unit: r.unit,
              gst_rate: r.gst_rate,
              opening_stock_qty: r.qty,
              opening_stock_rate_paise: ratePaise,
            })
            .eq("id", r.item_id);
          if (error) throw error;
          updated++;
        }
      }
      toast.success(`Opening stock posted — ${created} created, ${updated} updated`);
      setRows([]); setFile(null);
      const { data } = await supabase
        .from("items")
        .select("id, name, hsn_code, unit, gst_rate")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .order("name");
      setItems((data || []) as ItemOpt[]);
    } catch (e) {
      const err = e as Error;
      toast.error(err.message || "Posting failed");
    } finally {
      setPosting(false);
    }
  }

  const isPdf = !!file && (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Upload className="h-4 w-4" /> Opening Stock Import (Items)
        </CardTitle>
        <CardDescription>
          Upload a stock summary PDF/image. Offline OCR extracts item name, HSN, qty, unit, rate and value.
          Map each row to an existing item or create new. HSN must be{" "}
          <strong>{requiredHsn} digits</strong> (turnover {requiredHsn === 6 ? "≥" : "<"} ₹5 Cr).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Document</Label>
            <div className="flex gap-2">
              <input ref={fileInput} type="file" accept=".pdf,image/*" className="hidden"
                onChange={(e) => { setFile(e.target.files?.[0] ?? null); setRows([]); setRawText(""); }} />
              <Button size="sm" variant="outline" onClick={() => fileInput.current?.click()} disabled={disabled}>
                Choose PDF / Image
              </Button>
              <Button size="sm" onClick={runOcr} disabled={!file || busy || disabled}>
                {busy ? <><Loader2 className="mr-2 h-3 w-3 animate-spin" />Reading…</> : "Extract"}
              </Button>
            </div>
            {file && <div className="text-[11px] text-muted-foreground truncate max-w-[280px]">{file.name}</div>}
            {progress && (
              <div className="text-[11px] text-muted-foreground">
                {progress.stage === "pdf-text" && `Reading text page ${progress.page}/${progress.totalPages}…`}
                {progress.stage === "ocr" && `OCR ${progress.page ? `${progress.page}/${progress.totalPages} ` : ""}${progress.pct ?? 0}%`}
              </div>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs flex-wrap">
            {rawText && (
              <Button size="sm" variant="outline" onClick={() => setShowRaw((v) => !v)}>
                {showRaw ? "Hide" : "Show"} OCR text
              </Button>
            )}
            <Badge variant="outline">Rows: {stats.count}</Badge>
            <Badge variant="outline">Total {formatINR(rupeesToPaise(stats.totalValue))}</Badge>
            <Badge variant={stats.badHsn === 0 ? "default" : "destructive"}>
              HSN ≥ {requiredHsn} digits {stats.badHsn ? `(${stats.badHsn} bad)` : "✓"}
            </Badge>
          </div>
        </div>

        {showRaw && rawText && (
          <div className="rounded-md border bg-muted/30 p-2">
            <pre className="text-[11px] whitespace-pre-wrap max-h-[260px] overflow-auto font-mono">{rawText}</pre>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-3 min-h-[400px]">
          <div className="rounded-md border bg-muted/30 overflow-hidden">
            {!preview ? (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground p-4 text-center">
                Original document preview will appear here.
              </div>
            ) : isPdf ? (
              <iframe src={preview} className="h-full min-h-[400px] w-full" title="stock summary" />
            ) : (
              <img src={preview} alt="stock" className="max-w-full" />
            )}
          </div>

          <div className="rounded-md border flex flex-col min-h-0">
            <div className="flex justify-between items-center border-b p-2">
              <span className="text-xs font-medium">Extracted items (editable)</span>
              <Button size="sm" variant="ghost" onClick={addBlank} disabled={disabled}>+ Add row</Button>
            </div>
            <ScrollArea className="max-h-[460px]">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead>Map</TableHead>
                    <TableHead className="w-[90px]">HSN</TableHead>
                    <TableHead className="w-[70px]">Unit</TableHead>
                    <TableHead className="w-[70px]">GST%</TableHead>
                    <TableHead className="w-[80px] text-right">Qty</TableHead>
                    <TableHead className="w-[90px] text-right">Rate ₹</TableHead>
                    <TableHead className="w-[100px] text-right">Value ₹</TableHead>
                    <TableHead className="w-8"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow><TableCell colSpan={10} className="p-6 text-center text-sm text-muted-foreground">
                      No rows yet. Upload a document and click Extract, or click "+ Add row".
                    </TableCell></TableRow>
                  ) : rows.map((r) => {
                    const hsnBad = !r.hsn_code || r.hsn_code.length < requiredHsn;
                    return (
                      <TableRow key={r._key}>
                        <TableCell>
                          <input type="checkbox" checked={r._selected}
                            onChange={(e) => update(r._key, { _selected: e.target.checked })} />
                        </TableCell>
                        <TableCell>
                          <Input className="h-7 text-xs" value={r.name}
                            onChange={(e) => update(r._key, { name: toTitleCaseOnType(e.target.value), item_id: autoMatch(toTitleCaseOnType(e.target.value)) })} />
                        </TableCell>
                        <TableCell>
                          <Select value={r.item_id || "__new__"}
                            onValueChange={(v) => update(r._key, { item_id: v === "__new__" ? "" : v })}>
                            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__new__"><span className="text-primary">+ Create new</span></SelectItem>
                              {items.map((i) => (
                                <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input className={`h-7 text-xs font-mono ${hsnBad ? "border-destructive" : ""}`}
                            value={r.hsn_code} maxLength={8}
                            onChange={(e) => update(r._key, { hsn_code: e.target.value.replace(/\D/g, "") })} />
                        </TableCell>
                        <TableCell>
                          <Select value={r.unit} onValueChange={(v) => update(r._key, { unit: v })}>
                            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Select value={String(r.gst_rate)} onValueChange={(v) => update(r._key, { gst_rate: parseFloat(v) })}>
                            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {GST_RATES.map((g) => <SelectItem key={g} value={String(g)}>{g}%</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input className="h-7 text-xs text-right font-mono" type="number" step="0.001"
                            value={r.qty || ""} onChange={(e) => {
                              const qty = parseFloat(e.target.value) || 0;
                              update(r._key, { qty, value: r.rate ? +(qty * r.rate).toFixed(2) : r.value });
                            }} />
                        </TableCell>
                        <TableCell>
                          <Input className="h-7 text-xs text-right font-mono" type="number" step="0.01"
                            value={r.rate || ""} onChange={(e) => {
                              const rate = parseFloat(e.target.value) || 0;
                              update(r._key, { rate, value: r.qty ? +(rate * r.qty).toFixed(2) : r.value });
                            }} />
                        </TableCell>
                        <TableCell>
                          <Input className="h-7 text-xs text-right font-mono" type="number" step="0.01"
                            value={r.value || ""} onChange={(e) => update(r._key, { value: parseFloat(e.target.value) || 0 })} />
                        </TableCell>
                        <TableCell>
                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => remove(r._key)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollArea>
            <div className="flex items-center justify-between border-t p-2">
              <span className="text-[11px] text-muted-foreground">
                {requiredHsn === 6
                  ? "Turnover ≥ ₹5 Cr — 6-digit HSN required."
                  : "Turnover < ₹5 Cr — 4-digit HSN required."}
              </span>
              <Button size="sm" disabled={posting || disabled || rows.length === 0} onClick={postOpenings}>
                {posting ? <><Loader2 className="mr-2 h-3 w-3 animate-spin" />Posting…</> : `Post ${stats.count} item(s)`}
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}