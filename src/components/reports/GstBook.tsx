import { fmtIndianDate } from "@/lib/format-date";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ReportToolbar, useFyRangeState } from "@/components/reports/ReportToolbar";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { formatINR } from "@/lib/money";
import { downloadCsv } from "@/lib/csv";
import { downloadXlsx, downloadPdfTable, r } from "@/lib/exporters";
import { useReportPdfHeader } from "@/lib/report-pdf-header";
import { sortVouchersAsc } from "@/lib/voucher-sort";
import type { Database } from "@/integrations/supabase/types";
import { DataGrid, type DGColumn } from "@/components/data-grid/DataGrid";
import { ViewSwitcher, useReportView } from "@/components/reports/ViewSwitcher";
import {
  readVouchers,
  readVoucherItemsForCompany,
  readVoucherEntriesForCompany,
  readLedgers,
  readItems,
  withCacheFallback,
} from "@/lib/offline/cache-read";

type VoucherType = Database["public"]["Enums"]["voucher_type"];

interface Row {
  id: string;
  voucher_date: string;
  voucher_number: string;
  vendor_invoice_no: string | null;
  vendor_invoice_date: string | null;
  place_of_supply_code: string | null;
  is_interstate: boolean;
  subtotal_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  round_off_paise: number;
  total_paise: number;
  ledgers: {
    name: string;
    gstin: string | null;
    state: string | null;
    state_code: string | null;
  } | null;
  voucher_items?: { qty: number; items: { unit: string | null } | null }[];
}

export function GstBook({ kind }: { kind: "sales" | "purchase" }) {
  const { activeCompanyId } = useCompany();
  const { from, to, setFrom, setTo } = useFyRangeState();
  const pdfHeader = useReportPdfHeader();
  const [rows, setRows] = useState<Row[]>([]);
  const { view, setView } = useReportView(`gst-${kind}-book`);

  const types: VoucherType[] =
    kind === "sales" ? ["sales", "credit_note"] : ["purchase", "debit_note"];

  useEffect(() => {
    if (!activeCompanyId) return;
    (async () => {
      const { data } = await supabase
        .from("vouchers")
        .select(
          "id, voucher_date, voucher_number, vendor_invoice_no, vendor_invoice_date, place_of_supply_code, is_interstate, subtotal_paise, cgst_paise, sgst_paise, igst_paise, round_off_paise, total_paise, ledgers:party_ledger_id(name, gstin, state, state_code), voucher_entries(ledger_id, ledgers:ledger_id(type)), voucher_items(id, qty, items:item_id(unit))",
        )
        .eq("company_id", activeCompanyId)
        .in("voucher_type", types)
        .gte("voucher_date", from)
        .lte("voucher_date", to)
        .order("voucher_date", { ascending: true })
        .order("voucher_number", { ascending: true });
      // GST Sales/Purchase Book = goods only (trading stock).
      // Per GST law & accounting principles: capital goods (fixed_asset) and
      // GST-bearing expenses (expense_indirect) are tracked separately and
      // surface only in GSTR-3B / GSTR-9 ITC tables — never in the books here.
      const goodsTypes =
        kind === "sales"
          ? new Set(["income_direct"])
          : new Set(["expense_direct", "stock_in_hand"]);
      type Row2 = Row & {
        voucher_entries?: { ledgers: { type: string } | null }[];
        voucher_items?: { id: string; qty: number; items: { unit: string | null } | null }[];
      };
      const filtered = ((data || []) as unknown as Row2[]).filter((v) => {
        // Must have at least one inventory line (goods).
        if (!v.voucher_items || v.voucher_items.length === 0) return false;
        // At least one posting must hit a goods account (Sales/Purchase A/c
        // or stock); pure capital-goods / expense vouchers are excluded.
        return (v.voucher_entries || []).some((e) => e.ledgers && goodsTypes.has(e.ledgers.type));
      });
      setRows(sortVouchersAsc(filtered as Row[]));
    })();
  }, [activeCompanyId, from, to, kind]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (s, x) => ({
          taxable: s.taxable + x.subtotal_paise,
          cgst: s.cgst + x.cgst_paise,
          sgst: s.sgst + x.sgst_paise,
          igst: s.igst + x.igst_paise,
          total: s.total + x.total_paise,
        }),
        { taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 },
      ),
    [rows],
  );

  const title = kind === "sales" ? "GST Sales Book (Output Tax)" : "GST Purchase Book (Input Tax)";
  const partyLabel = kind === "sales" ? "Customer" : "Supplier";
  const billLabel = kind === "sales" ? "Invoice No." : "Bill No.";
  const billDateLabel = kind === "sales" ? "Invoice Date" : "Bill Date";
  const showQtyUnit = true;
  const qtyUnitText = (x: Row) => {
    const byUnit = new Map<string, number>();
    for (const line of x.voucher_items || []) {
      const unit = line.items?.unit || "Qty";
      byUnit.set(unit, (byUnit.get(unit) || 0) + Number(line.qty || 0));
    }
    return (
      Array.from(byUnit.entries())
        .map(([unit, qty]) => `${qty} ${unit}`)
        .join(", ") || "—"
    );
  };

  const tableRows = rows.map((x) => [
    fmtIndianDate(x.voucher_date),
    kind === "sales" ? x.voucher_number : x.vendor_invoice_no || x.voucher_number,
    fmtIndianDate(kind === "sales" ? x.voucher_date : x.vendor_invoice_date || x.voucher_date),
    x.ledgers?.name || "—",
    x.ledgers?.gstin || "—",
    ...(showQtyUnit ? [qtyUnitText(x)] : []),
    x.place_of_supply_code || x.ledgers?.state_code || "—",
    x.is_interstate ? "Inter" : "Intra",
    r(x.subtotal_paise),
    r(x.cgst_paise),
    r(x.sgst_paise),
    r(x.igst_paise),
    r(x.total_paise),
  ]);

  const headers = [
    "Date",
    billLabel,
    billDateLabel,
    partyLabel,
    "GSTIN",
    ...(showQtyUnit ? ["Qty / Unit"] : []),
    "POS",
    "Type",
    "Taxable",
    "CGST",
    "SGST",
    "IGST",
    "Invoice Total",
  ];

  const onCsv = () => {
    downloadCsv(`${title.replace(/\s+/g, "_")}_${from}_to_${to}.csv`, [headers, ...tableRows]);
  };
  const onXlsx = () => {
    downloadXlsx(`${title.replace(/\s+/g, "_")}_${from}_to_${to}.xlsx`, [
      { name: kind === "sales" ? "Sales Book" : "Purchase Book", rows: [headers, ...tableRows] },
    ]);
  };
  const onPdf = () => {
    downloadPdfTable({
      fileName: `${title.replace(/\s+/g, "_")}_${from}_to_${to}.pdf`,
      title,
      subtitle: pdfHeader.dateRangeSubtitle(from, to),
      companyName: pdfHeader.companyName,
      companySubLine: pdfHeader.companySubLine,
      head: [headers],
      body: tableRows,
    });
  };

  const gridColumns: DGColumn<Row>[] = useMemo(
    () => [
      {
        id: "date",
        header: "Date",
        type: "date",
        width: 110,
        accessor: (x) => x.voucher_date,
        cell: (x) => fmtIndianDate(x.voucher_date),
      },
      {
        id: "billNo",
        header: billLabel,
        type: "text",
        width: 130,
        accessor: (x) =>
          kind === "sales" ? x.voucher_number : x.vendor_invoice_no || x.voucher_number,
      },
      {
        id: "billDate",
        header: billDateLabel,
        type: "date",
        width: 110,
        accessor: (x) =>
          kind === "sales" ? x.voucher_date : x.vendor_invoice_date || x.voucher_date,
        cell: (x) =>
          fmtIndianDate(
            kind === "sales" ? x.voucher_date : x.vendor_invoice_date || x.voucher_date,
          ),
      },
      {
        id: "party",
        header: partyLabel,
        type: "text",
        width: 220,
        accessor: (x) => x.ledgers?.name ?? "",
        groupable: true,
        cell: (x) => x.ledgers?.name ?? "—",
      },
      {
        id: "gstin",
        header: "GSTIN",
        type: "text",
        width: 150,
        accessor: (x) => x.ledgers?.gstin ?? "",
      },
      ...(showQtyUnit
        ? [
            {
              id: "qty",
              header: "Qty / Unit",
              type: "text" as const,
              width: 130,
              accessor: qtyUnitText,
            },
          ]
        : []),
      {
        id: "pos",
        header: "POS",
        type: "text",
        width: 80,
        accessor: (x) => x.place_of_supply_code || x.ledgers?.state_code || "",
        groupable: true,
      },
      {
        id: "type",
        header: "Type",
        type: "enum",
        width: 80,
        accessor: (x) => (x.is_interstate ? "Inter" : "Intra"),
        groupable: true,
      },
      {
        id: "taxable",
        header: "Taxable",
        type: "number",
        width: 130,
        align: "right",
        accessor: (x) => x.subtotal_paise / 100,
        cell: (x) => formatINR(x.subtotal_paise),
        aggregator: "sum",
        formatAggregate: (v) => formatINR(Math.round(v * 100)),
      },
      {
        id: "cgst",
        header: "CGST",
        type: "number",
        width: 110,
        align: "right",
        accessor: (x) => x.cgst_paise / 100,
        cell: (x) => formatINR(x.cgst_paise),
        aggregator: "sum",
        formatAggregate: (v) => formatINR(Math.round(v * 100)),
      },
      {
        id: "sgst",
        header: "SGST",
        type: "number",
        width: 110,
        align: "right",
        accessor: (x) => x.sgst_paise / 100,
        cell: (x) => formatINR(x.sgst_paise),
        aggregator: "sum",
        formatAggregate: (v) => formatINR(Math.round(v * 100)),
      },
      {
        id: "igst",
        header: "IGST",
        type: "number",
        width: 110,
        align: "right",
        accessor: (x) => x.igst_paise / 100,
        cell: (x) => formatINR(x.igst_paise),
        aggregator: "sum",
        formatAggregate: (v) => formatINR(Math.round(v * 100)),
      },
      {
        id: "total",
        header: "Invoice Total",
        type: "number",
        width: 140,
        align: "right",
        accessor: (x) => x.total_paise / 100,
        cell: (x) => formatINR(x.total_paise),
        aggregator: "sum",
        formatAggregate: (v) => formatINR(Math.round(v * 100)),
      },
    ],
    [kind, billLabel, billDateLabel, partyLabel, showQtyUnit],
  );

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-3 print:hidden">
          <div className="mb-2 text-base font-semibold">{title}</div>
          <ReportToolbar
            from={from}
            to={to}
            onFrom={setFrom}
            onTo={setTo}
            onExportCsv={onCsv}
            onExportXlsx={onXlsx}
            onExportPdf={onPdf}
            onPrint={() => window.print()}
          />
          <div className="mt-2">
            <ViewSwitcher view={view} onChange={setView} />
          </div>
        </CardContent>
      </Card>

      {view === "grid" ? (
        <Card>
          <CardContent className="p-3">
            <DataGrid
              reportId={`gst-${kind}-book`}
              rows={rows}
              columns={gridColumns}
              globalSearch={(x) =>
                `${x.voucher_number} ${x.vendor_invoice_no ?? ""} ${x.ledgers?.name ?? ""} ${x.ledgers?.gstin ?? ""}`
              }
              height={520}
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[90px]">Date</TableHead>
                    <TableHead className="w-[110px]">{billLabel}</TableHead>
                    <TableHead>{partyLabel}</TableHead>
                    {showQtyUnit && <TableHead className="w-[110px]">Qty / Unit</TableHead>}
                    <TableHead className="w-[110px] text-right">Taxable</TableHead>
                    <TableHead className="w-[95px] text-right">CGST</TableHead>
                    <TableHead className="w-[95px] text-right">SGST</TableHead>
                    <TableHead className="w-[95px] text-right">IGST</TableHead>
                    <TableHead className="w-[115px] text-right">Invoice Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                        No entries in this period.
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((x) => (
                      <TableRow key={x.id}>
                        <TableCell className="whitespace-nowrap">
                          {fmtIndianDate(x.voucher_date)}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {kind === "sales"
                            ? x.voucher_number
                            : x.vendor_invoice_no || x.voucher_number}
                        </TableCell>
                        <TableCell>
                          <div className="truncate max-w-[280px]">{x.ledgers?.name || "—"}</div>
                          {x.ledgers?.gstin && (
                            <div className="font-mono text-[10px] text-muted-foreground">
                              {x.ledgers.gstin}
                              {x.is_interstate ? " · Inter" : " · Intra"}
                            </div>
                          )}
                        </TableCell>
                        {showQtyUnit && (
                          <TableCell className="font-mono text-xs whitespace-nowrap">
                            {qtyUnitText(x)}
                          </TableCell>
                        )}
                        <TableCell className="text-right tabular-nums">
                          {formatINR(x.subtotal_paise)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatINR(x.cgst_paise)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatINR(x.sgst_paise)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatINR(x.igst_paise)}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatINR(x.total_paise)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
                {rows.length > 0 && (
                  <tfoot>
                    <TableRow className="font-semibold border-t-2">
                      <TableCell colSpan={showQtyUnit ? 4 : 3} className="text-right">
                        Totals
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatINR(totals.taxable)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatINR(totals.cgst)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatINR(totals.sgst)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatINR(totals.igst)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatINR(totals.total)}
                      </TableCell>
                    </TableRow>
                  </tfoot>
                )}
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
