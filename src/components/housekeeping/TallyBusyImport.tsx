// Tally / Busy import UI: All-in-One file plus separate Ledgers / Items / Vouchers tabs.
import { useState } from "react";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, Upload, Database as DbIcon, Boxes, Receipt, Layers } from "lucide-react";
import { toast } from "sonner";
import { GROUP_BY_CODE } from "@/lib/account-groups";
import {
  parseFileOrZip, classifyRow, mapLedger, mapItem, mapVoucher,
  postLedgers, postItems, postVouchers,
  type LedgerRecord, type ItemRecord, type VoucherRecord,
} from "@/lib/tally-busy-import";

interface Props { companyId: string; disabled: boolean }

type Selectable<T> = T & { _key: string; _selected: boolean };

function toggle<T extends { _key: string; _selected: boolean }>(
  rows: T[], idx: number, value: boolean,
): T[] {
  return rows.map((r, i) => (i === idx ? { ...r, _selected: value } : r));
}

// =====================================================================
export function TallyBusyImport({ companyId, disabled }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <DbIcon className="h-4 w-4" /> Import from Tally / Busy / other software
        </CardTitle>
        <CardDescription>
          Upload a Tally XML, Busy backup, CSV, Excel, or ZIP file. The "All-in-One" tab handles a
          single file containing everything; the other tabs let you import one type at a time.
        </CardDescription>
      </CardHeader>
      <CardContent>
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
              hint="Tally: Display → Day Book → Alt+E → XML. Busy: Display → Account Books → Day Book → Export. Each row becomes one voucher with a basic two-leg posting."
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

// =====================================================================
// Single-type tab: only keeps rows of the selected kind.
// =====================================================================
function SingleImporter({
  companyId, disabled, kind, hint,
}: Props & { kind: "ledger" | "item" | "voucher"; hint: string }) {
  const [busy, setBusy] = useState(false);
  const [posting, setPosting] = useState(false);
  const [ledgers, setLedgers] = useState<Selectable<LedgerRecord>[]>([]);
  const [items, setItems] = useState<Selectable<ItemRecord>[]>([]);
  const [vouchers, setVouchers] = useState<Selectable<VoucherRecord>[]>([]);

  async function onFile(f: File | null) {
    if (!f) return;
    setBusy(true);
    try {
      const data = await parseFileOrZip(f);
      let count = 0;
      if (kind === "ledger") {
        const out = data.map(mapLedger).filter((x): x is LedgerRecord => x !== null)
          .map((x, i) => ({ ...x, _key: `l${i}`, _selected: true }));
        setLedgers(out); count = out.length;
      } else if (kind === "item") {
        const out = data.map(mapItem).filter((x): x is ItemRecord => x !== null)
          .map((x, i) => ({ ...x, _key: `i${i}`, _selected: true }));
        setItems(out); count = out.length;
      } else {
        const out = data.map(mapVoucher).filter((x): x is VoucherRecord => x !== null)
          .map((x, i) => ({ ...x, _key: `v${i}`, _selected: true }));
        setVouchers(out); count = out.length;
      }
      toast.success(`Parsed ${count} ${kind} rows`);
    } catch (err) {
      const e = err as { message?: string };
      toast.error(`Parse failed: ${e.message || "unknown"}`);
    } finally { setBusy(false); }
  }

  async function onPost() {
    setPosting(true);
    try {
      let res;
      if (kind === "ledger") {
        res = await postLedgers(companyId, ledgers.filter((r) => r._selected));
        setLedgers([]);
      } else if (kind === "item") {
        res = await postItems(companyId, items.filter((r) => r._selected));
        setItems([]);
      } else {
        res = await postVouchers(companyId, vouchers.filter((r) => r._selected));
        setVouchers([]);
      }
      toast.success(`Imported — ${res.created} created${res.updated ? `, ${res.updated} updated` : ""}${res.skipped ? `, ${res.skipped} skipped` : ""}`);
    } catch (err) {
      const e = err as { message?: string };
      toast.error(`Posting failed: ${e.message || "unknown"}`);
    } finally { setPosting(false); }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label>Tally XML, CSV, Excel, or ZIP</Label>
        <Input type="file" accept=".xml,.csv,.txt,.xlsx,.xls,.zip"
          disabled={disabled || busy}
          onChange={(e) => onFile(e.target.files?.[0] || null)} />
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </div>
      {busy && <Loader2 className="h-5 w-5 animate-spin" />}
      {kind === "ledger" && ledgers.length > 0 && (
        <SectionPreview
          title="Ledgers" rows={ledgers} setRows={setLedgers}
          onPost={onPost} posting={posting} disabled={disabled}
          render={(r) => <LedgerCols r={r} />}
          headers={<><TableHead>Name</TableHead><TableHead>Group</TableHead><TableHead>Type</TableHead><TableHead>GSTIN</TableHead><TableHead className="text-right">Opening</TableHead></>}
        />
      )}
      {kind === "item" && items.length > 0 && (
        <SectionPreview
          title="Items" rows={items} setRows={setItems}
          onPost={onPost} posting={posting} disabled={disabled}
          render={(r) => <ItemCols r={r} />}
          headers={<><TableHead>Name</TableHead><TableHead>HSN</TableHead><TableHead>Unit</TableHead><TableHead className="text-right">GST %</TableHead><TableHead className="text-right">Op. Qty</TableHead><TableHead className="text-right">Op. Rate</TableHead><TableHead className="text-right">Sale ₹</TableHead></>}
        />
      )}
      {kind === "voucher" && vouchers.length > 0 && (
        <SectionPreview
          title="Vouchers" rows={vouchers} setRows={setVouchers}
          onPost={onPost} posting={posting} disabled={disabled}
          render={(r) => <VoucherCols r={r} />}
          headers={<><TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead>Vch No</TableHead><TableHead>Party</TableHead><TableHead className="text-right">Amount ₹</TableHead></>}
        />
      )}
    </div>
  );
}

// =====================================================================
// Combined "All-in-One" importer
// =====================================================================
function CombinedImporter({ companyId, disabled }: Props) {
  const [busy, setBusy] = useState(false);
  const [posting, setPosting] = useState(false);
  const [ledgers, setLedgers] = useState<Selectable<LedgerRecord>[]>([]);
  const [items, setItems] = useState<Selectable<ItemRecord>[]>([]);
  const [vouchers, setVouchers] = useState<Selectable<VoucherRecord>[]>([]);
  const [unknownCount, setUnknownCount] = useState(0);
  const [progress, setProgress] = useState("");

  async function onFile(f: File | null) {
    if (!f) return;
    setBusy(true);
    try {
      const data = await parseFileOrZip(f);
      const ls: LedgerRecord[] = [], its: ItemRecord[] = [], vs: VoucherRecord[] = [];
      let unk = 0;
      for (const row of data) {
        const kind = classifyRow(row);
        if (kind === "ledger") {
          const x = mapLedger(row); if (x) ls.push(x); else unk++;
        } else if (kind === "item") {
          const x = mapItem(row); if (x) its.push(x); else unk++;
        } else if (kind === "voucher") {
          const x = mapVoucher(row); if (x) vs.push(x); else unk++;
        } else { unk++; }
      }
      setLedgers(ls.map((x, i) => ({ ...x, _key: `l${i}`, _selected: true })));
      setItems(its.map((x, i) => ({ ...x, _key: `i${i}`, _selected: true })));
      setVouchers(vs.map((x, i) => ({ ...x, _key: `v${i}`, _selected: true })));
      setUnknownCount(unk);
      toast.success(`Parsed: ${ls.length} ledgers, ${its.length} items, ${vs.length} vouchers${unk ? ` (${unk} unrecognized)` : ""}`);
    } catch (err) {
      const e = err as { message?: string };
      toast.error(`Parse failed: ${e.message || "unknown"}`);
    } finally { setBusy(false); }
  }

  async function importAll() {
    const selL = ledgers.filter((r) => r._selected);
    const selI = items.filter((r) => r._selected);
    const selV = vouchers.filter((r) => r._selected);
    if (selL.length + selI.length + selV.length === 0) {
      toast.error("Nothing selected"); return;
    }
    setPosting(true);
    try {
      let summary = "";
      if (selL.length > 0) {
        setProgress(`Posting ${selL.length} ledgers…`);
        const r = await postLedgers(companyId, selL);
        summary += `Ledgers: ${r.created} created, ${r.updated} updated. `;
      }
      if (selI.length > 0) {
        setProgress(`Posting ${selI.length} items…`);
        const r = await postItems(companyId, selI);
        summary += `Items: ${r.created} created, ${r.updated} updated. `;
      }
      if (selV.length > 0) {
        setProgress(`Posting ${selV.length} vouchers…`);
        const r = await postVouchers(companyId, selV);
        summary += `Vouchers: ${r.created} created${r.skipped ? `, ${r.skipped} skipped` : ""}.`;
      }
      toast.success(summary || "Done");
      setLedgers([]); setItems([]); setVouchers([]); setUnknownCount(0);
    } catch (err) {
      const e = err as { message?: string };
      toast.error(`Posting failed: ${e.message || "unknown"}`);
    } finally { setPosting(false); setProgress(""); }
  }

  const selL = ledgers.filter((r) => r._selected).length;
  const selI = items.filter((r) => r._selected).length;
  const selV = vouchers.filter((r) => r._selected).length;
  const total = ledgers.length + items.length + vouchers.length;

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label>Single Tally / Busy export (XML, ZIP, Excel, CSV)</Label>
        <Input type="file" accept=".xml,.csv,.txt,.xlsx,.xls,.zip"
          disabled={disabled || busy}
          onChange={(e) => onFile(e.target.files?.[0] || null)} />
        <p className="text-[11px] text-muted-foreground">
          Tally: Gateway → Display → Day Book + Masters → Export → XML (gives one combined file).
          Busy: Administration → Backup → save as a ZIP, then upload the ZIP here. The importer
          classifies every record automatically.
        </p>
      </div>
      {busy && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Parsing…</div>}

      {total > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 p-3">
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="secondary"><DbIcon className="mr-1 h-3 w-3" /> {selL} / {ledgers.length} ledgers</Badge>
              <Badge variant="secondary"><Boxes className="mr-1 h-3 w-3" /> {selI} / {items.length} items</Badge>
              <Badge variant="secondary"><Receipt className="mr-1 h-3 w-3" /> {selV} / {vouchers.length} vouchers</Badge>
              {unknownCount > 0 && <Badge variant="outline">{unknownCount} unrecognized</Badge>}
            </div>
            <Button onClick={importAll} disabled={posting || disabled || (selL + selI + selV === 0)}>
              {posting ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> {progress || "Posting…"}</> : <><Upload className="mr-1 h-4 w-4" /> Import everything</>}
            </Button>
          </div>

          <Accordion type="multiple" defaultValue={["L", "I", "V"]} className="rounded-md border">
            {ledgers.length > 0 && (
              <AccordionItem value="L">
                <AccordionTrigger className="px-3">
                  <span className="flex items-center gap-2 text-sm">
                    <DbIcon className="h-4 w-4" /> Ledgers ({selL} / {ledgers.length})
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <PreviewTable
                    rows={ledgers} setRows={setLedgers}
                    headers={<><TableHead>Name</TableHead><TableHead>Group</TableHead><TableHead>Type</TableHead><TableHead>GSTIN</TableHead><TableHead className="text-right">Opening</TableHead></>}
                    render={(r) => <LedgerCols r={r} />}
                  />
                </AccordionContent>
              </AccordionItem>
            )}
            {items.length > 0 && (
              <AccordionItem value="I">
                <AccordionTrigger className="px-3">
                  <span className="flex items-center gap-2 text-sm">
                    <Boxes className="h-4 w-4" /> Items ({selI} / {items.length})
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <PreviewTable
                    rows={items} setRows={setItems}
                    headers={<><TableHead>Name</TableHead><TableHead>HSN</TableHead><TableHead>Unit</TableHead><TableHead className="text-right">GST %</TableHead><TableHead className="text-right">Op. Qty</TableHead><TableHead className="text-right">Op. Rate</TableHead><TableHead className="text-right">Sale ₹</TableHead></>}
                    render={(r) => <ItemCols r={r} />}
                  />
                </AccordionContent>
              </AccordionItem>
            )}
            {vouchers.length > 0 && (
              <AccordionItem value="V">
                <AccordionTrigger className="px-3">
                  <span className="flex items-center gap-2 text-sm">
                    <Receipt className="h-4 w-4" /> Vouchers ({selV} / {vouchers.length})
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <PreviewTable
                    rows={vouchers} setRows={setVouchers}
                    headers={<><TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead>Vch No</TableHead><TableHead>Party</TableHead><TableHead className="text-right">Amount ₹</TableHead></>}
                    render={(r) => <VoucherCols r={r} />}
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
// Shared preview table & per-kind cells
// =====================================================================
function PreviewTable<T extends { _key: string; _selected: boolean }>(props: {
  rows: T[];
  setRows: (r: T[]) => void;
  headers: React.ReactNode;
  render: (r: T) => React.ReactNode;
}) {
  const { rows, setRows, headers, render } = props;
  return (
    <div className="max-h-[360px] overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8">
              <input
                type="checkbox"
                checked={rows.every((r) => r._selected)}
                onChange={(e) => setRows(rows.map((r) => ({ ...r, _selected: e.target.checked })))}
              />
            </TableHead>
            {headers}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, idx) => (
            <TableRow key={r._key}>
              <TableCell>
                <input
                  type="checkbox" checked={r._selected}
                  onChange={(e) => setRows(toggle(rows, idx, e.target.checked))}
                />
              </TableCell>
              {render(r)}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function SectionPreview<T extends { _key: string; _selected: boolean }>(props: {
  title: string; rows: T[]; setRows: (r: T[]) => void;
  onPost: () => void; posting: boolean; disabled: boolean;
  headers: React.ReactNode; render: (r: T) => React.ReactNode;
}) {
  const sel = props.rows.filter((r) => r._selected).length;
  return (
    <>
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">{sel} of {props.rows.length} selected</div>
        <Button onClick={props.onPost} disabled={props.posting || props.disabled || sel === 0}>
          {props.posting ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Posting…</> : <><Upload className="mr-1 h-4 w-4" /> Import {sel}</>}
        </Button>
      </div>
      <div className="rounded-md border">
        <PreviewTable rows={props.rows} setRows={props.setRows} headers={props.headers} render={props.render} />
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