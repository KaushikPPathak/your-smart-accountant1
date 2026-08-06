// src/lib/whatsapp-ledger.ts
// Same Tauri + WhatsApp Web pattern as whatsapp-invoice.ts, but for ledger statements.
// Alt + L shortcut to share. Reuses the same embedded WhatsApp Web window.

import { useEffect } from "react";
import { toast } from "sonner";
import { formatINR } from "@/lib/money";
import { getNativeRuntime } from "@/lib/native-bridge";
import { downloadLedgerPdf } from "@/lib/ledger-pdf"; // <-- you will create this

type Invoke = (cmd: string, args?: unknown) => Promise<unknown>;

const pdfCache = new Map<string, Awaited<ReturnType<typeof downloadLedgerPdf>>>();

/* ─────────── shared helpers (same as invoice file) ─────────── */

async function resolveInvoke(): Promise<Invoke | null> {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    __TAURI__?: { core?: { invoke?: Invoke }; tauri?: { invoke?: Invoke }; invoke?: Invoke };
  };
  const globalInvoke =
    w.__TAURI__?.core?.invoke ?? w.__TAURI__?.tauri?.invoke ?? w.__TAURI__?.invoke;
  if (typeof globalInvoke === "function") return globalInvoke;

  try {
    const m = (await import(/* @vite-ignore */ "@tauri-apps/api/core")) as { invoke?: Invoke };
    if (typeof m?.invoke === "function") return m.invoke;
  } catch {
    /* not a v2 runtime */
  }
  return null;
}

export async function copyFilesToClipboardNative(paths: string[]): Promise<boolean> {
  if (getNativeRuntime() !== "tauri" || !paths.length) return false;
  try {
    const invoke = await resolveInvoke();
    if (!invoke) return false;
    await invoke("copy_files_to_clipboard", { paths });
    return true;
  } catch {
    return false;
  }
}

function playSuccessBeep() {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch {
    /* ignore audio policy blocks */
  }
}

export function sanitizePhoneForWhatsApp(raw: string | null | undefined): string {
  let digits = (raw ?? "").replace(/[^0-9+]/g, "");
  digits = digits.replace(/^\+/, "").replace(/^00/, "");
  digits = digits.replace(/[^0-9]/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  if (digits.length < 10 || digits.length > 15) return "";
  return digits;
}

function buildWhatsAppWebUrl(phone: string, message: string): string {
  const encodedText = encodeURIComponent(message);
  if (phone) {
    return `https://web.whatsapp.com/send/?phone=${phone}&text=${encodedText}`;
  }
  return `https://web.whatsapp.com/send/?text=${encodedText}`;
}

/* ─────────── ledger-specific builders ─────────── */

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
  return `Hi ${opts.customerName}, your ledger statement (${opts.fromDate} – ${opts.toDate}) is ready.

Opening Balance: ${opening} ${opts.openingBalancePaise >= 0 ? "Dr" : "Cr"}
Closing Balance: ${closing} ${opts.balanceType}

Please find the detailed statement attached — ${opts.businessName}`;
}

/* ─────────── public API ─────────── */

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

export async function sendLedgerViaWhatsApp(
  partyId: string,
  companyId: string,
  fromDate: string,
  toDate: string,
): Promise<void> {
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

  // 1. Copy PDF to OS clipboard as native file reference
  const copied = info.path ? await copyFilesToClipboardNative([info.path]) : false;
  if (copied) {
    playSuccessBeep();
  }

  // 2. Open or focus the embedded WhatsApp Web window
  const waUrl = buildWhatsAppWebUrl(phone, message);

  try {
    const invoke = await resolveInvoke();
    if (!invoke) throw new Error("Tauri not available");
    await invoke("show_whatsapp_web", { url: waUrl });
  } catch {
    if (typeof window !== "undefined") {
      window.open(waUrl, "_blank");
    }
  }

  // 3. Toast feedback
  if (copied) {
    toast.success("Ledger PDF Copied to Clipboard!", {
      description: "Focus the WhatsApp window and press Ctrl + V to attach.",
      duration: 5000,
      action: {
        label: "Copy Path",
        onClick: () => {
          if (info.path) navigator.clipboard.writeText(info.path);
        },
      },
    });
  } else {
    toast.message("WhatsApp opened", {
      description: info.path
        ? `Attach PDF manually from: ${info.path}`
        : "The ledger PDF was saved — attach it manually in the chat.",
    });
  }

  if (!phone) {
    toast.warning("No phone number found", {
      description: "Add a phone number in party ledger to target chat directly.",
    });
  }
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
