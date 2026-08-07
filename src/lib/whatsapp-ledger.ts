// src/lib/whatsapp-ledger.ts
// Ledger-statement WhatsApp sharing. Alt + L to send.

import { useEffect } from "react";
import { toast } from "sonner";
import { formatINR } from "@/lib/money";
import { downloadLedgerPdf } from "@/lib/ledger-pdf";
import {
  copyFilesToClipboardNative,
  playSuccessBeep,
  sanitizePhoneForWhatsApp,
  buildWhatsAppWebUrl,
  showWhatsAppWeb,
} from "@/lib/whatsapp-shared";

const pdfCache = new Map<string, Awaited<ReturnType<typeof downloadLedgerPdf>>>();

function buildLedgerMessage(opts: {
  customerName: string;
  fromDate: string;
  toDate: string;
  openingBalancePaise: number;
  closingBalancePaise: number;
  balanceType: "Dr" | "Cr";
  businessName: string;
}): string {
  const opening = formatINR(Math.abs(opts.openingBalancePaise));
  const closing = formatINR(Math.abs(opts.closingBalancePaise));
  
  // Clean dates for the message (they might be YYYY-MM-DD from the DB)
  // Converting from YYYY-MM-DD to DD-MM-YYYY as requested
  const f = opts.fromDate.split("-").reverse().join("-");
  const t = opts.toDate.split("-").reverse().join("-");

  return `Hi ${opts.customerName}, your ledger statement (${f} – ${t}) is ready.

Opening Balance: ₹ ${opening} ${opts.openingBalancePaise >= 0 ? "Dr" : "Cr"}

Closing Balance: ₹ ${closing} ${opts.balanceType}

Please find the detailed statement attached — ${opts.businessName}`;
}

export async function prefetchLedgerPdf(
  partyId: string,
  companyId: string,
  fromDate: string,
  toDate: string,
): Promise<void> {
  const cacheKey = `${companyId}_${partyId}_${fromDate}_${toDate}`;
  if (pdfCache.has(cacheKey)) return;
  try {
    const info = await downloadLedgerPdf(partyId, companyId, fromDate, toDate);
    pdfCache.set(cacheKey, info);
  } catch {
    /* silent prefetch failure */
  }
}

let isSending = false;

export async function sendLedgerViaWhatsApp(
  partyId: string,
  companyId: string,
  fromDate: string,
  toDate: string,
): Promise<void> {
  if (isSending) return;
  isSending = true;

  const cacheKey = `${companyId}_${partyId}_${fromDate}_${toDate}`;
  let info: Awaited<ReturnType<typeof downloadLedgerPdf>>;

  try {
    if (pdfCache.has(cacheKey)) {
      info = pdfCache.get(cacheKey)!;
    } else {
      info = await downloadLedgerPdf(partyId, companyId, fromDate, toDate);
      pdfCache.set(cacheKey, info);
    }
  } catch (err) {
    toast.error("Could not prepare the ledger statement PDF", {
      description: err instanceof Error ? err.message : String(err),
    });
    isSending = false;
    return;
  }

  const message = buildLedgerMessage({
    customerName: info.partyName || "there",
    fromDate: info.fromDate,
    toDate: info.toDate,
    openingBalancePaise: info.openingBalancePaise,
    closingBalancePaise: info.closingBalancePaise,
    balanceType: info.balanceType,
    businessName: info.companyName || "",
  });

  const phone = sanitizePhoneForWhatsApp(info.partyPhone);

  // 1. Copy PDF to OS clipboard
  const copied = info.path ? await copyFilesToClipboardNative([info.path]) : false;
  console.log("Ledger PDF clipboard copy result:", copied, "Path:", info.path);
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
    toast.success("Ledger PDF ready to attach!", {
      description: phone 
        ? "WhatsApp is opening. Please focus the chat and press Ctrl + V to attach the PDF." 
        : "No phone number found. Focus WhatsApp, select a contact, and press Ctrl + V to attach.",
      duration: 12000,
      action: {
        label: "Copy Path",
        onClick: () => info.path && navigator.clipboard.writeText(info.path),
      },
    });
  } else {
    toast.message("WhatsApp opened", {
      description: info.path
        ? "Attach PDF manually (Ctrl + V). File saved at: " + info.path
        : "The ledger PDF was saved — attach it manually in the chat.",
    });
  }

  isSending = false;
}

export function useLedgerWhatsAppShortcut(
  partyId: string | undefined,
  companyId: string | undefined,
  fromDate: string | undefined,
  toDate: string | undefined,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled || !partyId || !companyId || !fromDate || !toDate) return;

    prefetchLedgerPdf(partyId, companyId, fromDate, toDate);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === "l" || e.key === "L")) {
        e.preventDefault();
        sendLedgerViaWhatsApp(partyId, companyId, fromDate, toDate);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [partyId, companyId, fromDate, toDate, enabled]);
}
