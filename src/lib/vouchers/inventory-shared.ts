
/**
 * Shared inventory processing and validation for vouchers.
 */

import { parseToPaise } from "@/lib/utils/currency-utils";

export interface InventoryLine {
  id: string;
  item_id: string;
  description: string;
  qty: string | number;
  rate: string | number;
  discount: string | number;
  gst_rate: string | number;
}

/**
 * Calculate line totals for an inventory item.
 */
export function calculateInventoryLine(line: InventoryLine) {
  const qty = typeof line.qty === "string" ? parseFloat(line.qty || "0") : line.qty;
  const rate = typeof line.rate === "string" ? parseToPaise(line.rate || "0") : line.rate;
  const discount = typeof line.discount === "string" ? parseFloat(line.discount || "0") : line.discount;
  
  const grossPaise = Math.round(qty * rate);
  const discountPaise = Math.round((grossPaise * discount) / 100);
  const taxablePaise = grossPaise - discountPaise;
  
  const gstRate = typeof line.gst_rate === "string" ? parseFloat(line.gst_rate || "0") : line.gst_rate;
  const gstPaise = Math.round((taxablePaise * gstRate) / 100);
  
  return {
    grossPaise,
    discountPaise,
    taxablePaise,
    gstPaise,
    totalPaise: taxablePaise + gstPaise
  };
}
