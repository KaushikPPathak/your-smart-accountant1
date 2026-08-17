import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VoucherService } from '../VoucherService';

// Mock Supabase
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
    rpc: vi.fn(),
  },
}));

// Mock LocalStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value.toString(); },
    clear: () => { store = {}; },
    removeItem: (key: string) => { delete store[key]; },
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

describe('VoucherService', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('should validate required fields', () => {
    const invalidVoucher = { voucher_date: '' };
    const result = VoucherService.validate(invalidVoucher);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Voucher date is required');
  });

  it('should calculate totals and taxes correctly', () => {
    const items = [
      { quantity: 2, rate: 100, tax_rate: 18 }, // 200 + 36 = 236
      { quantity: 1, rate: 50, tax_rate: 5 },   // 50 + 2.5 = 52.5 -> 53 rounded
    ];
    const result = VoucherService.calculateTotals(items);
    
    // 200*100 = 20000 paise
    // 36*100 = 3600 paise
    // 50*100 = 5000 paise
    // 2.5*100 = 250 paise
    // Total: 20000 + 3600 + 5000 + 250 = 28850
    expect(result.totalPaise).toBe(28850);
    expect(result.totalTaxPaise).toBe(3850);
  });
});
