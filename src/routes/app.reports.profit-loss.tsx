import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { amountHeader } from "@/lib/export-format";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ReportToolbar, useFyRangeState } from "@/components/reports/ReportToolbar";
import { TAccount, type TRow } from "@/components/reports/TAccount";
import { useCompany } from "@/lib/company-context";
import { useReportPdfHeader } from "@/lib/report-pdf-header";
import { ReportViewer } from "@/components/reports/ReportViewer";
import { formatINR } from "@/lib/money";
import { downloadCsv } from "@/lib/csv";
import { downloadPdfTable, downloadXlsx, r } from "@/lib/exporters";
import { fetchLedgerBalancesWithMeta, fetchLedgerModeSplits, type LedgerBalance, type ModeSplit } from "@/lib/reports";
import { groupBalances, groupedTRows, groupedExportRows } from "@/lib/report-grouping";
import { getEntityFeatures } from "@/lib/entity-status";
import { computeNceReportShape } from "@/lib/nce-report-shape";
import { NCE_LEVEL_LABEL } from "@/lib/nce-classification";
import { openLedgerReport } from "@/lib/voucher-return";
import { ViewSwitcher, useReportView } from "@/components/reports/ViewSwitcher";
import { BucketedGrid } from "@/components/reports/BucketedGrid";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Scale } from "lucide-react";
import { TaxAuditPanel } from "@/components/reports/TaxAuditPanel";
import { supabase } from "@/integrations/supabase/client";
import { readLedgers, readItems, readVoucherItemsForCompany, readVouchers, withCacheFallback } from "@/lib/offline/cache-read";
import { calculateWac, type ItemMove } from "@/lib/inventory/valuation-engine";

export const Route = createFileRoute("/app/reports/profit-loss")({
  head: () => ({ meta: [{ title: "Profit & Loss — Reports" }] }),
  component: ProfitLoss,
});

function ProfitLoss() {
  const { activeCompanyId, activeMembership } = useCompany();
  const pdfHeader = useReportPdfHeader();
  const features = getEntityFeatures(activeMembership?.companies?.entity_status ?? "individual");
  const isIE = features.plLabel === "Income & Expenditure A/c";
  const reportTitle = isIE ? "Income & Expenditure Account" : "Profit & Loss Account";
  const dr = isIE ? "Expenditure" : "Dr. Particulars";
  const cr = isIE ? "Income" : "Cr. Particulars";
  const surplusLabel = isIE ? "To Excess of Income over Expenditure" : "To Net Profit c/d";
  const deficitLabel = isIE ? "By Excess of Expenditure over Income" : "By Net Loss c/d";
  
  const inventoryEnabled = !!activeMembership?.companies?.inventory_enabled;
  const navigate = useNavigate();
  const { from, to, setFrom, setTo } = useFyRangeState();
  const { view, setView } = useReportView("profit-loss");
  const [taxView, setTaxView] = useState(false);
  const [balances, setBalances] = useState<LedgerBalance[]>([]);
  const [excludedClosingEntries, setExcludedClosingEntries] = useState(0);
  const [openingStock, setOpeningStock] = useState(0);
  const [closingStock, setClosingStock] = useState(0);
  const [modeSplits, setModeSplits] = useState<Map<string, ModeSplit>>(new Map());

  useEffect(() => {
    if (!activeCompanyId) return;
    fetchLedgerBalancesWithMeta(activeCompanyId, to, from, {
      excludeProfitLossClosingTransfers: true,
    }).then((result) => {
      setBalances(result.balances);
      setExcludedClosingEntries(result.excludedClosingTransferEntries);
    });
    fetchLedgerModeSplits(activeCompanyId, from, to, {
      excludeProfitLossClosingTransfers: true,
    }).then(setModeSplits).catch(() => setModeSplits(new Map()));
  }, [activeCompanyId, from, to]);

  useEffect(() => {
    if (!activeCompanyId || !inventoryEnabled) return;
    (async () => {
      try {
        const [items, vouchers, voucherItems] = await Promise.all([
          withCacheFallback(
            async () => (await supabase.from("items").select("*").eq("company_id", activeCompanyId)).data || [],
            async () => readItems(activeCompanyId)
          ),
          withCacheFallback(
            async () => (await supabase.from("vouchers").select("*").eq("company_id", activeCompanyId)).data || [],
            async () => readVouchers(activeCompanyId, { to })
          ),
          withCacheFallback(
            async () => (await supabase.from("voucher_items").select("*, vouchers!inner(voucher_date, company_id)").eq("vouchers.company_id", activeCompanyId).lte("vouchers.voucher_date", to)).data || [],
            async () => readVoucherItemsForCompany(activeCompanyId)
          )
        ]);

        const voucherMap = new Map((vouchers as any[]).map(v => [String(v.id), v]));
        let totalOpeningPaise = 0;
        let totalClosingPaise = 0;

        for (const it of items as any[]) {
          const itemMoves: ItemMove[] = (voucherItems as any[])
            .filter(vi => String(vi.item_id) === String(it.id))
            .map(vi => {
              const v = voucherMap.get(String(vi.voucher_id));
              if (!v || v.is_deleted) return null;
              if (v.voucher_date > to) return null;
              return {
                date: v.voucher_date,
                qty: Number(vi.qty || 0),
                taxablePaise: Number(vi.taxable_paise || 0),
                type: v.voucher_type,
                voucherId: v.id
              };
            })
            .filter((m): m is ItemMove => m !== null);

          const valOpening = calculateWac(
            Number(it.opening_stock_qty || 0),
            Number(it.opening_stock_rate_paise || 0),
            itemMoves.filter(m => m.date < from)
          );
          totalOpeningPaise += valOpening.closingValuePaise;

          const valClosing = calculateWac(
            Number(it.opening_stock_qty || 0),
            Number(it.opening_stock_rate_paise || 0),
            itemMoves
          );
          totalClosingPaise += valClosing.closingValuePaise;
        }

        const [{ data: manualOpening }, { data: manualClosing }] = await Promise.all([
          supabase.from("inventory_manual_valuations").select("valuation_paise").eq("company_id", activeCompanyId).eq("as_of_date", from).maybeSingle(),
          supabase.from("inventory_manual_valuations").select("valuation_paise").eq("company_id", activeCompanyId).eq("as_of_date", to).maybeSingle()
        ]);

        setOpeningStock(manualOpening ? Number(manualOpening.valuation_paise) : totalOpeningPaise);
        setClosingStock(manualClosing ? Number(manualClosing.valuation_paise) : totalClosingPaise);
      } catch {
        setOpeningStock(0);
        setClosingStock(0);
      }
    })();
  }, [activeCompanyId, from, to, inventoryEnabled]);

  const expenseTypes = new Set(["expense_indirect"]);
  const incomeTypes = new Set(["income_indirect"]);

  const innerForExpense = (b: LedgerBalance) => {
    const m = modeSplits.get(b.id); if (!m) return undefined;
    return [
      { label: "Paid in Cash", valuePaise: m.cashPaise },
      { label: "Paid via Bank / Cheque", valuePaise: m.bankPaise },
      { label: "Other (journal / adjustment)", valuePaise: m.otherPaise },
    ];
  };
  const innerForIncome = (b: LedgerBalance) => {
    const m = modeSplits.get(b.id); if (!m) return undefined;
    return [
      { label: "Received in Cash", valuePaise: -m.cashPaise },
      { label: "Received via Bank / Cheque", valuePaise: -m.bankPaise },
      { label: "Other (journal / adjustment)", valuePaise: -m.otherPaise },
    ];
  };

  const expenseBuckets = useMemo(
    () => groupBalances(
      balances.filter((b) => expenseTypes.has(b.type)),
      "PL",
      (b) => b.closing_paise,
      innerForExpense,
    ),
    [balances, modeSplits],
  );
  const incomeBuckets = useMemo(
    () => groupBalances(
      balances.filter((b) => incomeTypes.has(b.type)),
      "PL",
      (b) => -b.closing_paise,
      innerForIncome,
    ),
    [balances, modeSplits],
  );

  const goLedger = (id: string) =>
    openLedgerReport(navigate, { ledgerId: id, from, to });

  const exp = groupedTRows(expenseBuckets, goLedger);
  const inc = groupedTRows(incomeBuckets, goLedger);

  const tradingGp = useMemo(() => {
    const directIncome = balances
      .filter((b) => b.type === "income_direct")
      .reduce((s, b) => s + -b.closing_paise, 0);
    const directExpense = balances
      .filter((b) => b.type === "expense_direct")
      .reduce((s, b) => s + b.closing_paise, 0);
    return directIncome + closingStock - (directExpense + openingStock);
  }, [balances, openingStock, closingStock]);

  const profit = inc.totalPaise - exp.totalPaise + tradingGp;

  const expenseRows: TRow[] = [...exp.rows];
  const incomeRows: TRow[] = [];
  if (tradingGp > 0) incomeRows.push({ label: "By Gross Profit b/d", amount: formatINR(tradingGp), emphasis: "bold" });
  if (tradingGp < 0) expenseRows.unshift({ label: "To Gross Loss b/d", amount: formatINR(-tradingGp), emphasis: "bold" });
  incomeRows.push(...inc.rows);
  if (profit > 0) expenseRows.push({ label: surplusLabel, amount: formatINR(profit), emphasis: "bold" });
  if (profit < 0) incomeRows.push({ label: deficitLabel, amount: formatINR(-profit), emphasis: "bold" });

  const grandLeft = exp.totalPaise + Math.max(0, -tradingGp) + Math.max(0, profit);
  const grandRight = inc.totalPaise + Math.max(0, tradingGp) + Math.max(0, -profit);

  const drExp = groupedExportRows(expenseBuckets, isIE ? "" : "To ");
  const crExp = groupedExportRows(incomeBuckets, isIE ? "" : "By ");
  if (tradingGp > 0) crExp.unshift({ label: "  By Gross Profit b/d", paise: 0, outerPaise: tradingGp, isSubtotal: true });
  if (tradingGp < 0) drExp.unshift({ label: "  To Gross Loss b/d", paise: 0, outerPaise: -tradingGp, isSubtotal: true });
  if (profit > 0) drExp.push({ label: `  ${surplusLabel}`, paise: 0, outerPaise: profit, isSubtotal: true });
  if (profit < 0) crExp.push({ label: `  ${deficitLabel}`, paise: 0, outerPaise: -profit, isSubtotal: true });

  const fmtInner = (row?: { paise: number; outerPaise?: number; isHeader?: boolean }) =>
    row && !row.isHeader && row.outerPaise === undefined && row.paise !== 0 ? r(row.paise).toFixed(2) : "";
  const fmtOuter = (row?: { paise: number; outerPaise?: number; isHeader?: boolean }) =>
    row && !row.isHeader && row.outerPaise !== undefined ? r(row.outerPaise).toFixed(2) : "";

  const exportBody = (): (string | number)[][] => {
    const max = Math.max(drExp.length, crExp.length);
    return Array.from({ length: max }).map((_, i) => [
      drExp[i]?.label ?? "",
      fmtInner(drExp[i]),
      fmtOuter(drExp[i]),
      crExp[i]?.label ?? "",
      fmtInner(crExp[i]),
      fmtOuter(crExp[i]),
    ]);
  };

  const csvRows = (): (string | number)[][] => [
    [`${reportTitle}: ${from} to ${to}`, "", "", "", "", ""],
    [dr, "", amountHeader(), cr, "", amountHeader()],
    ...exportBody(),
    ["Total", "", r(grandLeft).toFixed(2), "Total", "", r(grandRight).toFixed(2)],
  ];

  const fileSlug = isIE ? "income-expenditure" : "profit-loss";
  const onExportCsv = () => downloadCsv(`${fileSlug}-${from}_to_${to}.csv`, csvRows());
  const onExportXlsx = () =>
    downloadXlsx(`${fileSlug}-${from}_to_${to}.xlsx`, [{ name: isIE ? "I&E" : "P&L", rows: csvRows() }]);
  const onExportPdf = () =>
    downloadPdfTable({
      title: reportTitle,
      companyName: pdfHeader.companyName,
      companySubLine: pdfHeader.companySubLine,
      subtitle: `${from} to ${to}`,
      head: [[dr, "", amountHeader(), cr, "", amountHeader()]],
      body: exportBody(),
      foot: [["Total", "", r(grandLeft).toFixed(2), "Total", "", r(grandRight).toFixed(2)]],
      fileName: `${fileSlug}-${from}_to_${to}.pdf`,
      orientation: "l",
      rightAlignCols: [1, 2, 4, 5],
    });

  const tAccountView = (
    <TAccount
      title={reportTitle}
      subtitle={`for the period ${from} to ${to}`}
      leftHeaderLabel={dr}
      rightHeaderLabel={cr}
      leftRows={expenseRows}
      rightRows={incomeRows}
      leftTotal={formatINR(grandLeft)}
      rightTotal={formatINR(grandRight)}
    />
  );

  return (
    <ReportViewer
      title={reportTitle}
      fromDate={from}
      toDate={to}
      onExportPdf={onExportPdf}
    >
      <Card className="print:hidden">
        <CardContent className="p-3">
          <ReportToolbar
            from={from}
            to={to}
            onFrom={setFrom}
            onTo={setTo}
            onExportCsv={onExportCsv}
            onExportXlsx={onExportXlsx}
            onExportPdf={onExportPdf}
            onPrint={() => window.dispatchEvent(new CustomEvent("report:preview"))}
            extra={<div className="flex gap-3 items-end">
              <div className="space-y-1"><Label className="text-xs">View</Label><ViewSwitcher view={view} onChange={setView} classicLabel="T-Format" /></div>
              <div className="space-y-1"><Label className="text-xs">Tax Audit</Label>
                <Button size="sm" variant={taxView ? "default" : "outline"} onClick={() => setTaxView((v) => !v)}>
                  <Scale className="mr-1 h-3.5 w-3.5" />{taxView ? "On" : "Off"}
                </Button>
              </div>
            </div>}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {isIE
              ? <>Income &amp; Expenditure for the period — surplus/deficit transfers to the <strong>Corpus / General Fund</strong>.</>
              : <>Indirect Income &amp; Indirect Expenses only. Sales / Purchase / Direct Income / Direct Expenses flow through the <strong>Trading Account</strong> — its Gross Profit / Loss is carried here as b/d.</>}
          </p>
        </CardContent>
      </Card>

      {/* Screen View (Shows Grid or T-Format depending on switcher, but hides on print) */}
      <div className="print:hidden">
        {view === "grid" ? (
          <Card>
            <CardContent className="p-3">
              <BucketedGrid
                reportId="profit-loss"
                onLedgerClick={goLedger}
                sides={[
                  {
                    side: dr,
                    buckets: expenseBuckets,
                    extras: [
                      ...(tradingGp < 0 ? [{ group: "Trading", name: "Gross Loss b/d", valuePaise: -tradingGp }] : []),
                      ...(profit > 0 ? [{ group: "Result", name: surplusLabel, valuePaise: profit }] : []),
                    ],
                  },
                  {
                    side: cr,
                    buckets: incomeBuckets,
                    extras: [
                      ...(tradingGp > 0 ? [{ group: "Trading", name: "Gross Profit b/d", valuePaise: tradingGp }] : []),
                      ...(profit < 0 ? [{ group: "Result", name: deficitLabel, valuePaise: -profit }] : []),
                    ],
                  },
                ]}
              />
            </CardContent>
          </Card>
        ) : (
          tAccountView
        )}
      </div>

      {/* Print View: ALWAYS renders T-Account in side-by-side format on print */}
      <div className="hidden print:block w-full">
        {tAccountView}
      </div>

      {taxView && <div className="print:hidden"><TaxAuditPanel mode="pl" fyStart={from} fyEnd={to} /></div>}
    </ReportViewer>
  );
}
