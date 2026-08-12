// Helpers to compose payment-reminder messages and open WhatsApp / mailto links.
import { supabase } from "@/integrations/supabase/client";
import { formatINR } from "@/lib/money";

export interface ReminderContext {
  partyName: string;
  amountPaise: number;
  invoiceNo?: string;
  invoiceDate?: string;
  daysOverdue: number;
  companyName: string;
}

export function renderReminder(template: string, ctx: ReminderContext): string {
  return template
    .replaceAll("{party}", ctx.partyName)
    .replaceAll("{amount}", formatINR(ctx.amountPaise))
    .replaceAll("{invoice_no}", ctx.invoiceNo || "—")
    .replaceAll("{invoice_date}", ctx.invoiceDate || "—")
    .replaceAll("{days}", String(ctx.daysOverdue))
    .replaceAll("{company}", ctx.companyName);
}

export function whatsappLink(phone: string, message: string): string {
  const clean = phone.replace(/[^0-9]/g, "");
  const num = clean.length === 10 ? `91${clean}` : clean;
  return `https://wa.me/${num}?text=${encodeURIComponent(message)}`;
}

export function mailtoLink(email: string, subject: string, body: string): string {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export async function logReminder(opts: {
  companyId: string;
  ledgerId: string;
  voucherId?: string | null;
  channel: "whatsapp" | "email" | "sms";
  message: string;
  sentBy: string;
}): Promise<void> {
  await supabase.from("payment_reminders").insert({
    company_id: opts.companyId,
    ledger_id: opts.ledgerId,
    voucher_id: opts.voucherId || null,
    channel: opts.channel,
    message: opts.message,
    sent_by: opts.sentBy,
    status: "sent",
  });
}
