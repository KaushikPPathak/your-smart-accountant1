import { describe, it, expect } from 'vitest';
import { calculateWac, type ItemMove } from '../../lib/inventory/valuation-engine';

/**
 * Physical Stock (Stock-Take) Voucher Regression Suite
 *
 * Verifies that physical_stock moves in the WAC engine are:
 * 1. Valued at the running WAC (not their own value, which is always 0).
 * 2. Applied as a signed quantity adjustment (positive = surplus, negative = shortage).
 * 3. Never distort the average cost after the correction.
 */
describe('Physical Stock Voucher Regression', () => {
  it('1. Surplus (positive qty) increases stock at running WAC without changing WAC', () => {
    const moves: ItemMove[] = [
      { date: '2026-04-01', qty: 100, taxablePaise: 1000000, type: 'purchase', voucherId: 'p1' }, // 100 @ ₹100
      { date: '2026-04-05', qty: 5, taxablePaise: 0, type: 'physical_stock', voucherId: 'ps1' },   // +5 surplus
    ];
    const result = calculateWac(0, 0, moves);

    // After purchase: 100 @ ₹100 = ₹10,000, WAC = ₹100
    // After physical_stock +5: qty = 105, value += 5 * 100 = 500 → 10,500
    // WAC = 10,500 / 105 = 100 (unchanged)
    expect(result.closingQty).toBe(105);
    expect(result.closingValuePaise).toBe(1050000);
    expect(result.wacPaise).toBe(10000);
  });

  it('2. Shortage (negative qty) decreases stock at running WAC without changing WAC', () => {
    const moves: ItemMove[] = [
      { date: '2026-04-01', qty: 100, taxablePaise: 1000000, type: 'purchase', voucherId: 'p1' }, // 100 @ ₹100
      { date: '2026-04-05', qty: -10, taxablePaise: 0, type: 'physical_stock', voucherId: 'ps1' }, // -10 shortage
    ];
    const result = calculateWac(0, 0, moves);

    // After purchase: 100 @ ₹100 = ₹10,000, WAC = ₹100
    // After physical_stock -10: qty = 90, value -= 10 * 100 = 1000 → 9,000
    // WAC = 9,000 / 90 = 100 (unchanged)
    expect(result.closingQty).toBe(90);
    expect(result.closingValuePaise).toBe(900000);
    expect(result.wacPaise).toBe(10000);
  });

  it('3. Physical stock correction at zero stock uses last known WAC', () => {
    const moves: ItemMove[] = [
      { date: '2026-04-01', qty: 50, taxablePaise: 500000, type: 'purchase', voucherId: 'p1' }, // 50 @ ₹100
      { date: '2026-04-02', qty: -50, taxablePaise: 0, type: 'sales', voucherId: 's1' },          // sell all
      { date: '2026-04-03', qty: 3, taxablePaise: 0, type: 'physical_stock', voucherId: 'ps1' },   // found 3 units
    ];
    const result = calculateWac(0, 0, moves);

    // After purchase: 50 @ 100 = 5,000, WAC = 100
    // After sale: 0 units, value = 0, WAC preserved = 100
    // After physical_stock +3: qty = 3, value += 3 * 100 = 300
    // WAC = 300 / 3 = 100
    expect(result.closingQty).toBe(3);
    expect(result.closingValuePaise).toBe(30000);
    expect(Math.round(result.wacPaise)).toBe(10000);
  });

  it('4. Multiple physical stock corrections on different dates apply in order', () => {
    const moves: ItemMove[] = [
      { date: '2026-04-01', qty: 100, taxablePaise: 1000000, type: 'purchase', voucherId: 'p1' },
      { date: '2026-04-10', qty: -5, taxablePaise: 0, type: 'physical_stock', voucherId: 'ps1' },  // shortage
      { date: '2026-04-20', qty: 2, taxablePaise: 0, type: 'physical_stock', voucherId: 'ps2' },   // surplus
    ];
    const result = calculateWac(0, 0, moves);

    // After purchase: 100 @ 100 = 10,000
    // After ps1 (-5): 95, value = 10,000 - 500 = 9,500, WAC = 100
    // After ps2 (+2): 97, value = 9,500 + 200 = 9,700, WAC = 100
    expect(result.closingQty).toBe(97);
    expect(result.closingValuePaise).toBe(970000);
    expect(result.wacPaise).toBe(10000);
  });

  it('5. Physical stock with opening stock', () => {
    const moves: ItemMove[] = [
      { date: '2026-04-05', qty: -3, taxablePaise: 0, type: 'physical_stock', voucherId: 'ps1' }, // shortage
    ];
    const result = calculateWac(50, 10000, moves);

    // Opening: 50 @ 100 = 5,000, WAC = 100
    // Physical stock -3: 47, value = 5,000 - 300 = 4,700, WAC = 100
    expect(result.closingQty).toBe(47);
    expect(result.closingValuePaise).toBe(470000);
    expect(result.wacPaise).toBe(10000);
  });
});
