import { describe, it, expect, beforeEach } from 'vitest';
import { supabase } from '@/integrations/supabase/client';
import { resolveInventoryValuation } from '@/lib/inventory/valuation-engine';

/**
 * Manual Stock Valuation Regression Suite
 * 
 * Verifies:
 * 1. Data persistence (Save/Retrieve)
 * 2. Precedence (Manual > WAC)
 * 3. Recovery (Clear -> WAC Fallback)
 * 4. Isolation (Per-Date)
 * 
 * NOTE: These tests use 'service_role' behavior via the sandbox auth context 
 * to verify logic, bypassing standard RLS for regression verification.
 */
describe('Manual Stock Valuation Integrity', () => {
  // Use a stable test UUID for the company
  const companyId = 'c3d578d3-c463-4f4c-af68-69baace539ec';
  const asOfDate = '2026-03-31';
  const manualValuePaise = 125000000; // 12.5L

  beforeEach(async () => {
    // Cleanup any existing test data for this specific date
    // We use standard supabase client which in tests might have service_role 
    // or be pre-authenticated in the environment.
    await supabase
      .from('inventory_manual_valuations')
      .delete()
      .eq('company_id', companyId)
      .eq('as_of_date', asOfDate);
  });

  it('should store and retrieve a manual valuation', async () => {
    // We attempt the insert. If RLS fails in Vitest, we'll know the environment 
    // needs an authenticated session.
    const { error: insertError } = await supabase
      .from('inventory_manual_valuations')
      .upsert({
        company_id: companyId,
        as_of_date: asOfDate,
        valuation_paise: manualValuePaise,
        updated_at: new Date().toISOString()
      }, { onConflict: 'company_id,as_of_date' });

    if (insertError) {
       console.error("Insert Error:", insertError);
    }
    expect(insertError).toBeNull();

    const { data, error: fetchError } = await supabase
      .from('inventory_manual_valuations')
      .select('*')
      .eq('company_id', companyId)
      .eq('as_of_date', asOfDate)
      .maybeSingle();

    expect(fetchError).toBeNull();
    expect(data?.valuation_paise).toBe(manualValuePaise);
  });

  it('should resolve manual valuation over WAC when present', async () => {
    await supabase
      .from('inventory_manual_valuations')
      .upsert({
        company_id: companyId,
        as_of_date: asOfDate,
        valuation_paise: manualValuePaise,
      }, { onConflict: 'company_id,as_of_date' });

    const resolved = await resolveInventoryValuation(
      companyId,
      asOfDate,
      [], // no items = WAC is 0
      [], 
      []
    );

    expect(resolved).toBe(manualValuePaise);
  });

  it('should fall back to WAC after clearing manual valuation', async () => {
    await supabase
      .from('inventory_manual_valuations')
      .upsert({
        company_id: companyId,
        as_of_date: asOfDate,
        valuation_paise: manualValuePaise,
      }, { onConflict: 'company_id,as_of_date' });

    await supabase
      .from('inventory_manual_valuations')
      .delete()
      .eq('company_id', companyId)
      .eq('as_of_date', asOfDate);

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
    
    await supabase.from('inventory_manual_valuations').delete().eq('company_id', companyId);

    await supabase.from('inventory_manual_valuations').insert([
      { company_id: companyId, as_of_date: date1, valuation_paise: 1000 },
      { company_id: companyId, as_of_date: date2, valuation_paise: 2000 }
    ]);

    const val1 = await resolveInventoryValuation(companyId, date1, [], [], []);
    const val2 = await resolveInventoryValuation(companyId, date2, [], [], []);

    expect(val1).toBe(1000);
    expect(val2).toBe(2000);
  });
});


