import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { FilePenLine, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatINR } from "@/lib/money";
import { openVoucherDetail } from "@/lib/voucher-return";
import type { Gstr9Contribution, Gstr9HsnContribution } from "@/lib/gstr9";

export interface Gstr9DrillSelection {
  title: string;
  rows: Gstr9Contribution[];
  expected?: number;
}

const money = (value: number) => formatINR(Math.round(value * 100));

export function Gstr9Drilldown({ selection, onClose }: {
  selection: Gstr9DrillSelection;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const rows = useMemo(() => selection.rows.filter((row) => {
    const text = `${row.voucherNumber} ${row.party} ${row.gstin ?? ""} ${row.items.map((i) => i.items?.name).join(" ")}`.toLowerCase();
    return text.includes(search.toLowerCase()) && (!from || row.voucherDate >= from) && (!to || row.voucherDate <= to);
  }).sort((a, b) => a.voucherDate.localeCompare(b.voucherDate) || a.voucherNumber.localeCompare(b.voucherNumber)), [selection, search, from, to]);
  const total = (field: "taxableValue" | "igst" | "cgst" | "sgst" | "totalTax") => rows.reduce((sum, row) => sum + Math.round(row[field] * 100), 0) / 100;
  const fullValue = selection.rows.reduce((sum, row) => sum + Math.round(row.taxableValue * 100), 0) / 100;
  const difference = selection.expected == null ? 0 : Math.round((fullValue - selection.expected) * 100) / 100;
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] max-w-6xl overflow-y-auto print:hidden">
      <DialogHeader>
        <DialogTitle>{selection.title}</DialogTitle>
        <DialogDescription>Books · {new Set(rows.map((row) => row.voucherId)).size} vouchers · Taxable {money(total("taxableValue"))} · Tax {money(total("totalTax"))}</DialogDescription>
      </DialogHeader>
      {difference !== 0 && <p role="alert" className="text-sm text-destructive">Source difference: {money(difference)}</p>}
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1 space-y-1"><span className="text-xs text-muted-foreground">Search voucher / party / GSTIN / item</span><div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" aria-label="Search source vouchers" /></div></label>
        <label className="space-y-1"><span className="text-xs text-muted-foreground">From</span><Input type="date" aria-label="Source from date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="space-y-1"><span className="text-xs text-muted-foreground">To</span><Input type="date" aria-label="Source to date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader><TableRow><TableHead>Date / Voucher</TableHead><TableHead>Party / GSTIN</TableHead><TableHead>Classification</TableHead>{["Taxable", "IGST", "CGST", "SGST", "Tax"].map((label) => <TableHead key={label} className="text-right">{label}</TableHead>)}<TableHead /></TableRow></TableHeader>
          <TableBody>
            {rows.map((row, index) => {
              const key = `${row.voucherId}:${index}`;
              const hsnRow = row as Partial<Gstr9HsnContribution>;
              return <TableRow key={key}>
                <TableCell className="align-top"><div className="whitespace-nowrap">{row.voucherDate}</div><Button variant="link" className="h-auto p-0 text-foreground underline" onClick={() => setExpanded(expanded === key ? null : key)} aria-expanded={expanded === key}>{row.voucherNumber}</Button><div className="text-xs text-muted-foreground">{row.voucherType.replaceAll("_", " ")}</div>
                  {expanded === key && <div className="mt-2 space-y-1 text-xs">{row.items.map((line, i) => <div key={i}>{line.items?.name ?? "Item"} · HSN {line.items?.hsn_code ?? "—"} · {line.qty} {line.items?.unit} · GST {line.gst_rate}% · {money(line.taxable_paise / 100)}</div>)}{!row.items.length && <div>Voucher-level amounts</div>}</div>}
                </TableCell>
                <TableCell className="align-top"><div>{row.party}</div><div className="text-xs text-muted-foreground">{row.gstin ?? "Unregistered"}</div></TableCell>
                <TableCell className="align-top">{row.nature.replaceAll("_", " ")}{hsnRow.hsn && <div className="text-xs text-muted-foreground">HSN {hsnRow.hsn} · {hsnRow.quantity} {hsnRow.uqc} · {hsnRow.gstRate}%</div>}</TableCell>
                {(["taxableValue", "igst", "cgst", "sgst", "totalTax"] as const).map((field) => <TableCell key={field} className="text-right align-top whitespace-nowrap">{money(row[field])}</TableCell>)}
                <TableCell className="align-top"><Button size="icon" variant="outline" aria-label={`Edit voucher ${row.voucherNumber}`} title={`Edit voucher ${row.voucherNumber}`} onClick={() => openVoucherDetail(navigate, row.voucherId)}><FilePenLine className="h-4 w-4" /></Button></TableCell>
              </TableRow>;
            })}
            {!rows.length && <TableRow><TableCell colSpan={9} className="py-8 text-center text-muted-foreground">No source vouchers match this selection.</TableCell></TableRow>}
            <TableRow className="font-semibold"><TableCell colSpan={3}>Filtered total</TableCell>{(["taxableValue", "igst", "cgst", "sgst", "totalTax"] as const).map((field) => <TableCell key={field} className="text-right whitespace-nowrap">{money(total(field))}</TableCell>)}<TableCell /></TableRow>
          </TableBody>
        </Table>
      </div>
    </DialogContent>
  </Dialog>;
}