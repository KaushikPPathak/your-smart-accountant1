// src/lib/whatsapp-invoice.ts
// Embedded WhatsApp Web via Tauri WebviewWindow.
// Log in once via QR code. The window stays open/reused forever.
// On every invoice send, it reuses that same window and navigates to the chat.

import { useEffect } from "react";
import { toast } from "sonner";
import { downloadInvoicePdf } from "@/lib/invoice-pdf";
import { formatINR } from "@/lib/money";
import { getNativeRuntime } from "@/lib/native-bridge";

type Invoke = (cmd: string, args?: unknown) => Promise<unknown>;

const pdfCache = new Map<string, Awaited<ReturnType<typeof downloadInvoicePdf>>>();

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

function buildWhatsAppWebUrl(phone: string, message: string): string {
  const encodedText = encodeURIComponent(message);
  if (phone) {
    return `https://web.whatsapp.com/send/?phone=${phone}&text=${encodedText}`;
  }
  return `https://web.whatsapp.com/send/?text=${encodedText}`;
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

export async function sendInvoiceViaWhatsApp(
  voucherId: string,
  companyId: string,
): Promise<void> {
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
    return;
  }

  const message = buildMessage({
    customerName: info.partyName || "there",
    invoiceNumber: info.voucherNumber,
    amountPaise: info.totalPaise,
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
    // Fallback to system browser if anything fails
    if (typeof window !== "undefined") {
      window.open(waUrl, "_blank");
    }
  }

  // 3. Toast feedback
  if (copied) {
    toast.success("PDF Copied to Clipboard!", {
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
        : "The invoice PDF was saved — attach it manually in the chat.",
    });
  }

  if (!phone) {
    toast.warning("No phone number found", {
      description: "Add a phone number in party ledger to target chat directly.",
    });
  }
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
