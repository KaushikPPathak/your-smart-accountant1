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
import { ReportViewer } from "@/components/reports/ReportViewer";
import { RegisterPrintTable, toRegisterLine } from "@/components/reports/RegisterPrintTable";
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
    type?: string | null;
  } | null;
  reference_no?: string | null;
  voucher_items?: { qty: number; items: { name?: string; unit: string | null } | null }[];
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
      const goodsTypes =
        kind === "sales"
          ? new Set(["income_direct"])
          : new Set(["expense_direct", "stock_in_hand"]);
      type Row2 = Row & {
        voucher_entries?: { ledgers: { type: string } | null }[];
        voucher_items?: { id: string; qty: number; items: { name?: string; unit: string | null } | null }[];
      };
      const data = await withCacheFallback<Row2[]>(
        async () => {
          const { data } = await supabase
            .from("vouchers")
            .select(
              "id, voucher_date, voucher_number, reference_no, vendor_invoice_no, vendor_invoice_date, place_of_supply_code, is_interstate, subtotal_paise, cgst_paise, sgst_paise, igst_paise, round_off_paise, total_paise, ledgers:party_ledger_id(name, gstin, state, state_code, type), voucher_entries(ledger_id, ledgers:ledger_id(type)), voucher_items(id, qty, items:item_id(name, unit))",
            )
            .eq("company_id", activeCompanyId)
            .in("voucher_type", types)
            .gte("voucher_date", from)
            .lte("voucher_date", to)
            .order("voucher_date", { ascending: true })
            .order("voucher_number", { ascending: true });
          return (data || []) as unknown as Row2[];
        },
        async () => {
          const [vouchers, allItems, allEntries, ledgers, itemsMaster] = await Promise.all([
            readVouchers(activeCompanyId, { from, to }),
            readVoucherItemsForCompany(activeCompanyId),
            readVoucherEntriesForCompany(activeCompanyId),
            readLedgers(activeCompanyId),
            readItems(activeCompanyId),
          ]);
          const ledgerById = new Map((ledgers as any[]).map((l) => [String(l.id), l]));
          const itemById = new Map((itemsMaster as any[]).map((i) => [String(i.id), i]));
          const itemsByVoucher = new Map<string, any[]>();
          for (const it of allItems as any[]) {
            const vid = String(it.voucher_id);
            (itemsByVoucher.get(vid) ?? itemsByVoucher.set(vid, []).get(vid)!).push(it);
          }
          const entriesByVoucher = new Map<string, any[]>();
          for (const e of allEntries as any[]) {
            const vid = String(e.voucher_id);
            (entriesByVoucher.get(vid) ?? entriesByVoucher.set(vid, []).get(vid)!).push(e);
          }
          const typeSet = new Set<string>(types as unknown as string[]);
          return (vouchers as any[])
            .filter((v) => typeSet.has(String(v.voucher_type)))
            .map((v) => {
              const party = v.party_ledger_id ? ledgerById.get(String(v.party_ledger_id)) : null;
              const items = (itemsByVoucher.get(String(v.id)) || []).map((li) => {
                const master = li.item_id ? itemById.get(String(li.item_id)) : null;
                return {
                  id: String(li.id),
                  qty: Number(li.qty || 0),
                  items: master ? { name: master.name ?? "", unit: master.unit ?? null } : null,
                };
              });
              const entries = (entriesByVoucher.get(String(v.id)) || []).map((e) => {
                const led = e.ledger_id ? ledgerById.get(String(e.ledger_id)) : null;
                return { ledgers: led ? { type: String(led.type) } : null };
              });
              return {
                id: String(v.id),
                voucher_date: String(v.voucher_date),
                voucher_number: String(v.voucher_number ?? ""),
                reference_no: v.reference_no ?? null,
                vendor_invoice_no: v.vendor_invoice_no ?? null,
                vendor_invoice_date: v.vendor_invoice_date ?? null,
                place_of_supply_code: v.place_of_supply_code ?? null,
                is_interstate: Boolean(v.is_interstate),
                subtotal_paise: Number(v.subtotal_paise || 0),
                cgst_paise: Number(v.cgst_paise || 0),
                sgst_paise: Number(v.sgst_paise || 0),
                igst_paise: Number(v.igst_paise || 0),
                round_off_paise: Number(v.round_off_paise || 0),
                total_paise: Number(v.total_paise || 0),
                ledgers: party
                  ? {
                      name: party.name,
                      gstin: party.gstin ?? null,
                      state: party.state ?? null,
                      state_code: party.state_code ?? null,
                      type: party.type ?? null,
                    }
                  : null,
                voucher_entries: entries,
                voucher_items: items,
              } as Row2;
            });
        },
      );
      // GST Sales/Purchase Book = goods only (trading stock).
      const filtered = (data || []).filter((v) => {
        if (!v.voucher_items || v.voucher_items.length === 0) return false;
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
    <ReportViewer title={title} fromDate={from} toDate={to} onExportPdf={onPdf}>
    <div className="space-y-3">
      <Card className="print:hidden">
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
            onPrint={() => window.dispatchEvent(new CustomEvent("report:preview"))}
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
          <CardContent className="p-2">
            <RegisterPrintTable
              lines={rows.map(toRegisterLine)}
              withGst
              partyLabel={kind === "purchase" ? "Supplier Name" : "Customer Name"}
            />
          </CardContent>
        </Card>
      )}
    </div>
    </ReportViewer>
  );
}
