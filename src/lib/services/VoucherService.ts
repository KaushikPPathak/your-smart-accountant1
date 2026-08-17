import { supabase } from "@/integrations/supabase/client";

export interface VoucherCalculationResult {
  totalPaise: number;
  totalTaxPaise: number;
  itemCount: number;
}

/**
 * Domain service for core accounting voucher logic.
 * Centralizes business rules for data integrity and tax compliance.
 */
export class VoucherService {
  /**
   * Validates a voucher before saving.
   * Ensures essential fields are present and follow Indian accounting conventions.
   */
  static validate(voucher: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!voucher.voucher_date) errors.push("Voucher date is required");
    if (!voucher.voucher_type) errors.push("Voucher type is required");
    if (!voucher.party_ledger_id) errors.push("Party/Cash/Bank ledger is required");
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Calculates totals and taxes for a list of voucher items.
   * Handles GST calculation based on item rates and quantities.
   */
  static calculateTotals(items: any[]): VoucherCalculationResult {
    let totalPaise = 0;
    let totalTaxPaise = 0;

    for (const item of items) {
      const qty = parseFloat(item.quantity) || 0;
      const rate = Math.round((parseFloat(item.rate) || 0) * 100);
      const amount = Math.round(qty * rate);
      
      const taxRate = parseFloat(item.tax_rate) || 0;
      const taxAmount = Math.round((amount * taxRate) / 100);

      totalPaise += amount + taxAmount;
      totalTaxPaise += taxAmount;
    }

    return {
      totalPaise,
      totalTaxPaise,
      itemCount: items.length
    };
  }

  /**
   * Checks for downstream document dependencies.
   * Used to prevent deletion of source documents (e.g., Quotation) if they are linked.
   */
  static async checkDownstreamDependencies(voucherId: string): Promise<{ linked: boolean; targetNumber?: string; targetType?: string }> {
    const { offlineDb } = await import("@/lib/offline/db");
    const downstream = await offlineDb.cache_vouchers
      .where("original_voucher_id")
      .equals(voucherId)
      .first();

    if (downstream) {
      return {
        linked: true,
        targetNumber: (downstream as any).voucher_number,
        targetType: (downstream as any).voucher_type
      };
    }

    return { linked: false };
  }
}
