// Parsers for Tally master records in XML: LEDGER (ledger accounts), STOCKITEM
// (stock items) and GROUP (account groups). Used by the importer for "master"
// exports, which hold no vouchers.
//
// Sign rule for opening balances: a negative amount is a DEBIT, a positive
// amount is a CREDIT (same as voucher amounts). Checked on the sample master
// export: Sundry Debtors and Cash are negative, Sundry Creditors and Capital
// Account are positive.

import {
  parseXmlTree, parseTallyAmount, parseQuantity, parseRate,
} from "@/lib/tally/standard-voucher-xml";
import { decodeXmlText } from "@/lib/tally/xml-text";

export interface MasterLedger {
  name: string;
  /** Parent group as Tally names it (for example "Sundry Debtors" or a custom group). */
  parent: string;
  /** Opening balance, Tally sign (negative = debit). 0 when not given. */
  opening: number;
  gstin: string;
}

export interface MasterItem {
  name: string;
  parent: string;
  unit: string;
  hsn: string;
  gst_rate?: number;
  opening_qty?: number;
  opening_rate?: number;
  /** Opening stock value in rupees (positive). */
  opening_value?: number;
}

export interface MasterGroup {
  name: string;
  parent: string;
}

interface Node { name: string; attrs: string; text: string; kids: Node[] }

const nameAttr = (node: Node): string => {
  const m = /\bNAME="([^"]*)"/.exec(node.attrs);
  return m ? decodeXmlText(m[1]).trim() : "";
};

/** First non-empty text of a descendant with this name (depth-first). */
function deepText(node: Node, name: string): string {
  const stack = [...node.kids];
  while (stack.length > 0) {
    const n = stack.shift()!;
    if (n.name === name) {
      const t = n.text.trim();
      if (t) return t;
    }
    stack.unshift(...n.kids);
  }
  return "";
}

/** Every descendant with this name (depth-first order). */
function deepAll(node: Node, name: string): Node[] {
  const out: Node[] = [];
  const walk = (n: Node) => {
    for (const k of n.kids) {
      if (k.name === name) out.push(k);
      walk(k);
    }
  };
  walk(node);
  return out;
}

const directText = (node: Node, name: string): string => {
  const k = node.kids.find((c) => c.name === name);
  return k ? k.text.trim() : "";
};

/** Record name: the NAME attribute, or a NAME element inside the record. */
function recordName(node: Node): string {
  return nameAttr(node) || deepText(node, "NAME");
}

/** "7316.00 Dr" -> -7316; "7316.00 Cr" -> 7316; "-7316" -> -7316. Blank -> 0. */
export function parseOpeningBalance(text: string): number {
  const m = /^\s*(-?[\d,]*\.?\d+)\s*(Dr|Cr)?\s*$/i.exec(text);
  if (!m) return 0;
  const v = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(v)) return 0;
  const side = m[2]?.toLowerCase();
  if (side === "dr") return -Math.abs(v);
  if (side === "cr") return Math.abs(v);
  return v;
}

function rootRecord(xml: string, type: string): Node | null {
  const root = parseXmlTree(xml) as Node;
  return root.kids.find((k) => k.name === type) ?? null;
}

export function parseMasterLedger(xml: string): MasterLedger | null {
  const node = rootRecord(xml, "LEDGER");
  if (!node) return null;
  const name = recordName(node);
  if (!name) return null;
  return {
    name,
    parent: deepText(node, "PARENT"),
    opening: parseOpeningBalance(deepText(node, "OPENINGBALANCE")),
    gstin: deepText(node, "PARTYGSTIN"),
  };
}

export function parseMasterItem(xml: string): MasterItem | null {
  const node = rootRecord(xml, "STOCKITEM");
  if (!node) return null;
  const name = recordName(node);
  if (!name) return null;

  // GST rate per duty head (IGST, or CGST + SGST/UTGST), first value of each.
  const heads = new Map<string, number>();
  for (const r of deepAll(node, "RATEDETAILS.LIST")) {
    const head = directText(r, "GSTRATEDUTYHEAD").toUpperCase();
    const rate = parseTallyAmount(directText(r, "GSTRATE"));
    if (head && Number.isFinite(rate) && !heads.has(head)) heads.set(head, rate);
  }
  let gst_rate: number | undefined;
  if (heads.has("IGST")) gst_rate = heads.get("IGST");
  else if (heads.has("CGST") || heads.has("SGST/UTGST") || heads.has("SGST")) {
    gst_rate = (heads.get("CGST") ?? 0) + (heads.get("SGST/UTGST") ?? heads.get("SGST") ?? 0);
  }

  const qty = parseQuantity(deepText(node, "OPENINGBALANCE"));
  const rate = parseRate(deepText(node, "OPENINGRATE"));
  const value = Math.abs(parseTallyAmount(deepText(node, "OPENINGVALUE")));

  return {
    name,
    parent: deepText(node, "PARENT"),
    unit: deepText(node, "BASEUNITS") || qty.unit || "",
    hsn: deepText(node, "HSNCODE") || deepText(node, "GSTHSNNAME"),
    gst_rate,
    opening_qty: qty.qty,
    opening_rate: rate.rate,
    opening_value: Number.isFinite(value) ? value : undefined,
  };
}

export function parseMasterGroup(xml: string): MasterGroup | null {
  const node = rootRecord(xml, "GROUP");
  if (!node) return null;
  const name = recordName(node);
  if (!name) return null;
  return { name, parent: deepText(node, "PARENT") };
}
