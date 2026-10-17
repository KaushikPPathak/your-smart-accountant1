import { fmtIndianDate } from "@/lib/format-date";

/**
 * Compact, accounting-style register table used on screen AND in print, so
 * the preview and the printed page share one layout. Fixed column widths
 * (percentages) stop narrow text columns from collapsing on paper.
 */
export interface RegisterLine {
  id: string;
  date: string;
  billNo: string;
  mode: "Cash" | "Credit";
  party: string;
  gstin?: string | null;
  items: { name: string; qty: number; unit?: string | null }[];
  taxable: number; // paise
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

const amt = (p: number) =>
  (p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function isCashParty(type?: string | null, name?: string | null): boolean {
  const t = String(type || "").toLowerCase();
  if (t === "cash" || t === "cash_in_hand") return true;
  return /^cash(\b|\s)/i.test(String(name || "").trim());
}

export function RegisterPrintTable({
  lines,
  withGst,
  partyLabel = "Party Name",
  onRowClick,
}: {
  lines: RegisterLine[];
  withGst: boolean;
  partyLabel?: string;
  onRowClick?: (id: string) => void;
}) {
  const t = lines.reduce(
    (s, l) => ({
      taxable: s.taxable + l.taxable,
      cgst: s.cgst + l.cgst,
      sgst: s.sgst + l.sgst,
      igst: s.igst + l.igst,
      total: s.total + l.total,
    }),
    { taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 },
  );
  const widths = withGst
    ? ["4%", "8%", "7%", "6%", "17%", "20%", "9%", "7%", "7%", "7%", "8%"]
    : ["5%", "10%", "9%", "7%", "24%", "33%", "12%"];
  const th = "border border-border px-1.5 py-1 text-left font-semibold";
  const td = "border border-border px-1.5 py-0.5 align-top";
  const num = `${td} num text-right tabular-nums whitespace-nowrap`;
  const cols = withGst ? 11 : 7;

  return (
    <table className="report-data-table w-full table-fixed border-collapse text-[11px] leading-tight">
      <colgroup>
        {widths.map((w, i) => (
          <col key={i} style={{ width: w }} />
        ))}
      </colgroup>
      <thead className="bg-muted">
        <tr>
          <th className={th}>No.</th>
          <th className={th}>Date</th>
          <th className={th}>Bill No.</th>
          <th className={th}>Cash / Credit</th>
          <th className={th}>{partyLabel}</th>
          <th className={th}>Item Name – Qty</th>
          {withGst && (
            <>
              <th className={`${th} num text-right`}>Taxable</th>
              <th className={`${th} num text-right`}>CGST</th>
              <th className={`${th} num text-right`}>SGST</th>
              <th className={`${th} num text-right`}>IGST</th>
            </>
          )}
          <th className={`${th} num text-right`}>Bill Value</th>
        </tr>
      </thead>
      <tbody>
        {lines.length === 0 && (
          <tr>
            <td colSpan={cols} className={`${td} py-6 text-center text-muted-foreground`}>
              No entries in this period.
            </td>
          </tr>
        )}
        {lines.map((l, i) => (
          <tr
            key={l.id}
            className={onRowClick ? "cursor-pointer hover:bg-muted/50" : undefined}
            onClick={onRowClick ? () => onRowClick(l.id) : undefined}
          >
            <td className={td}>{i + 1}</td>
            <td className={`${td} whitespace-nowrap`}>{fmtIndianDate(l.date)}</td>
            <td className={td}>{l.billNo}</td>
            <td className={td}>{l.mode}</td>
            <td className={td}>
              {l.party}
              {withGst && l.gstin && <div className="text-[9px] text-muted-foreground">{l.gstin}</div>}
            </td>
            <td className={td}>
              {l.items.length === 0
                ? "—"
                : l.items.map((it, k) => (
                    <div key={k}>
                      {it.name} – {it.qty}
                      {it.unit ? ` ${it.unit}` : ""}
                    </div>
                  ))}
            </td>
            {withGst && (
              <>
                <td className={num}>{amt(l.taxable)}</td>
                <td className={num}>{amt(l.cgst)}</td>
                <td className={num}>{amt(l.sgst)}</td>
                <td className={num}>{amt(l.igst)}</td>
              </>
            )}
            <td className={`${num} font-semibold`}>{amt(l.total)}</td>
          </tr>
        ))}
      </tbody>
      {lines.length > 0 && (
        <tfoot>
          <tr className="row-bold bg-muted font-semibold">
            <td colSpan={6} className={`${td} text-right`}>
              Total
            </td>
            {withGst && (
              <>
                <td className={num}>{amt(t.taxable)}</td>
                <td className={num}>{amt(t.cgst)}</td>
                <td className={num}>{amt(t.sgst)}</td>
                <td className={num}>{amt(t.igst)}</td>
              </>
            )}
            <td className={num}>{amt(t.total)}</td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}

/** Map a voucher row (register / GST book shape) to a printable line. */
export function toRegisterLine(v: {
  id: string;
  voucher_date: string;
  voucher_number: string;
  reference_no?: string | null;
  vendor_invoice_no?: string | null;
  subtotal_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  total_paise: number;
  ledgers: { name: string; gstin?: string | null; type?: string | null } | null;
  voucher_items?: { qty: number; items: { name?: string; unit?: string | null } | null }[];
}): RegisterLine {
  const cash = isCashParty(v.ledgers?.type, v.ledgers?.name);
  return {
    id: v.id,
    date: v.voucher_date,
    billNo: v.vendor_invoice_no || v.reference_no || v.voucher_number,
    mode: cash ? "Cash" : "Credit",
    party: cash ? "Cash" : v.ledgers?.name || "—",
    gstin: v.ledgers?.gstin ?? null,
    items: (v.voucher_items || []).map((l) => ({
      name: l.items?.name || "Item",
      qty: Number(l.qty || 0),
      unit: l.items?.unit ?? null,
    })),
    taxable: v.subtotal_paise,
    cgst: v.cgst_paise,
    sgst: v.sgst_paise,
    igst: v.igst_paise,
    total: v.total_paise,
  };
}
