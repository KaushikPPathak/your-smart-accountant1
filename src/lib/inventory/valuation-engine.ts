/**
 * Shared inventory processing and validation for vouchers.
 */
import { getManualValuation } from "@/lib/offline/manual-valuation";

export type ValuationMethod = "average" | "fifo" | "lifo";

export const VALUATION_METHODS: { value: ValuationMethod; label: string; hint: string }[] = [
  { value: "average", label: "Average cost (weighted)", hint: "Every sale is costed at the running average of all stock on hand. Default." },
  { value: "fifo", label: "FIFO (first in, first out)", hint: "Oldest purchases are sold first; closing stock is valued at the newest purchases." },
  { value: "lifo", label: "LIFO (last in, first out)", hint: "Newest purchases are sold first; closing stock is valued at the oldest purchases." },
];

export interface ItemMove {
  date: string;
  qty: number;
  taxablePaise: number;
  type: string;
  voucherId: string;
}

export interface ValuationResult {
  closingQty: number;
  closingValuePaise: number;
  /** Average cost per unit on hand (for FIFO/LIFO, the value divided by the quantity). */
  wacPaise: number;
  isNegative: boolean;
  /** Set when stock on hand is positive but its value came out negative; the value is then shown as zero and the item needs a check. */
  needsReview: boolean;
}

// Quantities are kept to six decimals so float dust (e.g. 2e-13) never shows as stock.
const EPS = 1e-6;
const q6 = (n: number) => Math.round(n * 1e6) / 1e6;

type MoveKind = "in" | "out" | "physical" | "none";

function kindOf(move: ItemMove): MoveKind {
  if (move.type === "physical_stock") return "physical";
  if (
    move.type === "purchase" ||
    move.type === "credit_note" ||
    (move.type === "manufacturing" && move.qty > 0)
  ) return "in";
  if (
    move.type === "sales" ||
    move.type === "debit_note" ||
    (move.type === "manufacturing" && move.qty < 0)
  ) return "out";
  return "none";
}

/**
 * Cost of stock on hand under the chosen method.
 *
 * Shared rules for all methods:
 * - Opening stock is the first layer of stock at its rate.
 * - A sale larger than the stock on hand leaves the excess as negative stock.
 * - When a later purchase brings a negative stock back above zero, the negative
 *   cost is dropped and the stock on hand is valued at the purchase rate. The
 *   sales that ran ahead of purchases are never carried as a negative value.
 * - Physical stock lines carry a signed quantity difference and no value of their own.
 */
export function calculateCost(
  method: ValuationMethod,
  openingQty: number,
  openingRatePaise: number,
  moves: ItemMove[],
): ValuationResult {
  return method === "average"
    ? averageCost(openingQty, openingRatePaise, moves)
    : layerCost(method, openingQty, openingRatePaise, moves);
}

/**
 * Weighted Average Cost (WAC) engine. Kept under its original name because
 * the reports call it directly; the optional method selects another costing.
 *
 * Average rules:
 * - Inward: value += qty * rate, WAC = value / qty.
 * - Outward: value -= qty * WAC, WAC unchanged.
 * - Negative stock: value = qty * WAC (negative), until purchases bring it back above zero.
 */
export function calculateWac(
  openingQty: number,
  openingRatePaise: number,
  moves: ItemMove[],
  method: ValuationMethod = "average",
): ValuationResult {
  return calculateCost(method, openingQty, openingRatePaise, moves);
}

function finish(qty: number, value: number, wac: number): ValuationResult {
  const closingQty = q6(qty);
  if (Math.abs(closingQty) < EPS) {
    return { closingQty: 0, closingValuePaise: 0, wacPaise: wac, isNegative: false, needsReview: false };
  }
  if (closingQty > 0 && value < 0) {
    return { closingQty, closingValuePaise: 0, wacPaise: 0, isNegative: false, needsReview: true };
  }
  return {
    closingQty,
    closingValuePaise: Math.round(value),
    wacPaise: wac,
    isNegative: closingQty < 0,
    needsReview: false,
  };
}

function averageCost(openingQty: number, openingRatePaise: number, moves: ItemMove[]): ValuationResult {
  let qty = q6(openingQty);
  let value = Math.round(openingQty * openingRatePaise);
  let wac = openingRatePaise;

  const sorted = [...moves].sort((a, b) => a.date.localeCompare(b.date));

  for (const move of sorted) {
    const kind = kindOf(move);
    if (kind === "none") continue;
    const oldQty = qty;

    if (kind === "physical") {
      const next = q6(oldQty + move.qty);
      value = oldQty < -EPS && next > EPS ? Math.round(next * wac) : value + Math.round(move.qty * wac);
      qty = next;
      if (qty > EPS) wac = value / qty;
      continue;
    }

    const amount = Math.abs(move.qty);
    const moveRate = amount > 0 ? move.taxablePaise / amount : 0;

    if (kind === "in") {
      const next = q6(oldQty + amount);
      if (next > EPS) {
        // Back above zero: the stock on hand is valued at this purchase's rate when it was short.
        value = oldQty < -EPS ? Math.round(next * moveRate) : value + Math.round(amount * moveRate);
      } else {
        // Still short: the purchase only reduces the shortfall, so it carries no new cost.
        // The quantity stays negative and its value stays quantity times the average.
        value = Math.round(next * wac);
      }
      qty = next;
      if (qty > EPS) wac = value / qty;
    } else {
      // Outflow is costed at the current average; the average itself does not change.
      value -= Math.round(amount * wac);
      qty = q6(oldQty - amount);
    }
  }

  return finish(qty, value, wac);
}

function layerCost(
  method: "fifo" | "lifo",
  openingQty: number,
  openingRatePaise: number,
  moves: ItemMove[],
): ValuationResult {
  type Layer = { qty: number; rate: number };
  const layers: Layer[] = [];
  let uncovered = 0; // quantity sold beyond stock on hand (negative stock)
  let lastRate = openingRatePaise;

  if (openingQty > EPS) layers.push({ qty: openingQty, rate: openingRatePaise });
  else if (openingQty < -EPS) uncovered = -openingQty;

  // Returns the quantity that became stock on hand (not used to cover a shortfall).
  const addStock = (qtyIn: number, rate: number): number => {
    let remaining = qtyIn;
    if (uncovered > EPS) {
      const cover = Math.min(uncovered, remaining);
      uncovered = q6(uncovered - cover);
      remaining = q6(remaining - cover);
    }
    if (remaining > EPS) layers.push({ qty: remaining, rate });
    return remaining > EPS ? remaining : 0;
  };

  const takeStock = (qtyOut: number) => {
    let remaining = qtyOut;
    while (remaining > EPS && layers.length) {
      const layer = method === "fifo" ? layers[0] : layers[layers.length - 1];
      const used = Math.min(layer.qty, remaining);
      layer.qty = q6(layer.qty - used);
      remaining = q6(remaining - used);
      if (layer.qty <= EPS) {
        if (method === "fifo") layers.shift();
        else layers.pop();
      }
    }
    if (remaining > EPS) uncovered = q6(uncovered + remaining);
  };

  const sorted = [...moves].sort((a, b) => a.date.localeCompare(b.date));
  for (const move of sorted) {
    const kind = kindOf(move);
    if (kind === "none") continue;
    const amount = Math.abs(move.qty);

    if (kind === "physical") {
      if (move.qty > 0) addStock(move.qty, lastRate);
      else if (move.qty < 0) takeStock(-move.qty);
      continue;
    }

    const moveRate = amount > 0 ? move.taxablePaise / amount : 0;
    if (kind === "in") {
      // lastRate is the rate new shortfalls are costed at: it changes only when
      // a purchase adds stock on hand, not when it just covers a shortfall.
      if (addStock(amount, moveRate) > 0 && moveRate > 0) lastRate = moveRate;
    } else {
      takeStock(amount);
    }
  }

  let qty = 0;
  let value = 0;
  for (const l of layers) {
    qty += l.qty;
    value += Math.round(l.qty * l.rate);
  }
  const closing = q6(qty - uncovered);
  if (closing < -EPS) {
    // Negative stock is valued at the rate its shortfall is costed at.
    return finish(closing, Math.round(closing * lastRate), lastRate);
  }
  const wac = closing > EPS ? value / closing : lastRate;
  return finish(closing, value, wac);
}

/**
 * Aggregates all stock movements for a company up to a specific date.
 */
export async function getCompanyInventoryValuation(
  companyId: string,
  asOfDate: string,
  items: any[],
  vouchers: any[],
  voucherItems: any[],
  method: ValuationMethod = "average",
): Promise<Map<string, ValuationResult>> {
  const valuationMap = new Map<string, ValuationResult>();

  const voucherMap = new Map(vouchers.map(v => [v.id, v]));

  for (const item of items) {
    const itemMoves: ItemMove[] = voucherItems
      .filter(vi => vi.item_id === item.id)
      .map(vi => {
        const v = voucherMap.get(vi.voucher_id);
        if (!v || v.is_deleted || v.voucher_date > asOfDate) return null;
        return {
          date: v.voucher_date,
          qty: Number(vi.qty || 0),
          taxablePaise: Number(vi.taxable_paise || 0),
          type: v.voucher_type,
          voucherId: v.id
        };
      })
      .filter((m): m is ItemMove => m !== null);

    const result = calculateCost(
      method,
      Number(item.opening_stock_qty || 0),
      Number(item.opening_stock_rate_paise || 0),
      itemMoves
    );

    valuationMap.set(item.id, result);
  }

  return valuationMap;
}

/**
 * Resolves the inventory valuation for a company, applying manual overrides if present.
 */
export async function resolveInventoryValuation(
  companyId: string,
  asOfDate: string,
  items: any[],
  vouchers: any[],
  voucherItems: any[],
  method: ValuationMethod = "average",
): Promise<number> {
  // 1. Check for manual valuation override
  const manual = await getManualValuation(companyId, asOfDate);
  if (manual !== null) {
    return manual;
  }

  // 2. Fallback to the costing engine
  const valuationMap = await getCompanyInventoryValuation(
    companyId,
    asOfDate,
    items,
    vouchers,
    voucherItems,
    method,
  );

  let totalPaise = 0;
  for (const res of valuationMap.values()) {
    totalPaise += res.closingValuePaise;
  }
  return totalPaise;
}

/**
 * Calculates the delta between the physical stock (valuation)
 * and the accounting book stock (ledger balances).
 *
 * This adjustment is injected into the P&L and Balance Sheet to ensure they tally.
 */
export function calculateProvisionalStockAdjustment(
  calculatedValuationPaise: number,
  stockLedgerBalances: { closing_paise: number }[]
): number {
  const totalLedgerBalance = stockLedgerBalances.reduce((s, b) => s + b.closing_paise, 0);
  return calculatedValuationPaise - totalLedgerBalance;
}
