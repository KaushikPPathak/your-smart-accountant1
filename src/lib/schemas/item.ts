import { z } from "zod";

export const itemFormSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(120),
  // HSN is mandatory; the digit rule (4/6/8 by turnover) is checked by itemHsnError.
  hsn_code: z.string().trim().min(1, "HSN / SAC code is required for every item").max(20),
  unit: z.string().min(1, "Select a unit").max(10),
  gst_rate: z.string(),
  purchase_price: z.string().optional(),
  sale_price: z.string().optional(),
  opening_stock_qty: z.string().optional(),
  opening_stock_rate: z.string().optional(),
  reorder_level: z.string().optional(),
});
export type ItemFormInput = z.infer<typeof itemFormSchema>;
