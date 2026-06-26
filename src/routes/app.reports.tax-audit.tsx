import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShieldCheck, Plus, Download, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { formatINR, rupeesToPaise } from "@/lib/money";
import { downloadXlsx, r } from "@/lib/exporters";
import { fetchLedgerBalances } from "@/lib/reports";
import { useFyRangeState } from "@/components/reports/ReportToolbar";
import {
  DEFAULT_IT_BLOCKS,
  scan40A3,
  fetch43BSnapshot,
  summariseBlocks,
  bookDepreciationPaise,
  netProfitBooks,
  buildComputation,
  type CashHit,
  type Statutory43BRow,
  type BlockSummary,
  type ItAsset,
  type ItMovement,
} from "@/lib/tax-audit";

export const Route = createFileRoute("/app/reports/tax-audit")({
  head: () => ({ meta: [{ title: "Tax Audit (Form 3CD) — Reports" }] }),
  component: TaxAuditPage,
});

// Typed wrapper for newly-added tables (types regen lags one migration).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

function TaxAuditPage() {
  const { activeCompanyId, activeMembership } = useCompany();
  const canWrite =
    activeMembership?.role === "admin" || activeMembership?.role === "accountant";
  const { from, to } = useFyRangeState();
  const fyStart = from;
  const fyEnd = to;

  // ---------- 40A(3) ----------
  const [cashHits, setCashHits] = useState<CashHit[]>([]);
  // ---------- 43B ----------
  const [stat43b, setStat43b] = useState<Statutory43BRow[]>([]);
  // ---------- IT Depreciation ----------
  const [assets, setAssets] = useState<ItAsset[]>([]);
  const [movements, setMovements] = useState<ItMovement[]>([]);
  // ---------- Other disallowances (manual rows) ----------
  type ManualRow = { id: string; section: string; description: string; amount_paise: number };
  const [manualRows, setManualRows] = useState<ManualRow[]>([]);

  const [loading, setLoading] = useState(false);
  const [assetDlg, setAssetDlg] = useState(false);
  const [addDlg, setAddDlg] = useState<{ asset: ItAsset } | null>(null);

  const reload = async () => {
    if (!activeCompanyId) return;
    setLoading(true);
    try {
      const [hits, dues, assetsRes, movesRes, disallowRes] = await Promise.all([
        scan40A3(activeCompanyId, fyStart, fyEnd),
        fetch43BSnapshot(activeCompanyId, fyEnd),
        sb
          .from("it_fixed_assets")
          .select("id, company_id, block_code, ledger_id, name, fy_start, opening_wdv_paise")
          .eq("company_id", activeCompanyId)
          .eq("fy_start", fyStart),
        sb
          .from("it_asset_movements")
          .select("id, asset_id, fy_start, kind, movement_date, amount_paise, notes")
          .eq("company_id", activeCompanyId)
          .eq("fy_start", fyStart),
        sb
          .from("it_disallowances")
          .select("id, section, description, amount_paise")
          .eq("company_id", activeCompanyId)
          .eq("fy_end", fyEnd),
      ]);
      setCashHits(hits);
      setStat43b(dues);
      setAssets((assetsRes.data ?? []) as ItAsset[]);
      setMovements((movesRes.data ?? []) as ItMovement[]);
      setManualRows((disallowRes.data ?? []) as ManualRow[]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCompanyId, fyStart, fyEnd]);

  const blockSummaries: BlockSummary[] = useMemo(
    () => summariseBlocks([...DEFAULT_IT_BLOCKS], assets, movements, fyStart),
    [assets, movements, fyStart],
  );

  const totalItDep = blockSummaries.reduce((s, b) => s + b.depreciation_paise, 0);
  const totalCash40A3 = cashHits.reduce((s, h) => s + (h.amount_paise - 10_00_000), 0); // disallowance = excess only? IT Act fully disallows the whole payment > 10k. Use full amount:
  const totalCash40A3Full = cashHits.reduce((s, h) => s + h.amount_paise, 0);
  const otherDisallow = manualRows
    .filter((r) => !/40\(a\)\(ia\)/i.test(r.section))
    .reduce((s, r) => s + r.amount_paise, 0);
  const tdsDisallow = manualRows
    .filter((r) => /40\(a\)\(ia\)/i.test(r.section))
    .reduce((s, r) => s + r.amount_paise, 0);

  // Net profit + book dep
  const [npBooks, setNpBooks] = useState(0);
  const [bookDep, setBookDep] = useState(0);
  useEffect(() => {
    if (!activeCompanyId) return;
    fetchLedgerBalances(activeCompanyId, fyEnd, fyStart, {
      excludeProfitLossClosingTransfers: true,
    }).then((bs) => {
      setNpBooks(netProfitBooks(bs));
      setBookDep(bookDepreciationPaise(bs));
    });
  }, [activeCompanyId, fyStart, fyEnd]);

  const computation = useMemo(
    () =>
      buildComputation({
        netProfitPaise: npBooks,
        cash40A3Paise: totalCash40A3Full,
        disallow40aIaPaise: tdsDisallow,
        otherDisallowPaise: otherDisallow,
        bookDepreciationPaise: bookDep,
        itDepreciationPaise: totalItDep,
      }),
    [npBooks, totalCash40A3Full, tdsDisallow, otherDisallow, bookDep, totalItDep],
  );

  // ---------- Mutations ----------
  const upsert43B = async (row: Statutory43BRow, patch: Partial<Statutory43BRow>) => {
    if (!activeCompanyId || !canWrite) return;
    const merged = { ...row, ...patch };
    const { error } = await sb.from("it_43b_clearances").upsert(
      {
        company_id: activeCompanyId,
        ledger_id: row.ledger_id,
        fy_end: fyEnd,
        cleared_on: merged.cleared_on || null,
        cleared_paise: merged.cleared_paise ?? 0,
        reference: merged.reference || null,
      },
      { onConflict: "company_id,ledger_id,fy_end" },
    );
    if (error) toast.error(error.message);
    else {
      setStat43b((cur) => cur.map((r) => (r.ledger_id === row.ledger_id ? merged : r)));
    }
  };

  const addAsset = async (a: { block_code: string; name: string; opening_wdv_paise: number }) => {
    if (!activeCompanyId || !canWrite) return;
    const { data, error } = await sb
      .from("it_fixed_assets")
      .insert({
        company_id: activeCompanyId,
        block_code: a.block_code,
        name: a.name,
        fy_start: fyStart,
        opening_wdv_paise: a.opening_wdv_paise,
      })
      .select()
      .single();
    if (error) {
      toast.error(error.message);
      return;
    }
    setAssets((cur) => [...cur, data as ItAsset]);
  };

  const removeAsset = async (id: string) => {
    if (!canWrite) return;
    const { error } = await sb.from("it_fixed_assets").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      setAssets((cur) => cur.filter((a) => a.id !== id));
      setMovements((cur) => cur.filter((m) => m.asset_id !== id));
    }
  };

  const addMovement = async (
    asset: ItAsset,
    m: { kind: "addition" | "deletion"; movement_date: string; amount_paise: number; notes?: string },
  ) => {
    if (!activeCompanyId || !canWrite) return;
    const { data, error } = await sb
      .from("it_asset_movements")
      .insert({
        company_id: activeCompanyId,
        asset_id: asset.id,
        fy_start: fyStart,
        kind: m.kind,
        movement_date: m.movement_date,
        amount_paise: m.amount_paise,
        notes: m.notes ?? null,
      })
      .select()
      .single();
    if (error) {
      toast.error(error.message);
      return;
    }
    setMovements((cur) => [...cur, data as ItMovement]);
  };

  const addManual = async (row: { section: string; description: string; amount_paise: number }) => {
    if (!activeCompanyId || !canWrite) return;
    const { data, error } = await sb
      .from("it_disallowances")
      .insert({
        company_id: activeCompanyId,
        fy_end: fyEnd,
        section: row.section,
        description: row.description,
        amount_paise: row.amount_paise,
      })
      .select()
      .single();
    if (error) {
      toast.error(error.message);
      return;
    }
    setManualRows((cur) => [...cur, data as ManualRow]);
  };

  const removeManual = async (id: string) => {
    const { error } = await sb.from("it_disallowances").delete().eq("id", id);
    if (error) toast.error(error.message);
    else setManualRows((cur) => cur.filter((r) => r.id !== id));
  };

  // ---------- Export Audit Pack ----------
  const exportPack = async () => {
    if (!activeCompanyId) return;
    const balances = await fetchLedgerBalances(activeCompanyId, fyEnd, fyStart, {
      excludeProfitLossClosingTransfers: true,
    });
    const plRows: (string | number)[][] = [
      ["Profit & Loss — Books", "Amount (₹)"],
      ...balances
        .filter((b) => b.type === "income_indirect")
        .map((b) => [`Income: ${b.name}`, r(-b.closing_paise)]),
      ...balances
        .filter((b) => b.type === "expense_indirect")
        .map((b) => [`Expense: ${b.name}`, r(b.closing_paise)]),
      ["Net Profit (Books)", r(npBooks)],
    ];
    const cashRows: (string | number)[][] = [
      ["Date", "Party Ledger", "Voucher No.", "Aggregate Cash Paid (₹)", "Vouchers"],
      ...cashHits.map((h) => [h.date, h.ledger_name, h.voucher_no, r(h.amount_paise), h.voucher_count]),
      ["Total disallowable u/s 40A(3)", "", "", r(totalCash40A3Full), ""],
    ];
    const s43bRows: (string | number)[][] = [
      ["Ledger", "Outstanding (₹)", "Cleared On", "Cleared (₹)", "Reference"],
      ...stat43b.map((s) => [s.ledger_name, r(s.closing_paise), s.cleared_on ?? "", r(s.cleared_paise ?? 0), s.reference ?? ""]),
    ];
    const depRows: (string | number)[][] = [
      ["Block", "Rate %", "Opening WDV", "Additions ≥180d", "Additions <180d", "Deletions", "Depreciation", "Closing WDV"],
      ...blockSummaries.map((b) => [
        b.name,
        b.rate_pct,
        r(b.opening_paise),
        r(b.additions_ge180_paise),
        r(b.additions_lt180_paise),
        r(b.deletions_paise),
        r(b.depreciation_paise),
        r(b.closing_wdv_paise),
      ]),
      ["TOTAL", "", "", "", "", "", r(totalItDep), ""],
    ];
    const compRows: (string | number)[][] = [
      ["Particulars", "Amount (₹)"],
      ...computation.rows.map((c) => [c.label, r(c.paise)]),
    ];
    downloadXlsx(`tax-audit-pack-${fyStart}_to_${fyEnd}.xlsx`, [
      { name: "P&L (Books)", rows: plRows },
      { name: "40A(3) Cash Scanner", rows: cashRows },
      { name: "43B Dues", rows: s43bRows },
      { name: "IT Depreciation", rows: depRows },
      { name: "Computation", rows: compRows },
    ]);
    toast.success("Audit pack downloaded");
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 py-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Income Tax Audit Preview — Form 3CD</CardTitle>
            <Badge variant="outline">FY {fyStart} → {fyEnd}</Badge>
          </div>
          <Button onClick={exportPack} disabled={loading} size="sm">
            <Download className="h-4 w-4 mr-1" /> Export Audit Pack
          </Button>
        </CardHeader>
        <CardContent className="pt-0 text-xs text-muted-foreground">
          Scans your ledgers for common 3CD check-points. All figures are previews — verify against your statutory returns before filing.
        </CardContent>
      </Card>

      <Tabs defaultValue="cash">
        <TabsList>
          <TabsTrigger value="cash">40A(3) Cash Scanner</TabsTrigger>
          <TabsTrigger value="dues">43B Statutory Dues</TabsTrigger>
          <TabsTrigger value="dep">IT Depreciation</TabsTrigger>
          <TabsTrigger value="manual">Other Disallowances</TabsTrigger>
          <TabsTrigger value="comp">Computation</TabsTrigger>
        </TabsList>

        {/* 40A(3) */}
        <TabsContent value="cash">
          <Card>
            <CardContent className="p-3">
              <div className="flex items-center gap-2 mb-2 text-sm">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Cash payments to a single party exceeding ₹10,000 in a day are disallowed.
                <Badge variant="destructive" className="ml-auto">{cashHits.length} flagged</Badge>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Party</TableHead>
                    <TableHead>Voucher</TableHead>
                    <TableHead className="text-right">Cash Paid</TableHead>
                    <TableHead className="text-right">Vouchers</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cashHits.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No violations detected.</TableCell></TableRow>
                  ) : cashHits.map((h, i) => (
                    <TableRow key={i}>
                      <TableCell>{h.date}</TableCell>
                      <TableCell>{h.ledger_name}</TableCell>
                      <TableCell className="font-mono text-xs">{h.voucher_no}</TableCell>
                      <TableCell className="text-right text-destructive font-medium">{formatINR(h.amount_paise)}</TableCell>
                      <TableCell className="text-right">{h.voucher_count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 43B */}
        <TabsContent value="dues">
          <Card>
            <CardContent className="p-3">
              <div className="text-xs text-muted-foreground mb-2">
                Outstanding statutory liabilities at year-end. Enter the clearance date (must be on or before return filing date) to claim deduction.
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ledger</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                    <TableHead>Cleared On</TableHead>
                    <TableHead className="text-right">Cleared Amount</TableHead>
                    <TableHead>Reference</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stat43b.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No outstanding statutory dues.</TableCell></TableRow>
                  ) : stat43b.map((row) => (
                    <TableRow key={row.ledger_id}>
                      <TableCell>{row.ledger_name}</TableCell>
                      <TableCell className="text-right">{formatINR(row.closing_paise)}</TableCell>
                      <TableCell>
                        <Input
                          type="date"
                          className="h-7 text-xs"
                          value={row.cleared_on ?? ""}
                          onChange={(e) => upsert43B(row, { cleared_on: e.target.value })}
                          disabled={!canWrite}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          className="h-7 text-xs text-right w-32"
                          defaultValue={(row.cleared_paise ?? 0) / 100}
                          onBlur={(e) => upsert43B(row, { cleared_paise: rupeesToPaise(e.target.value) })}
                          disabled={!canWrite}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-7 text-xs"
                          defaultValue={row.reference ?? ""}
                          onBlur={(e) => upsert43B(row, { reference: e.target.value })}
                          disabled={!canWrite}
                          placeholder="Challan / UTR"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* IT Depreciation */}
        <TabsContent value="dep">
          <Card>
            <CardContent className="p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground">
                  Block-of-Assets schedule. Additions on/before 3rd Oct get full-year depreciation; after that, half.
                </div>
                <Button size="sm" onClick={() => setAssetDlg(true)} disabled={!canWrite}>
                  <Plus className="h-4 w-4 mr-1" /> Add Asset
                </Button>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Block</TableHead>
                    <TableHead className="text-right">Rate %</TableHead>
                    <TableHead className="text-right">Opening WDV</TableHead>
                    <TableHead className="text-right">Add ≥180d</TableHead>
                    <TableHead className="text-right">Add &lt;180d</TableHead>
                    <TableHead className="text-right">Deletions</TableHead>
                    <TableHead className="text-right">Depreciation</TableHead>
                    <TableHead className="text-right">Closing WDV</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {blockSummaries.map((b) => (
                    <TableRow key={b.code}>
                      <TableCell>{b.name}</TableCell>
                      <TableCell className="text-right">{b.rate_pct}%</TableCell>
                      <TableCell className="text-right">{formatINR(b.opening_paise)}</TableCell>
                      <TableCell className="text-right">{formatINR(b.additions_ge180_paise)}</TableCell>
                      <TableCell className="text-right">{formatINR(b.additions_lt180_paise)}</TableCell>
                      <TableCell className="text-right">{formatINR(b.deletions_paise)}</TableCell>
                      <TableCell className="text-right font-medium">{formatINR(b.depreciation_paise)}</TableCell>
                      <TableCell className="text-right font-medium">{formatINR(b.closing_wdv_paise)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-semibold border-t-2">
                    <TableCell colSpan={6}>TOTAL Depreciation as per IT Act</TableCell>
                    <TableCell className="text-right">{formatINR(totalItDep)}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>

              <div>
                <Label className="text-xs uppercase text-muted-foreground">Individual Assets</Label>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Block</TableHead>
                      <TableHead className="text-right">Opening WDV</TableHead>
                      <TableHead>Movements</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assets.length === 0 ? (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No assets defined for this year.</TableCell></TableRow>
                    ) : assets.map((a) => {
                      const mvs = movements.filter((m) => m.asset_id === a.id);
                      return (
                        <TableRow key={a.id}>
                          <TableCell>{a.name}</TableCell>
                          <TableCell className="text-xs">{a.block_code}</TableCell>
                          <TableCell className="text-right">{formatINR(a.opening_wdv_paise)}</TableCell>
                          <TableCell className="text-xs">
                            {mvs.length === 0 ? <span className="text-muted-foreground">—</span> :
                              mvs.map((m) => (
                                <div key={m.id}>
                                  {m.kind === "addition" ? "+ " : "− "}{m.movement_date}: {formatINR(m.amount_paise)}
                                </div>
                              ))
                            }
                          </TableCell>
                          <TableCell className="text-right space-x-1">
                            <Button size="sm" variant="outline" onClick={() => setAddDlg({ asset: a })} disabled={!canWrite}>+ / −</Button>
                            <Button size="sm" variant="ghost" onClick={() => removeAsset(a.id)} disabled={!canWrite}><Trash2 className="h-3 w-3" /></Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Manual disallowances */}
        <TabsContent value="manual">
          <Card>
            <CardContent className="p-3 space-y-2">
              <ManualDisallowanceForm onAdd={addManual} disabled={!canWrite} />
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Section</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {manualRows.length === 0 ? (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No manual disallowances added.</TableCell></TableRow>
                  ) : manualRows.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-mono text-xs">{m.section}</TableCell>
                      <TableCell>{m.description}</TableCell>
                      <TableCell className="text-right">{formatINR(m.amount_paise)}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => removeManual(m.id)} disabled={!canWrite}><Trash2 className="h-3 w-3" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Computation */}
        <TabsContent value="comp">
          <Card>
            <CardContent className="p-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Particulars</TableHead>
                    <TableHead className="text-right">Amount (₹)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {computation.rows.map((c, i) => (
                    <TableRow key={i} className={c.kind === "equals" ? "font-bold border-t-2" : ""}>
                      <TableCell>{c.label}</TableCell>
                      <TableCell className="text-right">
                        {c.kind === "less" ? "(" : ""}{formatINR(Math.abs(c.paise))}{c.kind === "less" ? ")" : ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AssetDialog
        open={assetDlg}
        onClose={() => setAssetDlg(false)}
        onSave={(a) => { void addAsset(a); setAssetDlg(false); }}
      />
      {addDlg && (
        <MovementDialog
          asset={addDlg.asset}
          onClose={() => setAddDlg(null)}
          onSave={(m) => { void addMovement(addDlg.asset, m); setAddDlg(null); }}
        />
      )}
    </div>
  );
}

function ManualDisallowanceForm({
  onAdd, disabled,
}: { onAdd: (r: { section: string; description: string; amount_paise: number }) => void; disabled?: boolean }) {
  const [section, setSection] = useState("40(a)(ia)");
  const [desc, setDesc] = useState("");
  const [amt, setAmt] = useState("");
  return (
    <div className="flex flex-wrap items-end gap-2 border rounded p-2 bg-muted/30">
      <div className="space-y-1">
        <Label className="text-xs">Section</Label>
        <Select value={section} onValueChange={setSection}>
          <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="40(a)(ia)">40(a)(ia) — TDS</SelectItem>
            <SelectItem value="40A(7)">40A(7) — Gratuity</SelectItem>
            <SelectItem value="36(1)(va)">36(1)(va) — Employee PF</SelectItem>
            <SelectItem value="37">37 — Personal/Capital</SelectItem>
            <SelectItem value="Other">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1 flex-1 min-w-[200px]">
        <Label className="text-xs">Description</Label>
        <Input className="h-8" value={desc} onChange={(e) => setDesc(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Amount (₹)</Label>
        <Input className="h-8 w-32 text-right" type="number" value={amt} onChange={(e) => setAmt(e.target.value)} />
      </div>
      <Button size="sm" disabled={disabled || !desc || !amt}
        onClick={() => { onAdd({ section, description: desc, amount_paise: rupeesToPaise(amt) }); setDesc(""); setAmt(""); }}>
        <Plus className="h-4 w-4 mr-1" /> Add
      </Button>
    </div>
  );
}

function AssetDialog({
  open, onClose, onSave,
}: { open: boolean; onClose: () => void; onSave: (a: { block_code: string; name: string; opening_wdv_paise: number }) => void }) {
  const [block, setBlock] = useState<string>(DEFAULT_IT_BLOCKS[3].code);
  const [name, setName] = useState("");
  const [wdv, setWdv] = useState("");
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add Fixed Asset (IT)</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Block</Label>
            <Select value={block} onValueChange={setBlock}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DEFAULT_IT_BLOCKS.map((b) => (
                  <SelectItem key={b.code} value={b.code}>{b.name} — {b.rate_pct}%</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Asset Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="space-y-1"><Label>Opening WDV (₹)</Label><Input type="number" value={wdv} onChange={(e) => setWdv(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!name} onClick={() => { onSave({ block_code: block, name, opening_wdv_paise: rupeesToPaise(wdv || "0") }); setName(""); setWdv(""); }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MovementDialog({
  asset, onClose, onSave,
}: { asset: ItAsset; onClose: () => void; onSave: (m: { kind: "addition" | "deletion"; movement_date: string; amount_paise: number; notes?: string }) => void }) {
  const [kind, setKind] = useState<"addition" | "deletion">("addition");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amt, setAmt] = useState("");
  const [notes, setNotes] = useState("");
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Movement — {asset.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Type</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as "addition" | "deletion")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="addition">Addition</SelectItem>
                <SelectItem value="deletion">Deletion</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="space-y-1"><Label>Amount (₹)</Label><Input type="number" value={amt} onChange={(e) => setAmt(e.target.value)} /></div>
          <div className="space-y-1"><Label>Notes</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!amt} onClick={() => onSave({ kind, movement_date: date, amount_paise: rupeesToPaise(amt), notes })}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
