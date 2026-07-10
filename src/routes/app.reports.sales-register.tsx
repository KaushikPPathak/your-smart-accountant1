import { openVoucherDetail } from "@/lib/voucher-return";
import { fmtIndianDate } from "@/lib/format-date";
import { sortVouchersAsc } from "@/lib/voucher-sort";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
import { useReportPdfHeader } from "@/lib/report-pdf-header";
import { formatINR } from "@/lib/money";
import { downloadCsv } from "@/lib/csv";
import { downloadPdfTable, downloadXlsx, r } from "@/lib/exporters";
import { DataGrid, type DGColumn } from "@/components/data-grid/DataGrid";
import { ViewSwitcher, useReportView } from "@/components/reports/ViewSwitcher";
import {
  readVouchers,
  readVoucherItemsForCompany,
  readLedgers,
  readItems,
  withCacheFallback,
} from "@/lib/offline/cache-read";

export const Route = createFileRoute("/app/reports/sales-register")({
  head: () => ({ meta: [{ title: "Sales Register — Reports" }] }),
  component: () => <Register kind="sales" />,
});

interface VRow {
  id: string;
  voucher_date: string;
  voucher_number: string;
  subtotal_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  total_paise: number;
  ledgers: { name: string; gstin: string | null } | null;
  voucher_items: {
    qty: number;
    taxable_paise: number;
    cgst_paise: number;
    sgst_paise: number;
    igst_paise: number;
    gst_rate: number;
    items: { hsn_code: string | null; name: string; unit: string | null } | null;
  }[];
}

export function Register({ kind }: { kind: "sales" | "purchase" }) {
  const navigate = useNavigate();
  const { activeCompanyId } = useCompany();
  const pdfHeader = useReportPdfHeader();
  const { from, to, setFrom, setTo } = useFyRangeState();
  const [rows, setRows] = useState<VRow[]>([]);
  const { view, setView } = useReportView(`${kind}-register`);

  useEffect(() => {
    if (!activeCompanyId) return;
    (async () => {
      const data = await withCacheFallback<VRow[]>(
        async () => {
          const { data } = await supabase
            .from("vouchers")
            .select(
              "id, voucher_date, voucher_number, subtotal_paise, cgst_paise, sgst_paise, igst_paise, total_paise, ledgers:party_ledger_id(name, gstin), voucher_items(qty, taxable_paise, cgst_paise, sgst_paise, igst_paise, gst_rate, items:item_id(hsn_code, name, unit))",
            )
            .eq("company_id", activeCompanyId)
            .eq("voucher_type", kind)
            .gte("voucher_date", from)
            .lte("voucher_date", to);
          return (data || []) as unknown as VRow[];
        },
        async () => {
          const [vouchers, allItems, ledgers, itemsMaster] = await Promise.all([
            readVouchers(activeCompanyId, { voucher_type: kind, from, to }),
            readVoucherItemsForCompany(activeCompanyId),
            readLedgers(activeCompanyId),
            readItems(activeCompanyId),
          ]);
          const ledgerById = new Map((ledgers as any[]).map((l) => [String(l.id), l]));
          const itemById = new Map((itemsMaster as any[]).map((i) => [String(i.id), i]));
          const itemsByVoucher = new Map<string, any[]>();
          for (const it of allItems as any[]) {
            const vid = String(it.voucher_id);
            if (!itemsByVoucher.has(vid)) itemsByVoucher.set(vid, []);
            itemsByVoucher.get(vid)!.push(it);
          }
          return (vouchers as any[]).map((v) => {
            const party = v.party_ledger_id ? ledgerById.get(String(v.party_ledger_id)) : null;
            const lines = (itemsByVoucher.get(String(v.id)) || []).map((li) => {
              const master = li.item_id ? itemById.get(String(li.item_id)) : null;
              return {
                qty: Number(li.qty || 0),
                taxable_paise: Number(li.taxable_paise || 0),
                cgst_paise: Number(li.cgst_paise || 0),
                sgst_paise: Number(li.sgst_paise || 0),
                igst_paise: Number(li.igst_paise || 0),
                gst_rate: Number(li.gst_rate || 0),
                items: master
                  ? { hsn_code: master.hsn_code ?? null, name: master.name ?? "", unit: master.unit ?? null }
                  : null,
              };
            });
            return {
              id: String(v.id),
              voucher_date: String(v.voucher_date),
              voucher_number: String(v.voucher_number ?? ""),
              subtotal_paise: Number(v.subtotal_paise || 0),
              cgst_paise: Number(v.cgst_paise || 0),
              sgst_paise: Number(v.sgst_paise || 0),
              igst_paise: Number(v.igst_paise || 0),
              total_paise: Number(v.total_paise || 0),
              ledgers: party ? { name: party.name, gstin: party.gstin ?? null } : null,
              voucher_items: lines,
            } as VRow;
          });
        },
      );
      setRows(sortVouchersAsc(data));
    })();
  }, [activeCompanyId, from, to, kind]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (s, x) => ({
          sub: s.sub + x.subtotal_paise,
          cgst: s.cgst + x.cgst_paise,
          sgst: s.sgst + x.sgst_paise,
          igst: s.igst + x.igst_paise,
          total: s.total + x.total_paise,
        }),
        { sub: 0, cgst: 0, sgst: 0, igst: 0, total: 0 },
      ),
    [rows],
  );

  // HSN summary
  const hsn = useMemo(() => {
    const map = new Map<
      string,
      {
        hsn: string;
        qty: number;
        taxable: number;
        cgst: number;
        sgst: number;
        igst: number;
        rate: number;
      }
    >();
    for (const v of rows) {
      for (const it of v.voucher_items || []) {
        const key = `${it.items?.hsn_code || "—"}|${it.gst_rate}`;
        const cur = map.get(key) ?? {
          hsn: it.items?.hsn_code || "—",
          qty: 0,
          taxable: 0,
          cgst: 0,
          sgst: 0,
          igst: 0,
          rate: it.gst_rate,
        };
        cur.qty += Number(it.qty);
        cur.taxable += it.taxable_paise;
        cur.cgst += it.cgst_paise;
        cur.sgst += it.sgst_paise;
        cur.igst += it.igst_paise;
        map.set(key, cur);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.hsn.localeCompare(b.hsn));
  }, [rows]);

  const title = kind === "sales" ? "Sales Register" : "Purchase Register";
  const slug = kind === "sales" ? "sales-register" : "purchase-register";
  const showQtyUnit = true;
  const qtyUnitText = (x: VRow) => {
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

  const gridColumns: DGColumn<VRow>[] = useMemo(
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
        id: "number",
        header: "Number",
        type: "text",
        width: 130,
        accessor: (x) => x.voucher_number,
      },
      {
        id: "party",
        header: "Party",
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
        header: "Total",
        type: "number",
        width: 140,
        align: "right",
        accessor: (x) => x.total_paise / 100,
        cell: (x) => formatINR(x.total_paise),
        aggregator: "sum",
        formatAggregate: (v) => formatINR(Math.round(v * 100)),
      },
    ],
    [showQtyUnit],
  );

  const head = [
    "Date",
    "Number",
    "Party",
    "GSTIN",
    ...(showQtyUnit ? ["Qty / Unit"] : []),
    "Taxable",
    "CGST",
    "SGST",
    "IGST",
    "Total",
  ];
  const body = (): (string | number)[][] => [
    head,
    ...rows.map((x) => [
      fmtIndianDate(x.voucher_date),
      x.voucher_number,
      x.ledgers?.name ?? "",
      x.ledgers?.gstin ?? "",
      ...(showQtyUnit ? [qtyUnitText(x)] : []),
      (x.subtotal_paise / 100).toFixed(2),
      (x.cgst_paise / 100).toFixed(2),
      (x.sgst_paise / 100).toFixed(2),
      (x.igst_paise / 100).toFixed(2),
      (x.total_paise / 100).toFixed(2),
    ]),
    [
      "TOTAL",
      "",
      "",
      "",
      ...(showQtyUnit ? [""] : []),
      (totals.sub / 100).toFixed(2),
      (totals.cgst / 100).toFixed(2),
      (totals.sgst / 100).toFixed(2),
      (totals.igst / 100).toFixed(2),
      (totals.total / 100).toFixed(2),
    ],
    [],
    ["HSN Summary"],
    ["HSN", "Rate %", "Qty", "Taxable", "CGST", "SGST", "IGST"],
    ...hsn.map((h) => [
      h.hsn,
      h.rate,
      h.qty,
      (h.taxable / 100).toFixed(2),
      (h.cgst / 100).toFixed(2),
      (h.sgst / 100).toFixed(2),
      (h.igst / 100).toFixed(2),
    ]),
  ];

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-3">
          <ReportToolbar
            from={from}
            to={to}
            onFrom={setFrom}
            onTo={setTo}
            onExportCsv={() => downloadCsv(`${slug}-${from}_to_${to}.csv`, body())}
            onExportXlsx={() =>
              downloadXlsx(`${slug}-${from}_to_${to}.xlsx`, [
                { name: title, rows: body() },
                {
                  name: "HSN Summary",
                  rows: [
                    ["HSN", "Rate %", "Qty", "Taxable", "CGST", "SGST", "IGST"],
                    ...hsn.map((h) => [
                      h.hsn,
                      h.rate,
                      h.qty,
                      r(h.taxable),
                      r(h.cgst),
                      r(h.sgst),
                      r(h.igst),
                    ]),
                  ],
                },
              ])
            }
            onExportPdf={() =>
              downloadPdfTable({
                title,
                subtitle: pdfHeader.dateRangeSubtitle(from, to),
                companyName: pdfHeader.companyName,
                companySubLine: pdfHeader.companySubLine,
                head: [head],
                body: rows.map((x) => [
                  fmtIndianDate(x.voucher_date),
                  x.voucher_number,
                  x.ledgers?.name ?? "",
                  x.ledgers?.gstin ?? "",
                  ...(showQtyUnit ? [qtyUnitText(x)] : []),
                  r(x.subtotal_paise).toFixed(2),
                  r(x.cgst_paise).toFixed(2),
                  r(x.sgst_paise).toFixed(2),
                  r(x.igst_paise).toFixed(2),
                  r(x.total_paise).toFixed(2),
                ]),
                foot: [
                  [
                    "TOTAL",
                    "",
                    "",
                    "",
                    ...(showQtyUnit ? [""] : []),
                    r(totals.sub).toFixed(2),
                    r(totals.cgst).toFixed(2),
                    r(totals.sgst).toFixed(2),
                    r(totals.igst).toFixed(2),
                    r(totals.total).toFixed(2),
                  ],
                ],
                fileName: `${slug}-${from}_to_${to}.pdf`,
                orientation: "l",
                rightAlignCols: [4, 5, 6, 7, 8],
              })
            }
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
              reportId={slug}
              rows={rows}
              columns={gridColumns}
              globalSearch={(x) =>
                `${x.voucher_number} ${x.ledgers?.name ?? ""} ${x.ledgers?.gstin ?? ""}`
              }
              onRowClick={(x) => openVoucherDetail(navigate, x.id)}
              height={520}
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[90px]">Date</TableHead>
                  <TableHead className="w-[110px]">Number</TableHead>
                  <TableHead>Party</TableHead>
                  {showQtyUnit && <TableHead className="w-[110px]">Qty / Unit</TableHead>}
                  <TableHead className="w-[110px] text-right">Taxable</TableHead>
                  <TableHead className="w-[95px] text-right">CGST</TableHead>
                  <TableHead className="w-[95px] text-right">SGST</TableHead>
                  <TableHead className="w-[95px] text-right">IGST</TableHead>
                  <TableHead className="w-[115px] text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((x) => (
                  <TableRow
                    key={x.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => openVoucherDetail(navigate, x.id)}
                    title="Click to edit"
                  >
                    <TableCell className="whitespace-nowrap">
                      {fmtIndianDate(x.voucher_date)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{x.voucher_number}</TableCell>
                    <TableCell>
                      <div className="truncate max-w-[280px]">{x.ledgers?.name ?? "—"}</div>
                      {x.ledgers?.gstin && (
                        <div className="font-mono text-[10px] text-muted-foreground">
                          {x.ledgers.gstin}
                        </div>
                      )}
                    </TableCell>
                    {showQtyUnit && (
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        {qtyUnitText(x)}
                      </TableCell>
                    )}
                    <TableCell className="text-right font-mono">
                      {formatINR(x.subtotal_paise)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatINR(x.cgst_paise)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatINR(x.sgst_paise)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatINR(x.igst_paise)}
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold">
                      {formatINR(x.total_paise)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell colSpan={showQtyUnit ? 4 : 3} className="text-right font-semibold">
                    TOTAL
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold">
                    {formatINR(totals.sub)}
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold">
                    {formatINR(totals.cgst)}
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold">
                    {formatINR(totals.sgst)}
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold">
                    {formatINR(totals.igst)}
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold">
                    {formatINR(totals.total)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="border-b px-4 py-3 font-medium">HSN Summary</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>HSN</TableHead>
                <TableHead className="text-right">Rate %</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Taxable</TableHead>
                <TableHead className="text-right">CGST</TableHead>
                <TableHead className="text-right">SGST</TableHead>
                <TableHead className="text-right">IGST</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {hsn.map((h, i) => (
                <TableRow key={i}>
                  <TableCell className="font-mono text-xs">{h.hsn}</TableCell>
                  <TableCell className="text-right">{h.rate}%</TableCell>
                  <TableCell className="text-right">{h.qty}</TableCell>
                  <TableCell className="text-right font-mono">{formatINR(h.taxable)}</TableCell>
                  <TableCell className="text-right font-mono">{formatINR(h.cgst)}</TableCell>
                  <TableCell className="text-right font-mono">{formatINR(h.sgst)}</TableCell>
                  <TableCell className="text-right font-mono">{formatINR(h.igst)}</TableCell>
                </TableRow>
              ))}
              {hsn.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="p-6 text-center text-sm text-muted-foreground">
                    No items in range.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
