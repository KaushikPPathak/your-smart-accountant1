/**
 * Shared inventory processing and validation for vouchers.
 */

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
  wacPaise: number;
  isNegative: boolean;
}

/**
 * Weighted Average Cost (WAC) Engine.
 * 
 * Rules:
 * - Opening: Qty * Rate.
 * - Inward (Purchase/Sales Return/Mfg In): Value += (Qty * Rate), WAC = Value / Qty.
 * - Outward (Sales/Purchase Return/Mfg Out): Value -= (Qty * WAC), WAC remains same.
 * - Negative Stock: Preserve last valid WAC, Value = Qty * WAC (negative value).
 */
export function calculateWac(
  openingQty: number,
  openingRatePaise: number,
  moves: ItemMove[]
): ValuationResult {
  let currentQty = openingQty;
  let currentValuePaise = Math.round(openingQty * openingRatePaise);
  let currentWacPaise = openingRatePaise;

  // Sort moves chronologically
  const sortedMoves = [...moves].sort((a, b) => a.date.localeCompare(b.date));

  for (const move of sortedMoves) {
    const qty = Math.abs(move.qty);
    const moveRate = qty > 0 ? move.taxablePaise / qty : 0;

    const isInward = 
      move.type === "purchase" || 
      move.type === "credit_note" || 
      (move.type === "manufacturing" && move.qty > 0);
    
    const isOutward = 
      move.type === "sales" || 
      move.type === "debit_note" || 
      (move.type === "manufacturing" && move.qty < 0);

    if (isInward) {
      const addedValue = Math.round(qty * moveRate);
      currentValuePaise += addedValue;
      currentQty += qty;
      if (currentQty > 0) {
        currentWacPaise = currentValuePaise / currentQty;
      }
    } else if (isOutward) {
      // Use current WAC for outflows
      const outflowValue = Math.round(qty * currentWacPaise);
      currentValuePaise -= outflowValue;
      currentQty -= qty;
      // WAC remains unchanged on outflows
    }
  }

  return {
    closingQty: currentQty,
    closingValuePaise: Math.round(currentValuePaise),
    wacPaise: currentWacPaise,
    isNegative: currentQty < 0
  };
}

/**
 * Aggregates all stock movements for a company up to a specific date.
 */
export async function getCompanyInventoryValuation(
  companyId: string,
  asOfDate: string,
  items: any[],
  vouchers: any[],
  voucherItems: any[]
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

    const result = calculateWac(
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
  voucherItems: any[]
): Promise<number> {
  // 1. Check for manual valuation override
  const { data: manual, error } = await supabase
    .from("inventory_manual_valuations")
    .select("valuation_paise")
    .eq("company_id", companyId)
    .eq("as_of_date", asOfDate)
    .maybeSingle();

  if (!error && manual) {
    return Number(manual.valuation_paise);
  }

  // 2. Fallback to WAC engine
  const valuationMap = await getCompanyInventoryValuation(
    companyId,
    asOfDate,
    items,
    vouchers,
    voucherItems
  );

  let totalPaise = 0;
  for (const res of valuationMap.values()) {
    totalPaise += res.closingValuePaise;
  }
  return totalPaise;
}

/**
 * Calculates the delta between the physical stock (WAC valuation) 
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


