// src/lib/whatsapp-invoice.ts
// Invoice-specific WhatsApp sharing. Alt + W to send.

import { useEffect } from "react";
import { toast } from "sonner";
import { downloadInvoicePdf } from "@/lib/invoice-pdf";
import { formatINR } from "@/lib/money";
import {
  copyFilesToClipboardNative,
  playSuccessBeep,
  sanitizePhoneForWhatsApp,
  buildWhatsAppWebUrl,
  showWhatsAppWeb,
} from "@/lib/whatsapp-shared";

const pdfCache = new Map<string, Awaited<ReturnType<typeof downloadInvoicePdf>>>();

function buildMessage(opts: {
  customerName: string;
  invoiceNumber: string;
  amountPaise: number;
  businessName: string;
}): string {
  return `Hi ${opts.customerName}, your invoice ${opts.invoiceNumber} for ${formatINR(
    opts.amountPaise,
  )} is ready. Please find it attached — ${opts.businessName}`;
}

export async function prefetchInvoicePdf(voucherId: string, companyId: string): Promise<void> {
  const cacheKey = `${companyId}_${voucherId}`;
  if (pdfCache.has(cacheKey)) return;
  try {
    const info = await downloadInvoicePdf(voucherId, companyId);
    pdfCache.set(cacheKey, info);
  } catch {
    /* silent prefetch failure */
  }
}

let isSending = false;

export async function sendInvoiceViaWhatsApp(
  voucherId: string,
  companyId: string,
): Promise<void> {
  if (isSending) return;
  isSending = true;

  const cacheKey = `${companyId}_${voucherId}`;
  let info: Awaited<ReturnType<typeof downloadInvoicePdf>>;

  try {
    if (pdfCache.has(cacheKey)) {
      info = pdfCache.get(cacheKey)!;
    } else {
      info = await downloadInvoicePdf(voucherId, companyId);
      pdfCache.set(cacheKey, info);
    }
  } catch (err) {
    toast.error("Could not prepare the invoice PDF", {
      description: err instanceof Error ? err.message : String(err),
    });
    isSending = false;
    return;
  }

  const message = buildMessage({
    customerName: info.partyName || "there",
    invoiceNumber: info.voucherNumber,
    amountPaise: info.totalPaise,
    businessName: info.companyName || "",
  });

  const phone = sanitizePhoneForWhatsApp(info.partyPhone);

  // 1. Copy PDF to OS clipboard
  const copied = info.path ? await copyFilesToClipboardNative([info.path]) : false;
  if (copied) playSuccessBeep();

  // 2. Focus / navigate WhatsApp Web (never opens a browser popup)
  const waUrl = buildWhatsAppWebUrl(phone, message);
  try {
    await showWhatsAppWeb(waUrl);
  } catch (err) {
    console.error("showWhatsAppWeb failed:", err);
    toast.error("WhatsApp window not available", {
      description: "Please ensure WhatsApp Web is loaded in the app.",
    });
    isSending = false;
    return;
  }

  // 3. Feedback
  if (copied) {
    toast.success("Invoice PDF copied to clipboard!", {
      description: phone 
        ? "Focus the WhatsApp window and press Ctrl + V to attach." 
        : "No phone number found. Focus WhatsApp, select a contact, and press Ctrl + V to attach.",
      duration: 6000,
      action: {
        label: "Copy Path",
        onClick: () => info.path && navigator.clipboard.writeText(info.path),
      },
    });
  } else {
    toast.message("WhatsApp opened", {
      description: info.path
        ? `Attach PDF manually from: ${info.path}`
        : "The invoice PDF was saved — attach it manually in the chat.",
    });
  }

  isSending = false;
}

export function useWhatsAppShortcut(
  voucherId: string | undefined,
  companyId: string | undefined,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled || !voucherId || !companyId) return;

    prefetchInvoicePdf(voucherId, companyId);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === "w" || e.key === "W")) {
        e.preventDefault();
        sendInvoiceViaWhatsApp(voucherId, companyId);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [voucherId, companyId, enabled]);
}
