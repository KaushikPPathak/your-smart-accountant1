// Tally / Busy importer with safe handling of very large files.
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, Upload, Database as DbIcon, Boxes, Receipt, Layers, Download,
} from "lucide-react";
import { toast } from "sonner";
import { GROUP_BY_CODE } from "@/lib/account-groups";
import {
  parseFileOrZip, classifyAndMap, estimateBand,
  postLedgers, postItems, postVouchers,
  type LedgerRecord, type ItemRecord, type VoucherRecord, type PostResultEx,
  type ImportSettings, DEFAULT_IMPORT_SETTINGS,
} from "@/lib/tally-busy-import";
import { ImportProgressCard } from "./ImportProgressCard";
import { ImportErrorBoundary } from "./ImportErrorBoundary";
import { ImportSettingsPanel } from "./ImportSettingsPanel";

const SIZE_CONFIRM_BYTES = 10 * 1024 * 1024; // 10 MB

interface Props { companyId: string; disabled: boolean }

interface Keyed { _key: string }
type LedgerRow = LedgerRecord & Keyed;
type ItemRow = ItemRecord & Keyed;
type VoucherRow = VoucherRecord & Keyed;

// =====================================================================
export function TallyBusyImport({ companyId, disabled }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <DbIcon className="h-4 w-4" /> Import from Tally / Busy / other software
        </CardTitle>
        <CardDescription>
          Upload a Tally XML, Busy backup, CSV, Excel, or ZIP. Large files are supported —
          you'll see an estimated load time and a progress bar. For very big companies,
          export Masters and Day Book as separate XML files.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ImportErrorBoundary>
          <Tabs defaultValue="all">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="all"><Layers className="mr-1 h-3.5 w-3.5" /> All-in-One</TabsTrigger>
              <TabsTrigger value="ledgers"><DbIcon className="mr-1 h-3.5 w-3.5" /> Ledgers</TabsTrigger>
              <TabsTrigger value="items"><Boxes className="mr-1 h-3.5 w-3.5" /> Items</TabsTrigger>
              <TabsTrigger value="vouchers"><Receipt className="mr-1 h-3.5 w-3.5" /> Vouchers</TabsTrigger>
            </TabsList>
            <TabsContent value="all" className="pt-4">
              <CombinedImporter companyId={companyId} disabled={disabled} />
            </TabsContent>
            <TabsContent value="ledgers" className="pt-4">
              <SingleImporter
                companyId={companyId} disabled={disabled} kind="ledger"
                hint="Tally: Gateway → Display → List of Accounts → Export (XML). Busy: Display → Account Books → Ledgers → Export (Excel/CSV)."
              />
            </TabsContent>
            <TabsContent value="items" className="pt-4">
              <SingleImporter
                companyId={companyId} disabled={disabled} kind="item"
                hint="Tally: Gateway → Display → Inventory Books → Stock Items → Export (XML). Busy: Display → Inventory → Items → Export."
              />
            </TabsContent>
            <TabsContent value="vouchers" className="pt-4">
              <SingleImporter
                companyId={companyId} disabled={disabled} kind="voucher"
                hint="Tally: Display → Day Book → Alt+E → XML. Busy: Display → Account Books → Day Book → Export."
              />
            </TabsContent>
          </Tabs>
        </ImportErrorBoundary>
      </CardContent>
    </Card>
  );
}

// =====================================================================
// Pre-flight confirm dialog for big files
// =====================================================================
function useFilePicker(onAccept: (f: File) => void, disabled: boolean) {
  const [pending, setPending] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function pick(f: File | null) {
    if (!f) return;
    if (f.size > SIZE_CONFIRM_BYTES) {
      setPending(f);
    } else {
      onAccept(f);
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  const dialog = pending ? (
    <AlertDialog open onOpenChange={(o) => { if (!o) setPending(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Large file detected</AlertDialogTitle>
          <AlertDialogDescription>
            <strong>{pending.name}</strong> is {(pending.size / (1024 * 1024)).toFixed(1)} MB.
            Estimated load time: <em>{estimateBand(pending.size).label}</em>.
            <br /><br />
            Please don't close this tab while it's running. Continue?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setPending(null)}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => { const f = pending; setPending(null); if (f) onAccept(f); }}>
            Continue
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ) : null;

  const input = (
    <Input
      ref={inputRef}
      type="file"
      accept=".xml,.csv,.txt,.xlsx,.xls,.zip"
      disabled={disabled}
      onChange={(e) => pick(e.target.files?.[0] || null)}
    />
  );

  return { input, dialog };
}

// =====================================================================
// Failed rows CSV
// =====================================================================
function downloadFailedCsv(name: string, rows: { name: string; reason: string }[]) {
  const csv = ["name,reason", ...rows.map((r) =>
    `"${r.name.replace(/"/g, '""')}","${r.reason.replace(/"/g, '""')}"`,
  )].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${name}-failed-rows.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// =====================================================================
// Combined "All-in-One" importer
// =====================================================================
function CombinedImporter({ companyId, disabled }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [settings, setSettings] = useState<ImportSettings>(DEFAULT_IMPORT_SETTINGS);
  const [stage, setStage] = useState("");
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [posting, setPosting] = useState(false);

  const [ledgers, setLedgers] = useState<LedgerRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [vouchers, setVouchers] = useState<VoucherRow[]>([]);
  const [unknownCount, setUnknownCount] = useState(0);

  const [selL, setSelL] = useState<Set<string>>(new Set());
  const [selI, setSelI] = useState<Set<string>>(new Set());
  const [selV, setSelV] = useState<Set<string>>(new Set());

  const [failed, setFailed] = useState<{ name: string; reason: string }[]>([]);

  async function handleFile(f: File) {
    setFile(f);
    setBusy(true);
    setLedgers([]); setItems([]); setVouchers([]); setUnknownCount(0); setFailed([]);
    try {
      setStage("Decoding & parsing file");
      setDone(0); setTotal(0);
      const data = await parseFileOrZip(f, settings);
      setStage("Classifying records");
      setTotal(data.length);
      const out = await classifyAndMap(
        data,
        (d, t, label) => { setDone(d); setTotal(t); if (label) setStage(label); },
        settings.chunkSize,
      );
      const lRows: LedgerRow[] = out.ledgers.map((x, i) => ({ ...x, _key: `l${i}` }));
      const iRows: ItemRow[] = out.items.map((x, i) => ({ ...x, _key: `i${i}` }));
      const vRows: VoucherRow[] = out.vouchers.map((x, i) => ({ ...x, _key: `v${i}` }));
      setLedgers(lRows); setItems(iRows); setVouchers(vRows);
      setSelL(new Set(lRows.map((r) => r._key)));
      setSelI(new Set(iRows.map((r) => r._key)));
      setSelV(new Set(vRows.map((r) => r._key)));
      setUnknownCount(out.unknown);
      toast.success(
        `Found ${lRows.length} ledgers, ${iRows.length} items, ${vRows.length} vouchers`
        + (out.unknown ? ` (${out.unknown} unrecognized)` : ""),
      );
    } catch (err) {
      const e = err as { message?: string };
      toast.error(`Parse failed: ${e.message || "unknown"}`);
    } finally {
      setBusy(false);
      setStage("");
    }
  }

  const { input, dialog } = useFilePicker(handleFile, disabled || busy);

  async function importAll() {
    const lRows = ledgers.filter((r) => selL.has(r._key));
    const iRows = items.filter((r) => selI.has(r._key));
    const vRows = vouchers.filter((r) => selV.has(r._key));
    const grand = lRows.length + iRows.length + vRows.length;
    if (grand === 0) { toast.error("Nothing selected"); return; }
    setPosting(true);
    setFailed([]);
    try {
      const allFailed: { name: string; reason: string }[] = [];
      let summary = "";
      if (lRows.length > 0) {
        setStage(`Posting ${lRows.length} ledgers`); setTotal(lRows.length); setDone(0);
        const r: PostResultEx = await postLedgers(companyId, lRows, (d, t, l) => {
          setDone(d); setTotal(t); if (l) setStage(l);
        });
        allFailed.push(...r.failed);
        summary += `Ledgers: ${r.created} created, ${r.updated} updated. `;
      }
      if (iRows.length > 0) {
        setStage(`Posting ${iRows.length} items`); setTotal(iRows.length); setDone(0);
        const r = await postItems(companyId, iRows, (d, t, l) => {
          setDone(d); setTotal(t); if (l) setStage(l);
        });
        allFailed.push(...r.failed);
        summary += `Items: ${r.created} created, ${r.updated} updated. `;
      }
      if (vRows.length > 0) {
        setStage(`Posting ${vRows.length} vouchers`); setTotal(vRows.length); setDone(0);
        const r = await postVouchers(companyId, vRows, (d, t, l) => {
          setDone(d); setTotal(t); if (l) setStage(l);
        });
        allFailed.push(...r.failed);
        summary += `Vouchers: ${r.created} created${r.skipped ? `, ${r.skipped} skipped` : ""}.`;
      }
      setFailed(allFailed);
      toast.success(summary || "Done");
      if (allFailed.length === 0) {
        setLedgers([]); setItems([]); setVouchers([]); setUnknownCount(0); setFile(null);
      }
    } catch (err) {
      const e = err as { message?: string };
      toast.error(`Posting failed: ${e.message || "unknown"}`);
    } finally {
      setPosting(false); setStage(""); setDone(0); setTotal(0);
    }
  }

  const grandTotal = ledgers.length + items.length + vouchers.length;

  return (
    <div className="space-y-3">
      {dialog}
      <ImportSettingsPanel value={settings} onChange={setSettings} disabled={busy || posting} />
      <div className="space-y-1">
        <Label>Single Tally / Busy export (XML, ZIP, Excel, CSV)</Label>
        {input}
        <p className="text-[11px] text-muted-foreground">
          Tally: Gateway → Display → Day Book + Masters → Export → XML.
          Busy: Administration → Backup → save as ZIP. Note: <code>.001</code> / <code>TDBK*</code>{" "}
          files are Tally binary backups — restore them inside Tally first, then export as XML.
        </p>
      </div>

      {(busy || posting) && file && (
        <ImportProgressCard
          fileName={file.name} fileSize={file.size}
          stage={stage || (busy ? "Working" : "Posting")}
          done={done} total={total}
          counts={{
            ledgers: ledgers.length, items: items.length,
            vouchers: vouchers.length, unknown: unknownCount,
          }}
        />
      )}

      {grandTotal > 0 && !busy && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 p-3">
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="secondary"><DbIcon className="mr-1 h-3 w-3" /> {selL.size} / {ledgers.length} ledgers</Badge>
              <Badge variant="secondary"><Boxes className="mr-1 h-3 w-3" /> {selI.size} / {items.length} items</Badge>
              <Badge variant="secondary"><Receipt className="mr-1 h-3 w-3" /> {selV.size} / {vouchers.length} vouchers</Badge>
              {unknownCount > 0 && <Badge variant="outline">{unknownCount} unrecognized</Badge>}
            </div>
            <Button onClick={importAll} disabled={posting || disabled || (selL.size + selI.size + selV.size === 0)}>
              {posting ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Posting…</> : <><Upload className="mr-1 h-4 w-4" /> Import everything</>}
            </Button>
          </div>

          {failed.length > 0 && (
            <div className="flex items-center justify-between rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm">
              <span>{failed.length} row(s) failed to import.</span>
              <Button size="sm" variant="outline" onClick={() => downloadFailedCsv("import", failed)}>
                <Download className="mr-1 h-3.5 w-3.5" /> Download failed rows (CSV)
              </Button>
            </div>
          )}

          <Accordion type="multiple" defaultValue={["L", "I", "V"]} className="rounded-md border">
            {ledgers.length > 0 && (
              <AccordionItem value="L">
                <AccordionTrigger className="px-3">
                  <span className="flex items-center gap-2 text-sm">
                    <DbIcon className="h-4 w-4" /> Ledgers ({selL.size} / {ledgers.length})
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <PreviewSection
                    rows={ledgers} sel={selL} setSel={setSelL}
                    previewLimit={settings.previewLimit}
                    headers={<><TableHead>Name</TableHead><TableHead>Group</TableHead><TableHead>Type</TableHead><TableHead>GSTIN</TableHead><TableHead className="text-right">Opening</TableHead></>}
                    render={(r) => <LedgerCols r={r} />}
                    matches={(r, q) => r.name.toLowerCase().includes(q) || r.gstin.toLowerCase().includes(q)}
                  />
                </AccordionContent>
              </AccordionItem>
            )}
            {items.length > 0 && (
              <AccordionItem value="I">
                <AccordionTrigger className="px-3">
                  <span className="flex items-center gap-2 text-sm">
                    <Boxes className="h-4 w-4" /> Items ({selI.size} / {items.length})
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <PreviewSection
                    rows={items} sel={selI} setSel={setSelI}
                    previewLimit={settings.previewLimit}
                    headers={<><TableHead>Name</TableHead><TableHead>HSN</TableHead><TableHead>Unit</TableHead><TableHead className="text-right">GST %</TableHead><TableHead className="text-right">Op. Qty</TableHead><TableHead className="text-right">Op. Rate</TableHead><TableHead className="text-right">Sale ₹</TableHead></>}
                    render={(r) => <ItemCols r={r} />}
                    matches={(r, q) => r.name.toLowerCase().includes(q) || r.hsn.toLowerCase().includes(q)}
                  />
                </AccordionContent>
              </AccordionItem>
            )}
            {vouchers.length > 0 && (
              <AccordionItem value="V">
                <AccordionTrigger className="px-3">
                  <span className="flex items-center gap-2 text-sm">
                    <Receipt className="h-4 w-4" /> Vouchers ({selV.size} / {vouchers.length})
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <PreviewSection
                    rows={vouchers} sel={selV} setSel={setSelV}
                    previewLimit={settings.previewLimit}
                    headers={<><TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead>Vch No</TableHead><TableHead>Party</TableHead><TableHead className="text-right">Amount ₹</TableHead></>}
                    render={(r) => <VoucherCols r={r} />}
                    matches={(r, q) => r.party.toLowerCase().includes(q) || r.voucher_no.toLowerCase().includes(q) || r.date.includes(q)}
                  />
                </AccordionContent>
              </AccordionItem>
            )}
          </Accordion>
        </>
      )}
    </div>
  );
}

// =====================================================================
// Single-type tab
// =====================================================================
function SingleImporter({
  companyId, disabled, kind, hint,
}: Props & { kind: "ledger" | "item" | "voucher"; hint: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [settings, setSettings] = useState<ImportSettings>(DEFAULT_IMPORT_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [posting, setPosting] = useState(false);
  const [stage, setStage] = useState("");
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [ledgers, setLedgers] = useState<LedgerRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [vouchers, setVouchers] = useState<VoucherRow[]>([]);
  const [selL, setSelL] = useState<Set<string>>(new Set());
  const [selI, setSelI] = useState<Set<string>>(new Set());
  const [selV, setSelV] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState<{ name: string; reason: string }[]>([]);

  async function handleFile(f: File) {
    setFile(f); setBusy(true); setFailed([]);
    setLedgers([]); setItems([]); setVouchers([]);
    try {
      setStage("Decoding & parsing file");
      const data = await parseFileOrZip(f, settings);
      setStage("Classifying records"); setTotal(data.length); setDone(0);
      const out = await classifyAndMap(
        data,
        (d, t, l) => { setDone(d); setTotal(t); if (l) setStage(l); },
        settings.chunkSize,
      );
      if (kind === "ledger") {
        const rows: LedgerRow[] = out.ledgers.map((x, i) => ({ ...x, _key: `l${i}` }));
        setLedgers(rows); setSelL(new Set(rows.map((r) => r._key)));
        toast.success(`Parsed ${rows.length} ledger rows`);
      } else if (kind === "item") {
        const rows: ItemRow[] = out.items.map((x, i) => ({ ...x, _key: `i${i}` }));
        setItems(rows); setSelI(new Set(rows.map((r) => r._key)));
        toast.success(`Parsed ${rows.length} item rows`);
      } else {
        const rows: VoucherRow[] = out.vouchers.map((x, i) => ({ ...x, _key: `v${i}` }));
        setVouchers(rows); setSelV(new Set(rows.map((r) => r._key)));
        toast.success(`Parsed ${rows.length} voucher rows`);
      }
    } catch (err) {
      const e = err as { message?: string };
      toast.error(`Parse failed: ${e.message || "unknown"}`);
    } finally { setBusy(false); setStage(""); }
  }

  const { input, dialog } = useFilePicker(handleFile, disabled || busy);

  async function onPost() {
    setPosting(true); setFailed([]);
    try {
      let res: PostResultEx;
      if (kind === "ledger") {
        const rows = ledgers.filter((r) => selL.has(r._key));
        setStage("Posting ledgers"); setTotal(rows.length); setDone(0);
        res = await postLedgers(companyId, rows, (d, t, l) => {
          setDone(d); setTotal(t); if (l) setStage(l);
        });
        if (res.failed.length === 0) setLedgers([]);
      } else if (kind === "item") {
        const rows = items.filter((r) => selI.has(r._key));
        setStage("Posting items"); setTotal(rows.length); setDone(0);
        res = await postItems(companyId, rows, (d, t, l) => {
          setDone(d); setTotal(t); if (l) setStage(l);
        });
        if (res.failed.length === 0) setItems([]);
      } else {
        const rows = vouchers.filter((r) => selV.has(r._key));
        setStage("Posting vouchers"); setTotal(rows.length); setDone(0);
        res = await postVouchers(companyId, rows, (d, t, l) => {
          setDone(d); setTotal(t); if (l) setStage(l);
        });
        if (res.failed.length === 0) setVouchers([]);
      }
      setFailed(res.failed);
      toast.success(`Imported — ${res.created} created${res.updated ? `, ${res.updated} updated` : ""}${res.skipped ? `, ${res.skipped} skipped` : ""}`);
    } catch (err) {
      const e = err as { message?: string };
      toast.error(`Posting failed: ${e.message || "unknown"}`);
    } finally { setPosting(false); setStage(""); }
  }

  return (
    <div className="space-y-3">
      {dialog}
      <ImportSettingsPanel value={settings} onChange={setSettings} disabled={busy || posting} />
      <div className="space-y-1">
        <Label>Tally XML, CSV, Excel, or ZIP</Label>
        {input}
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </div>

      {(busy || posting) && file && (
        <ImportProgressCard
          fileName={file.name} fileSize={file.size}
          stage={stage || "Working"} done={done} total={total}
        />
      )}

      {failed.length > 0 && (
        <div className="flex items-center justify-between rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm">
          <span>{failed.length} row(s) failed.</span>
          <Button size="sm" variant="outline" onClick={() => downloadFailedCsv(kind, failed)}>
            <Download className="mr-1 h-3.5 w-3.5" /> Download CSV
          </Button>
        </div>
      )}

      {kind === "ledger" && ledgers.length > 0 && !busy && (
        <SectionPreview
          title="Ledgers" rows={ledgers} sel={selL} setSel={setSelL}
          previewLimit={settings.previewLimit}
          onPost={onPost} posting={posting} disabled={disabled}
          render={(r) => <LedgerCols r={r} />}
          headers={<><TableHead>Name</TableHead><TableHead>Group</TableHead><TableHead>Type</TableHead><TableHead>GSTIN</TableHead><TableHead className="text-right">Opening</TableHead></>}
          matches={(r, q) => r.name.toLowerCase().includes(q) || r.gstin.toLowerCase().includes(q)}
        />
      )}
      {kind === "item" && items.length > 0 && !busy && (
        <SectionPreview
          title="Items" rows={items} sel={selI} setSel={setSelI}
          previewLimit={settings.previewLimit}
          onPost={onPost} posting={posting} disabled={disabled}
          render={(r) => <ItemCols r={r} />}
          headers={<><TableHead>Name</TableHead><TableHead>HSN</TableHead><TableHead>Unit</TableHead><TableHead className="text-right">GST %</TableHead><TableHead className="text-right">Op. Qty</TableHead><TableHead className="text-right">Op. Rate</TableHead><TableHead className="text-right">Sale ₹</TableHead></>}
          matches={(r, q) => r.name.toLowerCase().includes(q) || r.hsn.toLowerCase().includes(q)}
        />
      )}
      {kind === "voucher" && vouchers.length > 0 && !busy && (
        <SectionPreview
          title="Vouchers" rows={vouchers} sel={selV} setSel={setSelV}
          previewLimit={settings.previewLimit}
          onPost={onPost} posting={posting} disabled={disabled}
          render={(r) => <VoucherCols r={r} />}
          headers={<><TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead>Vch No</TableHead><TableHead>Party</TableHead><TableHead className="text-right">Amount ₹</TableHead></>}
          matches={(r, q) => r.party.toLowerCase().includes(q) || r.voucher_no.toLowerCase().includes(q) || r.date.includes(q)}
        />
      )}
    </div>
  );
}

// =====================================================================
// Preview with search + capped row rendering
// =====================================================================
interface PreviewProps<T extends Keyed> {
  rows: T[];
  sel: Set<string>;
  setSel: (s: Set<string>) => void;
  headers: React.ReactNode;
  render: (r: T) => React.ReactNode;
  matches: (r: T, q: string) => boolean;
  previewLimit?: number;
}

function PreviewSection<T extends Keyed>(props: PreviewProps<T>) {
  const { rows, sel, setSel, headers, render, matches, previewLimit = 200 } = props;
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? rows.filter((r) => matches(r, s)) : rows;
  }, [rows, q, matches]);

  const visible = filtered.slice(0, previewLimit);
  const allFilteredSelected = filtered.length > 0 && filtered.every((r) => sel.has(r._key));

  function toggleAllFiltered(on: boolean) {
    const next = new Set(sel);
    for (const r of filtered) {
      if (on) next.add(r._key); else next.delete(r._key);
    }
    setSel(next);
  }

  function toggleOne(key: string, on: boolean) {
    const next = new Set(sel);
    if (on) next.add(key); else next.delete(key);
    setSel(next);
  }

  return (
    <div className="space-y-2 p-2">
      <div className="flex items-center gap-2">
        <Input
          placeholder="Search…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-8 max-w-xs"
        />
        <span className="text-xs text-muted-foreground">
          Showing {Math.min(visible.length, previewLimit)} of {filtered.length}
          {q && ` (filtered from ${rows.length})`}
        </span>
        {filtered.length > previewLimit && (
          <Badge variant="outline" className="text-[10px]">Preview capped at {previewLimit} rows</Badge>
        )}
      </div>
      <div className="max-h-[360px] overflow-auto rounded border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={(e) => toggleAllFiltered(e.target.checked)}
                />
              </TableHead>
              {headers}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((r) => (
              <TableRow key={r._key}>
                <TableCell>
                  <input
                    type="checkbox"
                    checked={sel.has(r._key)}
                    onChange={(e) => toggleOne(r._key, e.target.checked)}
                  />
                </TableCell>
                {render(r)}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function SectionPreview<T extends Keyed>(props: PreviewProps<T> & {
  title: string; onPost: () => void; posting: boolean; disabled: boolean;
}) {
  return (
    <>
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">{props.sel.size} of {props.rows.length} selected</div>
        <Button onClick={props.onPost} disabled={props.posting || props.disabled || props.sel.size === 0}>
          {props.posting ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Posting…</> : <><Upload className="mr-1 h-4 w-4" /> Import {props.sel.size}</>}
        </Button>
      </div>
      <div className="rounded-md border">
        <PreviewSection {...props} />
      </div>
    </>
  );
}

function LedgerCols({ r }: { r: LedgerRecord }) {
  return (
    <>
      <TableCell className="font-medium">{r.name}</TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {GROUP_BY_CODE[r.group_code]?.label || r.group_code}
      </TableCell>
      <TableCell><Badge variant="secondary" className="text-[10px]">{r.type}</Badge></TableCell>
      <TableCell className="font-mono text-xs">{r.gstin}</TableCell>
      <TableCell className="text-right font-mono text-xs">
        {r.opening !== 0 ? `${Math.abs(r.opening).toFixed(2)} ${r.opening >= 0 ? "Dr" : "Cr"}` : "—"}
      </TableCell>
    </>
  );
}

function ItemCols({ r }: { r: ItemRecord }) {
  return (
    <>
      <TableCell className="font-medium">{r.name}</TableCell>
      <TableCell className="font-mono text-xs">{r.hsn}</TableCell>
      <TableCell className="text-xs">{r.unit}</TableCell>
      <TableCell className="text-right text-xs">{r.gst_rate}</TableCell>
      <TableCell className="text-right text-xs">{r.opening_qty}</TableCell>
      <TableCell className="text-right text-xs">{r.opening_rate.toFixed(2)}</TableCell>
      <TableCell className="text-right text-xs">{r.sale_price.toFixed(2)}</TableCell>
    </>
  );
}

function VoucherCols({ r }: { r: VoucherRecord }) {
  return (
    <>
      <TableCell className="text-xs">{r.date}</TableCell>
      <TableCell><Badge variant="secondary" className="text-[10px]">{r.vtype}</Badge></TableCell>
      <TableCell className="font-mono text-xs">{r.voucher_no}</TableCell>
      <TableCell className="text-sm">{r.party}</TableCell>
      <TableCell className="text-right font-mono text-xs">{r.total.toFixed(2)}</TableCell>
    </>
  );
}