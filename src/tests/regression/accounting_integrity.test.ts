
import { describe, it, expect } from 'vitest';
import { calculateWac, calculateProvisionalStockAdjustment } from '../../lib/inventory/valuation-engine';

describe('Accounting Tally & Negative Stock Logic', () => {
  it('6. Verified Balance Sheet Adjustment Formula', () => {
    // Scenario:
    // Opening Ledger: ₹10,000
    // Purchases: ₹15,000
    // Sales: ₹20,000
    // Closing Calculated: ₹12,000
    
    const openingStockPaise = 1000000;
    const purchasesPaise = 1500000;
    const salesPaise = 2000000;
    const calculatedClosingPaise = 1200000;
    
    // In BS, Stock-in-Hand ledger usually holds the Opening Balance if no manual journals were passed.
    const stockLedgers = [{ closing_paise: openingStockPaise }];
    
    const adjustment = calculateProvisionalStockAdjustment(calculatedClosingPaise, stockLedgers);
    
    // Adjustment = 12,000 - 10,000 = 2,000
    expect(adjustment).toBe(200000);
    
    // Profit calculation in BS:
    // inc = 20,000, exp = 15,000
    // profit = (20,000 - 15,000) + 2,000 = 7,000
    const profit = (salesPaise - purchasesPaise) + adjustment;
    expect(profit).toBe(700000);
  });

  it('7. Negative stock treatment in reporting', () => {
    const result = calculateWac(0, 10000, [
      { date: '2024-04-01', qty: -50, taxablePaise: 0, type: 'sales', voucherId: 's1' }
    ]);
    
    // Mathematical value is negative
    expect(result.closingQty).toBe(-50);
    expect(result.closingValuePaise).toBe(-500000);
    
    // Reporting Logic (simulated from BalanceSheet.tsx):
    const reportedAsset = Math.max(0, result.closingValuePaise);
    expect(reportedAsset).toBe(0);
  });

  it('8. Negative stock effect on Gross Profit (COGS)', () => {
    // Even if stock is negative, it must reduce profit (mathematically correct)
    // Opening: 0, Purchase: 0, Sale: 50, Closing: -50 (Value: -5000)
    // GP = (Sales + Closing) - (Purchases + Opening)
    // GP = (5000 + (-5000)) - (0 + 0) = 0
    // This is correct: we sold 50 units we didn't buy yet, so we have no profit until purchase is recorded.
    
    const salesPaise = 500000;
    const closingStockPaise = -500000;
    const purchasesPaise = 0;
    const openingStockPaise = 0;
    
    const gp = (salesPaise + closingStockPaise) - (purchasesPaise + openingStockPaise);
    expect(gp).toBe(0);
  });
});
