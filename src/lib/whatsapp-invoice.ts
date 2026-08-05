// "Send via WhatsApp" for invoices — fully client-side and offline.
//
// Flow:
//   1. Generate/save the invoice PDF (same generator used by Print).
//   2. Copy the saved PDF onto the Windows clipboard as a native FILE
//      reference (CF_HDROP via the clipboard-win crate) so pasting into a
//      WhatsApp chat attaches the real multi-page PDF, not a bitmap.
//   3. Open a whatsapp:// desktop protocol or wa.me deep-link with a pre-filled
//      message (WhatsApp Desktop if installed, otherwise WhatsApp Web).
//   4. Toast telling the user to press Ctrl+V in the chat.
//
// A clipboard failure never blocks the flow — the WhatsApp link still opens so
// the file can be attached manually.

import { toast } from "sonner";
import { downloadInvoicePdf } from "@/lib/invoice-pdf";
import { formatINR } from "@/lib/money";
import { whatsappLink } from "@/lib/reminders";
import { openPathNative, getNativeRuntime } from "@/lib/native-bridge";

type Invoke = (cmd: string, args?: unknown) => Promise<unknown>;

/** Resolve a Tauri `invoke` across v1 and v2 without throwing on a missing module. */
async function resolveInvoke(): Promise<Invoke | null> {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    __TAURI__?: { core?: { invoke?: Invoke }; tauri?: { invoke?: Invoke }; invoke?: Invoke };
  };
  // v2 global, v1 global, very old global
  const globalInvoke = w.__TAURI__?.core?.invoke ?? w.__TAURI__?.tauri?.invoke ?? w.__TAURI__?.invoke;
  if (typeof globalInvoke === "function") return globalInvoke;

  // Dynamic imports — each guarded so a missing package never rejects upward.
  try {
    const m = (await import(/* @vite-ignore */ "@tauri-apps/api/core")) as { invoke?: Invoke };
    if (typeof m?.invoke === "function") return m.invoke;
  } catch {
    /* not a v2 runtime */
  }
  return null;
}

/** Copy absolute file paths to the OS clipboard as a native file reference. */
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

/**
 * Normalise an Indian phone number for WhatsApp deep-linking.
 * - strips spaces, dashes, brackets, leading `+` / `00`
 * - 10 digits → prefix `91`
 * - already country-coded (11-15 digits) → left as-is
 */
export function sanitizePhoneForWhatsApp(raw: string | null | undefined): string {
  let digits = (raw ?? "").replace(/[^0-9+]/g, "");
  digits = digits.replace(/^\+/, "").replace(/^00/, "");
  digits = digits.replace(/[^0-9]/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `91${digits}`;
  // 11-digit local form with a leading 0 (e.g. 0XXXXXXXXXX)
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

/**
 * Constructs the target WhatsApp link.
 * Prefers native protocol handler (`whatsapp://`) when a phone number is present
 * to target WhatsApp Desktop directly without re-navigating or refreshing web tabs.
 */
function buildWhatsAppLink(phone: string, message: string): string {
  const encodedText = encodeURIComponent(message);
  
  if (phone) {
    // Native desktop scheme — opens target chat in installed WhatsApp Desktop app without reloading browser tab
    return `whatsapp://send?phone=${phone}&text=${encodedText}`;
  }

  // Fallback for general text sharing without a phone number
  return `https://wa.me/?text=${encodedText}`;
}

export async function sendInvoiceViaWhatsApp(
  voucherId: string,
  companyId: string,
): Promise<void> {
  let info: Awaited<ReturnType<typeof downloadInvoicePdf>>;
  try {
    info = await downloadInvoicePdf(voucherId, companyId);
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

  const copied = info.path ? await copyFilesToClipboardNative([info.path]) : false;

  const phone = sanitizePhoneForWhatsApp(info.partyPhone);
  
  // Build primary URI (whatsapp:// desktop scheme)
  const link = buildWhatsAppLink(phone, message);

  // Attempt opening via native shell first (Tauri shell open)
  let opened = await openPathNative(link);

  // Fallback: If desktop app protocol fails or user is on Web, open web link in standard browser window
  if (!opened.ok && typeof window !== "undefined") {
    const webFallbackUrl = phone
      ? `https://web.whatsapp.com/send/?phone=${phone}&text=${encodeURIComponent(message)}`
      : `https://wa.me/?text=${encodeURIComponent(message)}`;

    window.open(webFallbackUrl, "_blank", "noopener");
  }

  if (copied) {
    toast.success("Invoice copied — press Ctrl+V in the chat to attach the PDF.");
  } else {
    toast.message("WhatsApp opened with your message", {
      description: info.path
        ? `Attach the PDF manually from: ${info.path}`
        : "The invoice PDF was saved — attach it manually in the chat.",
    });
  }

  if (!phone) {
    toast.warning("No phone number on this party", {
      description: "Add a phone number in the party ledger to open the chat directly.",
    });
  }
}
