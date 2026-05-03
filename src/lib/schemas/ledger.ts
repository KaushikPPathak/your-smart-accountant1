import { z } from "zod";
import { optionalString, optionalGstin, optionalEmail } from "./common";

export const ledgerFormSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(120),
  type: z.string().min(1, "Select a ledger type"),
  gstin: optionalGstin,
  pan: optionalString(10),
  state_code: optionalString(3),
  state: optionalString(50),
  address: optionalString(500),
  phone: optionalString(20),
  email: optionalEmail,
  opening_balance: z.string().optional(),
  opening_balance_is_debit: z.boolean(),
  credit_limit: z.string().optional(),
  credit_days: z.string().optional(),
});
export type LedgerFormInput = z.infer<typeof ledgerFormSchema>;