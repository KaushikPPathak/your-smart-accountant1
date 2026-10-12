/**
 * GSTN portal JSON shape rules for GSTR-1, matched against a JSON produced by
 * the official GSTN Returns Offline Tool that the portal accepted (Oct 2026).
 *
 * - Envelope: version "GST3.2.4", hash "hash".
 * - Table 12 HSN: only `hsn_b2b` / `hsn_b2c` arrays — no legacy `data` array,
 *   and an empty section is omitted entirely (empty arrays are rejected).
 * - Every HSN row carries a non-empty `desc` (HSN master description).
 * - UQC is the bare code ("KGS"), never "KGS-KILOGRAMS".
 * - doc_issue entries carry `doc_typ`; Debit Note = 4, Credit Note = 5.
 * - Nil sheet labels from the offline-tool Excel map to sply_ty codes.
 */
import { HSN_MASTER_DATASET } from "./hsn/seedHsnData";

export const GSTR1_PORTAL_VERSION = "GST3.2.4";

export const DOC_TYPES: Record<number, string> = {
  1: "Invoices for outward supply",
  2: "Invoices for inward supply from unregistered person",
  3: "Revised Invoice",
  4: "Debit Note",
  5: "Credit Note",
  6: "Receipt Voucher",
  7: "Payment Voucher",
  8: "Refund Voucher",
  9: "Delivery Challan for job work",
  10: "Delivery Challan for supply on approval",
  11: "Delivery Challan in case of liquid gas",
  12: "Delivery Challan in case other than by way of supply (excluding at S no. 9 to 11)",
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/** Accepts both the offline-tool Excel wording and older variants. */
export function nilSupplyType(label: string): "INTRB2B" | "INTRB2C" | "INTRAB2B" | "INTRAB2C" | null {
  const n = norm(label);
  const intra = n.startsWith("intra");
  const inter = n.startsWith("inter");
  if (!intra && !inter) return null;
  const unreg = n.includes("unregistered") || n.includes("consumer");
  const reg = !unreg && n.includes("registered");
  if (!unreg && !reg) return null;
  return `${intra ? "INTRA" : "INTR"}${unreg ? "B2C" : "B2B"}` as never;
}

let descMap: Map<string, string> | null = null;
/** Description for an HSN code from the master list (longest prefix wins). */
export function hsnDescription(code: string, fallback?: string): string {
  if (!descMap) descMap = new Map(HSN_MASTER_DATASET.map((h) => [h.code, h.desc]));
  const given = (fallback ?? "").trim();
  if (given) return given.slice(0, 300);
  for (let len = code.length; len >= 2; len--) {
    const d = descMap.get(code.slice(0, len));
    if (d) return d.slice(0, 300);
  }
  return "OTHER";
}

export const bareUqc = (u: unknown): string => {
  const s = String(u ?? "").trim().toUpperCase();
  if (!s) return "OTH";
  return s.split("-")[0].trim() || "OTH";
};

export interface PortalHsnRow {
  num: number; hsn_sc: string; desc: string; uqc: string; qty: number; rt: number;
  txval: number; iamt: number; samt: number; camt: number; csamt: number;
}

/** Normalise rows to the exact field set/order the portal accepts. */
export function toPortalHsnRows(rows: Array<Record<string, any>>): PortalHsnRow[] {
  return rows.map((r, i) => ({
    num: i + 1,
    hsn_sc: String(r.hsn_sc ?? ""),
    desc: hsnDescription(String(r.hsn_sc ?? ""), r.desc),
    uqc: bareUqc(r.uqc),
    qty: Number(r.qty) || 0,
    rt: Number(r.rt) || 0,
    txval: Number(r.txval) || 0,
    iamt: Number(r.iamt) || 0,
    samt: Number(r.samt) || 0,
    camt: Number(r.camt) || 0,
    csamt: Number(r.csamt) || 0,
  }));
}

/** Build the `hsn` block, omitting empty sections; undefined when both empty. */
export function portalHsnBlock(b2b: Array<Record<string, any>>, b2c: Array<Record<string, any>>) {
  const out: Record<string, PortalHsnRow[]> = {};
  if (b2b.length) out.hsn_b2b = toPortalHsnRows(b2b);
  if (b2c.length) out.hsn_b2c = toPortalHsnRows(b2c);
  return Object.keys(out).length ? out : undefined;
}
