import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Manual Stock Valuation Regression Suite
 *
 * Verifies:
 * 1. Data persistence (Save/Retrieve)
 * 2. Precedence (Manual > WAC)
 * 3. Recovery (Clear -> WAC Fallback)
 * 4. Isolation (Per-Date)
 *
 * The backend client is mocked with an in-memory table. Real rows are
 * tenant-isolated by RLS (company membership), so hitting the live
 * database from a test runner is neither possible nor desirable.
 */

type Row = { company_id: string; as_of_date: string; valuation_paise: number };
const store: Row[] = [];

function makeQuery(mode: 'select' | 'delete') {
  const filters: Partial<Row> = {};
  const api = {
    eq(col: keyof Row, val: string) {
      (filters as Record<string, unknown>)[col] = val;
      return api;
    },
    match(rows: Row[]) {
      return rows.filter((r) =>
        Object.entries(filters).every(([k, v]) => (r as Record<string, unknown>)[k] === v),
      );
    },
    async maybeSingle() {
      const hit = api.match(store)[0];
      return { data: hit ?? null, error: null };
    },
    then(resolve: (v: { data: Row[] | null; error: null }) => unknown) {
      if (mode === 'delete') {
        for (const r of api.match(store)) store.splice(store.indexOf(r), 1);
        return Promise.resolve({ data: null, error: null }).then(resolve);
      }
      return Promise.resolve({ data: api.match(store), error: null }).then(resolve);
    },
  };
  return api;
}

function upsertRows(rows: Row | Row[]) {
  for (const r of Array.isArray(rows) ? rows : [rows]) {
    const existing = store.find(
      (s) => s.company_id === r.company_id && s.as_of_date === r.as_of_date,
    );
    if (existing) existing.valuation_paise = r.valuation_paise;
    else store.push({ ...r });
  }
  return Promise.resolve({ data: null, error: null });
}

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => makeQuery('select'),
      delete: () => makeQuery('delete'),
      insert: (rows: Row | Row[]) => upsertRows(rows),
      upsert: (rows: Row | Row[]) => upsertRows(rows),
    }),
  },
}));

const { resolveInventoryValuation } = await import('@/lib/inventory/valuation-engine');
const { supabase } = await import('@/integrations/supabase/client');

describe('Manual Stock Valuation Integrity', () => {
  const companyId = 'c3d578d3-c463-4f4c-af68-69baace539ec';
  const asOfDate = '2026-03-31';
  const manualValuePaise = 125000000; // 12.5L

  beforeEach(() => {
    store.length = 0;
  });

  it('should store and retrieve a manual valuation', async () => {
    const { error: insertError } = await supabase
      .from('inventory_manual_valuations')
      .upsert(
        { company_id: companyId, as_of_date: asOfDate, valuation_paise: manualValuePaise },
        { onConflict: 'company_id,as_of_date' },
      );
    expect(insertError).toBeNull();

    const { data, error: fetchError } = await supabase
      .from('inventory_manual_valuations')
      .select('*')
      .eq('company_id', companyId)
      .eq('as_of_date', asOfDate)
      .maybeSingle();

    expect(fetchError).toBeNull();
    expect((data as unknown as Row).valuation_paise).toBe(manualValuePaise);
  });

  it('should resolve manual valuation over WAC when present', async () => {
    await supabase
      .from('inventory_manual_valuations')
      .upsert(
        { company_id: companyId, as_of_date: asOfDate, valuation_paise: manualValuePaise },
        { onConflict: 'company_id,as_of_date' },
      );

    const resolved = await resolveInventoryValuation(companyId, asOfDate, [], [], []);
    expect(resolved).toBe(manualValuePaise);
  });

  it('should fall back to WAC after clearing manual valuation', async () => {
    await supabase
      .from('inventory_manual_valuations')
      .upsert(
        { company_id: companyId, as_of_date: asOfDate, valuation_paise: manualValuePaise },
        { onConflict: 'company_id,as_of_date' },
      );

    await supabase
      .from('inventory_manual_valuations')
      .delete()
      .eq('company_id', companyId)
      .eq('as_of_date', asOfDate);

    const resolved = await resolveInventoryValuation(companyId, asOfDate, [], [], []);
    expect(resolved).toBe(0);
  });

  it('should maintain isolation between different dates', async () => {
    const date1 = '2026-03-30';
    const date2 = '2026-03-31';

    await supabase.from('inventory_manual_valuations').insert([
      { company_id: companyId, as_of_date: date1, valuation_paise: 1000 },
      { company_id: companyId, as_of_date: date2, valuation_paise: 2000 },
    ]);

    expect(await resolveInventoryValuation(companyId, date1, [], [], [])).toBe(1000);
    expect(await resolveInventoryValuation(companyId, date2, [], [], [])).toBe(2000);
  });

  it('should isolate valuations between companies', async () => {
    const other = '00000000-0000-4000-8000-000000000001';
    await supabase.from('inventory_manual_valuations').insert([
      { company_id: companyId, as_of_date: asOfDate, valuation_paise: 5000 },
    ]);

    expect(await resolveInventoryValuation(companyId, asOfDate, [], [], [])).toBe(5000);
    expect(await resolveInventoryValuation(other, asOfDate, [], [], [])).toBe(0);
  });
});
