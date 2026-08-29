import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Manual Stock Valuation Edge Case Audit
 *
 * Confirms the approved (company_id, as_of_date) design: a valuation
 * dated 31 March must never be applied to 1 April, and dates in
 * different financial years stay independent.
 *
 * The backend client is mocked with an in-memory table — real rows are
 * tenant-isolated by RLS, so the test runner cannot (and must not)
 * write to another company's data.
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
      return { data: api.match(store)[0] ?? null, error: null };
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

describe('Manual Stock Valuation Edge Case Audit', () => {
  const companyId = 'c3d578d3-c463-4f4c-af68-69baace539ec';

  beforeEach(() => {
    store.length = 0;
  });

  it('verifies isolation between different report dates (FY boundary)', async () => {
    const dateA = '2026-03-31';
    const dateB = '2026-04-01';
    const valA = 500000;

    await supabase
      .from('inventory_manual_valuations')
      .insert({ company_id: companyId, as_of_date: dateA, valuation_paise: valA });

    expect(await resolveInventoryValuation(companyId, dateA, [], [], [])).toBe(valA);
    // 1 April must fall back to WAC (0 with no items), not inherit 31 March.
    expect(await resolveInventoryValuation(companyId, dateB, [], [], [])).toBe(0);
  });

  it('verifies that as_of_date is the primary lookup key, preventing bleed-over', async () => {
    const date1 = '2026-03-31';
    const date2 = '2027-03-31';

    await supabase.from('inventory_manual_valuations').insert([
      { company_id: companyId, as_of_date: date1, valuation_paise: 1000 },
      { company_id: companyId, as_of_date: date2, valuation_paise: 2000 },
    ]);

    expect(await resolveInventoryValuation(companyId, date1, [], [], [])).toBe(1000);
    expect(await resolveInventoryValuation(companyId, date2, [], [], [])).toBe(2000);
  });
});
