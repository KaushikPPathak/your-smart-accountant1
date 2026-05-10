import { fmtIndianDate } from "@/lib/format-date";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ReportToolbar, useFyRangeState } from "@/components/reports/ReportToolbar";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { formatINR } from "@/lib/money";
import { downloadCsv } from "@/lib/csv";
import { downloadXlsx, downloadPdfTable, r } from "@/lib/exporters";
import { useReportPdfHeader } from "@/lib/report-pdf-header";
import { sortVouchersAsc } from "@/lib/voucher-sort";
import type { Database } from "@/integrations/supabase/types";

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
  ledgers: { name: string; gstin: string | null; state: string | null; state_code: string | null } | null;
}

export function GstBook({ kind }: { kind: "sales" | "purchase" }) {
  const { activeCompanyId, activeMembership } = useCompany();
  const { from, to, setFrom, setTo } = useFyRangeState();
  const pdfHeader = useReportPdfHeader();
  const [rows, setRows] = useState<Row[]>([]);

  const types: VoucherType[] = kind === "sales" ? ["sales", "credit_note"] : ["purchase", "debit_note"];

  useEffect(() => {
    if (!activeCompanyId) return;
    supabase
      .from("vouchers")
      .select(
        "id, voucher_date, voucher_number, vendor_invoice_no, vendor_invoice_date, place_of_supply_code, is_interstate, subtotal_paise, cgst_paise, sgst_paise, igst_paise, round_off_paise, total_paise, ledgers:party_ledger_id(name, gstin, state, state_code)",
      )
      .eq("company_id", activeCompanyId)
      .in("voucher_type", types)
      .gte("voucher_date", from)
      .lte("voucher_date", to)
      .order("voucher_date", { ascending: true }).order("voucher_number", { ascending: true })
      .then(({ data }) => setRows(sortVouchersAsc((data || []) as unknown as Row[])));
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

  const tableRows = rows.map((x) => [
    fmtIndianDate(x.voucher_date),
    kind === "sales" ? x.voucher_number : (x.vendor_invoice_no || x.voucher_number),
    fmtIndianDate(kind === "sales" ? x.voucher_date : (x.vendor_invoice_date || x.voucher_date)),
    x.ledgers?.name || "—",
    x.ledgers?.gstin || "—",
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
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>{billLabel}</TableHead>
                  <TableHead>{billDateLabel}</TableHead>
                  <TableHead>{partyLabel}</TableHead>
                  <TableHead>GSTIN</TableHead>
                  <TableHead>POS</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Taxable</TableHead>
                  <TableHead className="text-right">CGST</TableHead>
                  <TableHead className="text-right">SGST</TableHead>
                  <TableHead className="text-right">IGST</TableHead>
                  <TableHead className="text-right">Invoice Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={12} className="text-center text-muted-foreground py-8">
                      No entries in this period.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((x) => (
                    <TableRow key={x.id}>
                      <TableCell className="whitespace-nowrap">{fmtIndianDate(x.voucher_date)}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {kind === "sales" ? x.voucher_number : x.vendor_invoice_no || x.voucher_number}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {fmtIndianDate(kind === "sales" ? x.voucher_date : x.vendor_invoice_date || x.voucher_date)}
                      </TableCell>
                      <TableCell>{x.ledgers?.name || "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{x.ledgers?.gstin || "—"}</TableCell>
                      <TableCell className="text-xs">{x.place_of_supply_code || x.ledgers?.state_code || "—"}</TableCell>
                      <TableCell className="text-xs">{x.is_interstate ? "Inter" : "Intra"}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatINR(x.subtotal_paise)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatINR(x.cgst_paise)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatINR(x.sgst_paise)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatINR(x.igst_paise)}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{formatINR(x.total_paise)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
              {rows.length > 0 && (
                <tfoot>
                  <TableRow className="font-semibold border-t-2">
                    <TableCell colSpan={7} className="text-right">Totals</TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(totals.taxable)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(totals.cgst)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(totals.sgst)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(totals.igst)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(totals.total)}</TableCell>
                  </TableRow>
                </tfoot>
              )}
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}