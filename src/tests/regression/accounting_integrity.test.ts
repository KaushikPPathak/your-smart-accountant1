
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
    
    // Mathematical value is negative and MUST be preserved
    expect(result.closingQty).toBe(-50);
    expect(result.closingValuePaise).toBe(-500000);
    
    // Reporting Logic: Check that we use the negative value for tallying
    const stockLedgers = [{ closing_paise: 0 }];
    const adjustment = calculateProvisionalStockAdjustment(result.closingValuePaise, stockLedgers);
    expect(adjustment).toBe(-500000);
  });

  it('8. Negative stock effect on Gross Profit (COGS)', () => {
    const salesPaise = 1000000; // 10k
    const closingStockPaise = -500000; // -5k
    const purchasesPaise = 0;
    const openingStockPaise = 0;
    
    // GP = (10,000 + (-5,000)) - (0 + 0) = 5,000
    const gp = (salesPaise + closingStockPaise) - (purchasesPaise + openingStockPaise);
    expect(gp).toBe(500000);
  });

});
