// src/lib/whatsapp-invoice.ts
// Embedded WhatsApp Web via Tauri WebviewWindow.
// Log in once via QR code or phone number. The window stays open/reused forever.
// On send, it navigates the existing webview to the target chat and copies the PDF to clipboard.

import { useEffect } from "react";
import { toast } from "sonner";
import { downloadInvoicePdf } from "@/lib/invoice-pdf";
import { formatINR } from "@/lib/money";
import { openPathNative, getNativeRuntime } from "@/lib/native-bridge";

type Invoke = (cmd: string, args?: unknown) => Promise<unknown>;

// ── Lazy-loaded Tauri v2 API ───────────────────────────────────────────────
let WebviewWindowCtor: typeof import("@tauri-apps/api/webviewWindow").WebviewWindow | null = null;

async function loadWebviewApi(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (WebviewWindowCtor) return true;
  try {
    const mod = await import("@tauri-apps/api/webviewWindow");
    WebviewWindowCtor = mod.WebviewWindow;
    return true;
  } catch {
    return false;
  }
}

// ── Invoke resolver (v1 / v2 tolerant) ─────────────────────────────────────
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

// ── PDF cache ──────────────────────────────────────────────────────────────
const pdfCache = new Map<string, Awaited<ReturnType<typeof downloadInvoicePdf>>>();

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

// ── Clipboard (native CF_HDROP) ────────────────────────────────────────────
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

// ── Audio feedback ─────────────────────────────────────────────────────────
function playSuccessBeep() {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.08); // A5
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

// ── Phone sanitiser ────────────────────────────────────────────────────────
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

// ── Message builder ────────────────────────────────────────────────────────
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

// ── URL builder ────────────────────────────────────────────────────────────
function buildWhatsAppWebUrl(phone: string, message: string): string {
  const encodedText = encodeURIComponent(message);
  if (phone) {
    return `https://web.whatsapp.com/send/?phone=${phone}&text=${encodedText}`;
  }
  return `https://web.whatsapp.com/send/?text=${encodedText}`;
}

// ── Webview lifecycle helpers ──────────────────────────────────────────────
const WEBVIEW_LABEL = "whatsapp-web";

async function webviewExists(label: string): Promise<boolean> {
  const invoke = await resolveInvoke();
  if (!invoke) return false;
  try {
    return (await invoke("check_webview_window_exists", { label })) as boolean;
  } catch {
    return false;
  }
}

async function navigateWebview(label: string, url: string): Promise<void> {
  const invoke = await resolveInvoke();
  if (!invoke) throw new Error("Tauri invoke unavailable");
  await invoke("navigate_webview_window", { label, url });
}

/**
 * Creates the WhatsApp WebviewWindow on first use.
 * Reuses & navigates the same window on every subsequent call.
 * Session (login) persists because WebView2 shares the app data folder.
 */
async function ensureWhatsAppWebview(targetUrl?: string): Promise<void> {
  const hasApi = await loadWebviewApi();
  if (!hasApi || !WebviewWindowCtor) {
    throw new Error("Tauri WebviewWindow API unavailable");
  }

  const exists = await webviewExists(WEBVIEW_LABEL);

  if (exists) {
    const url = targetUrl || "https://web.whatsapp.com";
    await navigateWebview(WEBVIEW_LABEL, url);
    return;
  }

  // First time: open WhatsApp Web so user can scan QR or link via phone number
  const webview = new WebviewWindowCtor(WEBVIEW_LABEL, {
    url: targetUrl || "https://web.whatsapp.com",
    title: "WhatsApp",
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    center: true,
    resizable: true,
    minimizable: true,
    maximizable: true,
    closable: true,
    focus: true,
    visible: true,
    // Chrome-like UA prevents WhatsApp Web from blocking the WebView2 engine
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  });

  webview.once("tauri://created", () => {
    console.log("[WhatsApp] Webview created");
  });

  webview.once("tauri://error", (e: unknown) => {
    console.error("[WhatsApp] Webview creation failed:", e);
    toast.error("Failed to open WhatsApp window");
  });
}

// ── Main send entry ────────────────────────────────────────────────────────
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

  // 2. Open or navigate the embedded WhatsApp Webview
  const waUrl = buildWhatsAppWebUrl(phone, message);

  try {
    await ensureWhatsAppWebview(waUrl);
  } catch {
    // Fallback: system browser if Tauri webview fails for any reason
    if (typeof window !== "undefined") {
      window.open(waUrl, "_blank");
    } else {
      await openPathNative(waUrl);
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

// ── React Hook: Alt + W ────────────────────────────────────────────────────
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
