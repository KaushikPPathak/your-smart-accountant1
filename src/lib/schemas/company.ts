import { z } from "zod";
import { optionalString, optionalGstin, CIN_REGEX } from "./common";

export const companyFormSchema = z
  .object({
    name: z.string().trim().min(2, "Name is required").max(120),
    entity_status: z.enum(["individual", "huf", "aop", "pvt_ltd", "registered_firm", "trust"]),
    cin: optionalString(21),
    share_capital_lakhs: z.string().optional(),
    corpus_fund_lakhs: z.string().optional(),
    gstin: optionalGstin,
    pan: optionalString(10),
    state: optionalString(50),
    state_code: optionalString(3),
    address: optionalString(500),
    email: optionalString(255),
    phone: optionalString(20),
    financial_year_start: z.string().optional(),
    bank_name: optionalString(100),
    bank_account_no: optionalString(30),
    bank_ifsc: optionalString(15),
    bank_branch: optionalString(100),
    gst_registered: z.boolean(),
    gst_filing_frequency: z.enum(["monthly", "quarterly", "iff"]),
    inventory_enabled: z.boolean(),
    annual_turnover_lakhs: z.string().optional(),
    trial_local: z.boolean(),
    currency_code: z.string().trim().min(3).max(8).default("INR"),
    date_format: z.enum([
      "dd-mm-yyyy",
      "dd/mm/yyyy",
      "mm-dd-yyyy",
      "mm/dd/yyyy",
      "yyyy-mm-dd",
      "dd-mmm-yyyy",
    ]).default("dd-mm-yyyy"),
  })
  .superRefine((val, ctx) => {
    if (val.entity_status === "pvt_ltd" && val.cin && !CIN_REGEX.test(val.cin.toUpperCase())) {
      ctx.addIssue({ code: "custom", path: ["cin"], message: "Invalid CIN (e.g. U12345MH2020PTC123456)" });
    }
  });
export type CompanyFormInput = z.infer<typeof companyFormSchema>;