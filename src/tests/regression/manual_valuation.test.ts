import { describe, it, expect, beforeEach } from 'vitest';
import { supabase } from '@/integrations/supabase/client';
import { resolveInventoryValuation } from '@/lib/inventory/valuation-engine';

describe('Manual Stock Valuation Integrity', () => {
  // Use the valid company UUID found in the sandbox
  const companyId = 'c3d578d3-c463-4f4c-af68-69baace539ec';
  const asOfDate = '2026-03-31';
  const manualValuePaise = 125000000; // 12.5L

  beforeEach(async () => {
    // Cleanup any existing test data for this specific date
    await supabase
      .from('inventory_manual_valuations')
      .delete()
      .eq('company_id', companyId)
      .eq('as_of_date', asOfDate);
  });

  it('should store and retrieve a manual valuation', async () => {
    const { error: insertError } = await supabase
      .from('inventory_manual_valuations')
      .insert({
        company_id: companyId,
        as_of_date: asOfDate,
        valuation_paise: manualValuePaise,
      });

    expect(insertError).toBeNull();

    const { data, error: fetchError } = await supabase
      .from('inventory_manual_valuations')
      .select('*')
      .eq('company_id', companyId)
      .eq('as_of_date', asOfDate)
      .single();

    expect(fetchError).toBeNull();
    expect(data.valuation_paise).toBe(manualValuePaise);
  });

  it('should resolve manual valuation over WAC when present', async () => {
    // 1. Insert manual override
    await supabase
      .from('inventory_manual_valuations')
      .insert({
        company_id: companyId,
        as_of_date: asOfDate,
        valuation_paise: manualValuePaise,
      });

    // 2. Call resolver
    const resolved = await resolveInventoryValuation(
      companyId,
      asOfDate,
      [], // items
      [], // vouchers
      []  // voucherItems
    );

    expect(resolved).toBe(manualValuePaise);
  });

  it('should fall back to WAC (0 in this test) after clearing manual valuation', async () => {
    // 1. Insert
    await supabase
      .from('inventory_manual_valuations')
      .insert({
        company_id: companyId,
        as_of_date: asOfDate,
        valuation_paise: manualValuePaise,
      });

    // 2. Delete/Clear
    const { error: deleteError } = await supabase
      .from('inventory_manual_valuations')
      .delete()
      .eq('company_id', companyId)
      .eq('as_of_date', asOfDate);

    expect(deleteError).toBeNull();

    // 3. Resolve again
    const resolved = await resolveInventoryValuation(
      companyId,
      asOfDate,
      [],
      [],
      []
    );

    expect(resolved).toBe(0);
  });

  it('should maintain isolation between different dates', async () => {
    const date1 = '2026-03-30';
    const date2 = '2026-03-31';
    
    // Cleanup
    await supabase.from('inventory_manual_valuations').delete().eq('company_id', companyId).in('as_of_date', [date1, date2]);

    await supabase.from('inventory_manual_valuations').insert([
      { company_id: companyId, as_of_date: date1, valuation_paise: 1000 },
      { company_id: companyId, as_of_date: date2, valuation_paise: 2000 }
    ]);

    const val1 = await resolveInventoryValuation(companyId, date1, [], [], []);
    const val2 = await resolveInventoryValuation(companyId, date2, [], [], []);

    expect(val1).toBe(1000);
    expect(val2).toBe(2000);
    
    // Cleanup
    await supabase.from('inventory_manual_valuations').delete().eq('company_id', companyId).in('as_of_date', [date1, date2]);
  });
});

