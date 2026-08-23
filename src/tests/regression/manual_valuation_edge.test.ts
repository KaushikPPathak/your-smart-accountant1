import { describe, it, expect } from 'vitest';
import { supabase } from '@/integrations/supabase/client';
import { resolveInventoryValuation } from '@/lib/inventory/valuation-engine';

describe('Manual Stock Valuation Edge Case Audit', () => {
  const companyId = 'c3d578d3-c463-4f4c-af68-69baace539ec';

  it('verifies isolation between different report dates', async () => {
    const dateA = '2026-03-31';
    const dateB = '2026-04-01';
    const valA = 500000;
    
    // Clear first
    await supabase.from('inventory_manual_valuations').delete().eq('company_id', companyId);

    // Save for date A
    await supabase.from('inventory_manual_valuations').insert({
      company_id: companyId,
      as_of_date: dateA,
      valuation_paise: valA
    });

    // Resolve for date A
    const resultA = await resolveInventoryValuation(companyId, dateA, [], [], []);
    expect(resultA).toBe(valA);

    // Resolve for date B - should fall back to WAC (0 since items are empty)
    const resultB = await resolveInventoryValuation(companyId, dateB, [], [], []);
    expect(resultB).toBe(0);
  });

  it('verifies that as_of_date is the primary lookup key, preventing bleed-over', async () => {
    // Even if FY labels are technically the same (e.g. split years), 
    // as_of_date must isolate records.
    const date1 = '2026-03-31';
    const date2 = '2027-03-31';
    
    await supabase.from('inventory_manual_valuations').delete().eq('company_id', companyId);

    await supabase.from('inventory_manual_valuations').insert([
      { company_id: companyId, as_of_date: date1, valuation_paise: 1000, financial_year: 'FY 25-26' },
      { company_id: companyId, as_of_date: date2, valuation_paise: 2000, financial_year: 'FY 26-27' }
    ]);

    const res1 = await resolveInventoryValuation(companyId, date1, [], [], []);
    const res2 = await resolveInventoryValuation(companyId, date2, [], [], []);

    expect(res1).toBe(1000);
    expect(res2).toBe(2000);
  });
});
