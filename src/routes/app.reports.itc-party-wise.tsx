import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ReportToolbar, useFyRangeState } from "@/components/reports/ReportToolbar";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { useReportPdfHeader } from "@/lib/report-pdf-header";
import { formatINR } from "@/lib/money";
import { downloadCsv } from "@/lib/csv";
import { downloadPdfTable, downloadXlsx, r } from "@/lib/exporters";
import { amountHeader } from "@/lib/export-format";
import { DataGrid, type DGColumn } from "@/components/data-grid/DataGrid";

export const Route = createFileRoute("/app/reports/itc-party-wise")({
  head: () => ({ meta: [{ title: "Party-wise ITC — Reports" }] }),
  component: ItcPartyWise,
});

interface VRow {
  voucher_type: string;
  party_ledger_id: string | null;
  subtotal_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  ledgers: { name: string; gstin: string | null; state_code: string | null; type: string } | null;
}

function ItcPartyWise() {
  const { activeCompanyId } = useCompany();
  const pdfHeader = useReportPdfHeader();
  const { from, to, setFrom, setTo } = useFyRangeState();
  const [vouchers, setVouchers] = useState<VRow[]>([]);

  useEffect(() => {
    if (!activeCompanyId) return;
    supabase
      .from("vouchers")
      .select(
        "voucher_type, party_ledger_id, subtotal_paise, cgst_paise, sgst_paise, igst_paise, ledgers:party_ledger_id(name, gstin, state_code, type)",
      )
      .eq("company_id", activeCompanyId)
      .in("voucher_type", ["purchase", "debit_note", "sales", "credit_note"])
      .gte("voucher_date", from)
      .lte("voucher_date", to)
      .then(({ data }) => setVouchers((data || []) as unknown as VRow[]));
  }, [activeCompanyId, from, to]);

  const rows = useMemo(() => {
    const map = new Map<string, {
      id: string; name: string; gstin: string; state: string; party_type: string;
      purTaxable: number; availCgst: number; availSgst: number; availIgst: number; availed: number;
      salTaxable: number; outCgst: number; outSgst: number; outIgst: number; spent: number;
      net: number;
    }>();

    for (const v of vouchers) {
      const pid = v.party_ledger_id || "__none__";
      const cur = map.get(pid) || {
        id: pid,
        name: v.ledgers?.name || "(No party)",
        gstin: v.ledgers?.gstin || "",
        state: v.ledgers?.state_code || "",
        party_type: v.ledgers?.type || "",
        purTaxable: 0, availCgst: 0, availSgst: 0, availIgst: 0, availed: 0,
        salTaxable: 0, outCgst: 0, outSgst: 0, outIgst: 0, spent: 0,
        net: 0,
      };
      const tax = Number(v.subtotal_paise) || 0;
      const cgst = Number(v.cgst_paise) || 0;
      const sgst = Number(v.sgst_paise) || 0;
      const igst = Number(v.igst_paise) || 0;
      const sign = v.voucher_type === "debit_note" || v.voucher_type === "credit_note" ? -1 : 1;

      if (v.voucher_type === "purchase" || v.voucher_type === "debit_note") {
        cur.purTaxable += sign * tax;
        cur.availCgst += sign * cgst;
        cur.availSgst += sign * sgst;
        cur.availIgst += sign * igst;
      } else if (v.voucher_type === "sales" || v.voucher_type === "credit_note") {
        cur.salTaxable += sign * tax;
        cur.outCgst += sign * cgst;
        cur.outSgst += sign * sgst;
        cur.outIgst += sign * igst;
      }
      cur.availed = cur.availCgst + cur.availSgst + cur.availIgst;
      cur.spent = cur.outCgst + cur.outSgst + cur.outIgst;
      cur.net = cur.availed - cur.spent;
      map.set(pid, cur);
    }

    return Array.from(map.values())
      .filter((x) => x.availed !== 0 || x.spent !== 0)
      .sort((a, b) => b.availed - a.availed);
  }, [vouchers]);

  type RowVm = (typeof rows)[number];

  const totals = useMemo(
    () =>
      rows.reduce(
        (a, x) => ({
          purTaxable: a.purTaxable + x.purTaxable,
          availCgst: a.availCgst + x.availCgst,
          availSgst: a.availSgst + x.availSgst,
          availIgst: a.availIgst + x.availIgst,
          availed: a.availed + x.availed,
          salTaxable: a.salTaxable + x.salTaxable,
          outCgst: a.outCgst + x.outCgst,
          outSgst: a.outSgst + x.outSgst,
          outIgst: a.outIgst + x.outIgst,
          spent: a.spent + x.spent,
          net: a.net + x.net,
        }),
        { purTaxable: 0, availCgst: 0, availSgst: 0, availIgst: 0, availed: 0, salTaxable: 0, outCgst: 0, outSgst: 0, outIgst: 0, spent: 0, net: 0 },
      ),
    [rows],
  );

  const gridColumns: DGColumn<RowVm>[] = useMemo(
    () => [
      { id: "name", header: "Party", type: "text", width: 240, accessor: (x) => x.name },
      { id: "gstin", header: "GSTIN", type: "text", width: 150, accessor: (x) => x.gstin },
      { id: "state", header: "State", type: "text", width: 70, accessor: (x) => x.state, groupable: true },
      { id: "ptype", header: "Type", type: "enum", width: 130, accessor: (x) => x.party_type, groupable: true },
      { id: "purT", header: "Purchase Taxable", type: "number", width: 150, align: "right", accessor: (x) => x.purTaxable / 100, cell: (x) => formatINR(x.purTaxable), aggregator: "sum", formatAggregate: (v) => formatINR(Math.round(v * 100)) },
      { id: "aCgst", header: "ITC CGST", type: "number", width: 110, align: "right", accessor: (x) => x.availCgst / 100, cell: (x) => formatINR(x.availCgst), aggregator: "sum", formatAggregate: (v) => formatINR(Math.round(v * 100)) },
      { id: "aSgst", header: "ITC SGST", type: "number", width: 110, align: "right", accessor: (x) => x.availSgst / 100, cell: (x) => formatINR(x.availSgst), aggregator: "sum", formatAggregate: (v) => formatINR(Math.round(v * 100)) },
      { id: "aIgst", header: "ITC IGST", type: "number", width: 110, align: "right", accessor: (x) => x.availIgst / 100, cell: (x) => formatINR(x.availIgst), aggregator: "sum", formatAggregate: (v) => formatINR(Math.round(v * 100)) },
      { id: "aTot", header: "ITC Availed", type: "number", width: 130, align: "right", accessor: (x) => x.availed / 100, cell: (x) => formatINR(x.availed), aggregator: "sum", formatAggregate: (v) => formatINR(Math.round(v * 100)) },
      { id: "salT", header: "Sales Taxable", type: "number", width: 140, align: "right", accessor: (x) => x.salTaxable / 100, cell: (x) => formatINR(x.salTaxable), aggregator: "sum", formatAggregate: (v) => formatINR(Math.round(v * 100)) },
      { id: "oCgst", header: "Output CGST", type: "number", width: 120, align: "right", accessor: (x) => x.outCgst / 100, cell: (x) => formatINR(x.outCgst), aggregator: "sum", formatAggregate: (v) => formatINR(Math.round(v * 100)) },
      { id: "oSgst", header: "Output SGST", type: "number", width: 120, align: "right", accessor: (x) => x.outSgst / 100, cell: (x) => formatINR(x.outSgst), aggregator: "sum", formatAggregate: (v) => formatINR(Math.round(v * 100)) },
      { id: "oIgst", header: "Output IGST", type: "number", width: 120, align: "right", accessor: (x) => x.outIgst / 100, cell: (x) => formatINR(x.outIgst), aggregator: "sum", formatAggregate: (v) => formatINR(Math.round(v * 100)) },
      { id: "spent", header: "Output Tax", type: "number", width: 130, align: "right", accessor: (x) => x.spent / 100, cell: (x) => formatINR(x.spent), aggregator: "sum", formatAggregate: (v) => formatINR(Math.round(v * 100)) },
      { id: "net", header: "Net (Avail − Out)", type: "number", width: 140, align: "right", accessor: (x) => x.net / 100, cell: (x) => formatINR(x.net), aggregator: "sum", formatAggregate: (v) => formatINR(Math.round(v * 100)) },
    ],
    [],
  );

  const csvRows = (): (string | number)[][] => [
    [`Party-wise ITC Availed vs Output Tax — ${from} to ${to}`],
    ["Party", "GSTIN", "State", "Type", "Purchase Taxable", "ITC CGST", "ITC SGST", "ITC IGST", "ITC Availed", "Sales Taxable", "Output CGST", "Output SGST", "Output IGST", "Output Tax", "Net"],
    ...rows.map((x) => [x.name, x.gstin, x.state, x.party_type, (x.purTaxable / 100).toFixed(2), (x.availCgst / 100).toFixed(2), (x.availSgst / 100).toFixed(2), (x.availIgst / 100).toFixed(2), (x.availed / 100).toFixed(2), (x.salTaxable / 100).toFixed(2), (x.outCgst / 100).toFixed(2), (x.outSgst / 100).toFixed(2), (x.outIgst / 100).toFixed(2), (x.spent / 100).toFixed(2), (x.net / 100).toFixed(2)]),
    ["TOTAL", "", "", "", (totals.purTaxable / 100).toFixed(2), (totals.availCgst / 100).toFixed(2), (totals.availSgst / 100).toFixed(2), (totals.availIgst / 100).toFixed(2), (totals.availed / 100).toFixed(2), (totals.salTaxable / 100).toFixed(2), (totals.outCgst / 100).toFixed(2), (totals.outSgst / 100).toFixed(2), (totals.outIgst / 100).toFixed(2), (totals.spent / 100).toFixed(2), (totals.net / 100).toFixed(2)],
  ];

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-3">
          <ReportToolbar
            from={from} to={to} onFrom={setFrom} onTo={setTo}
            onExportCsv={() => downloadCsv(`itc-party-wise-${from}-to-${to}.csv`, csvRows())}
            onExportXlsx={() => downloadXlsx(`itc-party-wise-${from}-to-${to}.xlsx`, [{ name: "ITC Party-wise", rows: csvRows() }])}
            onExportPdf={() =>
              downloadPdfTable({
                title: "Party-wise ITC Availed vs Output Tax",
                companyName: pdfHeader.companyName,
                companySubLine: pdfHeader.companySubLine,
                subtitle: `${from} to ${to}`,
                head: [["Party", "GSTIN", "State", "Type", amountHeader("Pur Tax."), amountHeader("ITC CGST"), amountHeader("ITC SGST"), amountHeader("ITC IGST"), amountHeader("ITC Availed"), amountHeader("Sale Tax."), amountHeader("Out CGST"), amountHeader("Out SGST"), amountHeader("Out IGST"), amountHeader("Output Tax"), amountHeader("Net")]],
                body: rows.map((x) => [x.name, x.gstin, x.state, x.party_type, r(x.purTaxable).toFixed(2), r(x.availCgst).toFixed(2), r(x.availSgst).toFixed(2), r(x.availIgst).toFixed(2), r(x.availed).toFixed(2), r(x.salTaxable).toFixed(2), r(x.outCgst).toFixed(2), r(x.outSgst).toFixed(2), r(x.outIgst).toFixed(2), r(x.spent).toFixed(2), r(x.net).toFixed(2)]),
                foot: [["TOTAL", "", "", "", r(totals.purTaxable).toFixed(2), r(totals.availCgst).toFixed(2), r(totals.availSgst).toFixed(2), r(totals.availIgst).toFixed(2), r(totals.availed).toFixed(2), r(totals.salTaxable).toFixed(2), r(totals.outCgst).toFixed(2), r(totals.outSgst).toFixed(2), r(totals.outIgst).toFixed(2), r(totals.spent).toFixed(2), r(totals.net).toFixed(2)]],
                fileName: `itc-party-wise-${from}-to-${to}.pdf`,
                orientation: "l",
                rightAlignCols: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
              })
            }
            onPrint={() => window.print()}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            ITC Availed = input GST on Purchases from supplier (net of Debit Notes). Output Tax = GST collected on Sales to
            customer (net of Credit Notes). Suppliers usually show only Availed; customers usually show only Output Tax.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-3">
          <DataGrid
            reportId="itc-party-wise"
            rows={rows}
            columns={gridColumns}
            globalSearch={(x) => `${x.name} ${x.gstin} ${x.state}`}
            height={560}
          />
        </CardContent>
      </Card>
    </div>
  );
}
