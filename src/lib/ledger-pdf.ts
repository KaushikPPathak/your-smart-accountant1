// src/lib/ledger-pdf.ts
import { getNativeRuntime, resolveInvoke } from "./whatsapp-shared";
import { recordFailure, recordStage } from "./crash-log";
import { writeFile, BaseDirectory } from "@tauri-apps/plugin-fs";

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

      // We use generate_ledger_pdf to get the metadata AND the PDF path.
      const info = await invoke<LedgerPdfInfo>("generate_ledger_pdf", {
        partyId,
        companyId,
        fromDate,
        toDate,
      });

      // Verification: ensure the path returned is an absolute filesystem path.
      const absolute = !!info.path && /^([a-zA-Z]:[\\\/]|\\\\|\/)/.test(info.path);
      recordStage("whatsapp", "pdf", {
        path: info.path ?? null,
        absolute,
        party: info.partyName,
        source: "native",
      });
      if (info.path && !absolute) {
        recordFailure("whatsapp", new Error("Native PDF generator returned a non-absolute path"), {
          stage: "pdf",
          path: info.path,
        });
      }

      return info;
    } catch (err) {
      recordFailure("whatsapp", err, { stage: "pdf", command: "generate_ledger_pdf" });
    }

  }

  // Browser/Simulation fallback: 
  // We need to return real-looking metadata even in simulation so the 
  // WhatsApp message doesn't say "Hi there, your ledger is ready".
  recordStage("whatsapp", "pdf", { path: null, absolute: false, source: "fallback", runtime });
  try {
    const { offlineDb } = await import("./offline/db");
    const p = (await offlineDb.cache_ledgers.get(partyId)) as any;
    const c = (await offlineDb.cache_companies.get(companyId)) as any;

    // Calculate real opening balance from IndexedDB if in simulation
    const entries = await offlineDb.cache_voucher_entries
      .where("[company_id+ledger_id]")
      .equals([companyId, partyId])
      .toArray();
    
    const liveEntries = (entries as any[]).filter(e => e.is_deleted !== true);
    const voucherIds = Array.from(new Set(liveEntries.map(e => e.voucher_id)));
    const vouchers = await offlineDb.cache_vouchers.where("id").anyOf(voucherIds).toArray();
    const vMap = new Map(vouchers.filter((v: any) => v.is_deleted !== true).map((v: any) => [String(v.id), v]));

    let movementBefore = 0;
    let totalDr = 0;
    let totalCr = 0;

    for (const e of liveEntries) {
      const v = vMap.get(String(e.voucher_id));
      if (!v) continue;
      const vDate = v.voucher_date || v.date || "";
      if (vDate && vDate < fromDate) {
        movementBefore += (e.debit_paise || 0) - (e.credit_paise || 0);
      } else if (vDate <= toDate) {
        totalDr += (e.debit_paise || 0);
        totalCr += (e.credit_paise || 0);
      }
    }

    const obSigned = (p?.opening_balance_is_debit ? 1 : -1) * (p?.opening_balance_paise || 0);
    const openingPaise = obSigned + movementBefore;
    const closingPaise = openingPaise + totalDr - totalCr;

    return {
      path: null,
      partyName: p?.name || "Valued Party",
      partyPhone: p?.phone || null,
      companyName: c?.name || "Your Mehtaji",
      fromDate,
      toDate,
      openingBalancePaise: openingPaise,
      closingBalancePaise: closingPaise,
      balanceType: closingPaise >= 0 ? "Dr" : "Cr",
    };
  } catch (err) {
    console.error("Simulation fallback failed:", err);
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
