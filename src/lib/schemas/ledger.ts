import { z } from "zod";
import { optionalString, optionalGstin, optionalEmail } from "./common";

export const GST_REGISTRATION_TYPES = [
  { value: "regular", label: "Regular" },
  { value: "composition", label: "Composition" },
  { value: "unregistered", label: "Unregistered" },
  { value: "consumer", label: "Consumer (B2C)" },
  { value: "sez", label: "SEZ" },
  { value: "overseas", label: "Overseas" },
  { value: "uin", label: "UIN holder" },
] as const;

export const MSME_CLASSIFICATIONS = [
  { value: "micro", label: "Micro" },
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
] as const;

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
  gst_registration_type: z.string().optional(),
  msme_registered: z.boolean().optional(),
  msme_udyam_no: optionalString(19),
  msme_classification: z.string().optional(),
});
export type LedgerFormInput = z.infer<typeof ledgerFormSchema>;
