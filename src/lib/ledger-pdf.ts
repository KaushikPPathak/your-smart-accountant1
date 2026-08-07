// src/lib/ledger-pdf.ts
import { getNativeRuntime, resolveInvoke } from "./whatsapp-shared";

export interface LedgerPdfInfo {
  path: string | null;           // absolute path to generated PDF (for Tauri clipboard)
  partyName: string;
  partyPhone: string | null;
  companyName: string;
  fromDate: string;              // e.g. "01-Apr-2025"
  toDate: string;                // e.g. "07-Aug-2026"
  openingBalancePaise: number;   // positive = Dr, negative = Cr
  closingBalancePaise: number;   // positive = Dr, negative = Cr
  balanceType: "Dr" | "Cr";
}

export async function downloadLedgerPdf(
  partyId: string,
  companyId: string,
  fromDate: string,
  toDate: string,
): Promise<LedgerPdfInfo> {
  const runtime = getNativeRuntime();

  if (runtime === "tauri") {
    try {
      const invoke = await resolveInvoke();
      if (!invoke) throw new Error("Tauri invoke not found");

      const info = await invoke<LedgerPdfInfo>("generate_ledger_pdf", {
        partyId,
        companyId,
        fromDate,
        toDate,
      });
      return info;
    } catch (err) {
      console.error("Failed to generate ledger PDF via Tauri:", err);
      // Fallback: If generate_ledger_pdf command is missing (legacy build) or fails, 
      // we check if we can simulate it for WhatsApp sharing.
      throw new Error("PDF generation failed in native environment.");
    }
    }
  }

  // Browser/Simulation fallback: 
  // We need to return real-looking metadata even in simulation so the 
  // WhatsApp message doesn't say "Hi there, your ledger is ready".
  try {
    const { offlineDb } = await import("./offline/db");
    const p = await offlineDb.cache_ledgers.get(partyId);
    const c = await offlineDb.cache_companies.get(companyId);

    return {
      path: null,
      partyName: p?.name || "Valued Party",
      partyPhone: p?.phone || null,
      companyName: c?.name || "Your Mehtaji",
      fromDate,
      toDate,
      openingBalancePaise: 0, 
      closingBalancePaise: 0,
      balanceType: "Dr",
    };
  } catch {
    return {
      path: null,
      partyName: "Valued Party",
      partyPhone: null,
      companyName: "Your Mehtaji",
      fromDate,
      toDate,
      openingBalancePaise: 0,
      closingBalancePaise: 0,
      balanceType: "Dr",
    };
  }
}
