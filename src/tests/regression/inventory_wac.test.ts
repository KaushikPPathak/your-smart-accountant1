
import { describe, it, expect } from 'vitest';
import { calculateWac, type ItemMove } from '../../lib/inventory/valuation-engine';

describe('Inventory WAC Engine Regression', () => {
  it('1. Opening stock + one purchase + sale', () => {
    const openingQty = 100;
    const openingRate = 10000; // ₹100.00
    const moves: ItemMove[] = [
      { date: '2024-04-02', qty: 100, taxablePaise: 1500000, type: 'purchase', voucherId: 'v1' }, // 100 @ ₹150
      { date: '2024-04-03', qty: -50, taxablePaise: 0, type: 'sales', voucherId: 'v2' }
    ];
    
    const result = calculateWac(openingQty, openingRate, moves);
    
    // Total Qty = 100 + 100 - 50 = 150
    // Initial Value = 100 * 100 = 10,000
    // Purchase Value = 100 * 150 = 15,000
    // Total Value before sale = 25,000
    // WAC before sale = 25,000 / 200 = ₹125
    // Sale Value = 50 * 125 = 6,250
    // Closing Value = 25,000 - 6,250 = 18,750
    
    expect(result.closingQty).toBe(150);
    expect(result.closingValuePaise).toBe(1875000); // ₹18,750.00
    expect(result.wacPaise).toBe(12500); // ₹125.00
  });

  it('2. Purchases at two different rates and WAC recalculation', () => {
    const openingQty = 0;
    const openingRate = 0;
    const moves: ItemMove[] = [
      { date: '2024-04-01', qty: 10, taxablePaise: 100000, type: 'purchase', voucherId: 'p1' }, // 10 @ ₹100
      { date: '2024-04-02', qty: 10, taxablePaise: 200000, type: 'purchase', voucherId: 'p2' }, // 10 @ ₹200
    ];
    
    const result = calculateWac(openingQty, openingRate, moves);
    
    // Total Qty = 20
    // Total Value = 1,000 + 2,000 = 3,000
    // WAC = 3,000 / 20 = 150
    
    expect(result.closingQty).toBe(20);
    expect(result.wacPaise).toBe(15000);
    expect(result.closingValuePaise).toBe(300000);
  });

  it('3. Purchase return', () => {
    const openingQty = 100;
    const openingRate = 10000;
    const moves: ItemMove[] = [
      { date: '2024-04-01', qty: -20, taxablePaise: 0, type: 'debit_note', voucherId: 'pr1' }
    ];
    
    const result = calculateWac(openingQty, openingRate, moves);
    
    // Debit note (outward) reduces stock at CURRENT WAC
    // Opening WAC = 100
    // Outflow = 20 * 100 = 2,000
    // Value = 10,000 - 2,000 = 8,000
    
    expect(result.closingQty).toBe(80);
    expect(result.closingValuePaise).toBe(800000);
  });

  it('4. Sales return', () => {
    const openingQty = 100;
    const openingRate = 10000;
    const moves: ItemMove[] = [
      { date: '2024-04-01', qty: 20, taxablePaise: 240000, type: 'credit_note', voucherId: 'sr1' } // Return at ₹120
    ];
    
    const result = calculateWac(openingQty, openingRate, moves);
    
    // Credit note (inward) acts as a purchase
    // Initial: 100 @ 100 = 10,000
    // Inward: 20 @ 120 = 2,400
    // Total: 120 units = 12,400 value
    // New WAC = 12,400 / 120 = 103.33
    
    expect(result.closingQty).toBe(120);
    expect(Math.round(result.wacPaise)).toBe(10333);
  });

  it('5. Negative stock', () => {
    const openingQty = 0;
    const openingRate = 10000;
    const moves: ItemMove[] = [
      { date: '2024-04-01', qty: -50, taxablePaise: 0, type: 'sales', voucherId: 's1' }
    ];
    
    const result = calculateWac(openingQty, openingRate, moves);
    
    // Value = -50 * 100 = -5,000
    expect(result.closingQty).toBe(-50);
    expect(result.closingValuePaise).toBe(-500000);
    expect(result.isNegative).toBe(true);
  });
});
