// src/lib/whatsapp-ledger.ts
// Ledger-statement WhatsApp sharing. Alt + L to send.

import { useEffect } from "react";
import { toast } from "sonner";
import { formatINR } from "@/lib/money";
import { downloadLedgerPdf } from "@/lib/ledger-pdf";
import { recordFailure, recordStage } from "@/lib/crash-log";
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
  
  // Clean dates for the message (YYYY-MM-DD → DD-MM-YYYY)
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

  // Validate PDF path before attempting clipboard copy
  let copied = false;
  if (info.path && typeof info.path === "string") {
    const isAbsolute = /^([a-zA-Z]:[\\\/]|\\\\|\/)/.test(info.path);
    if (isAbsolute) {
      recordStage("whatsapp", "path-check", { path: info.path, absolute: true });
      copied = await copyFilesToClipboardNative([info.path]);
      recordStage("whatsapp", "clipboard", { copied });
    } else {
      recordFailure("whatsapp", new Error(`PDF path is not absolute: ${info.path}`), { stage: "path-check" });
    }
  } else {
    recordFailure("whatsapp", new Error("downloadLedgerPdf returned no path — PDF was not saved to disk"), {
      stage: "path-check",
      path: info.path ?? null,
    });
  }

  if (copied) playSuccessBeep();

  // 2. Focus / navigate WhatsApp Web
  const waUrl = buildWhatsAppWebUrl(phone, message);
  try {
    await showWhatsAppWeb(waUrl);
  } catch (err) {
    toast.error("WhatsApp window not available", {
      description: err instanceof Error ? err.message : "Please ensure WhatsApp Web is loaded in the app.",
      action: { label: "Show details", onClick: () => window.location.assign("/app/diagnostics") },
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
    toast.error("Could not copy PDF to clipboard", {
      description: info.path
        ? "The file exists but could not be placed on the clipboard. Try attaching it manually from: " + info.path
        : "The PDF was not saved to a file path. The bug is in ledger-pdf.ts — it must return an absolute filesystem path.",
      duration: 10000,
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
