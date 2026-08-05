// "Send via WhatsApp" for invoices — fully client-side and offline.
//
// Flow:
//   1. Generate/save the invoice PDF (same generator used by Print).
//   2. Copy the saved PDF onto the Windows clipboard as a native FILE
//      reference (CF_HDROP via the clipboard-win crate) so pasting into a
//      WhatsApp chat attaches the real multi-page PDF, not a bitmap.
//   3. Open a wa.me deep-link with a pre-filled message (WhatsApp Desktop if
//      installed, otherwise WhatsApp Web).
//   4. Toast telling the user to press Ctrl+V in the chat.
//
// A clipboard failure never blocks the flow — the wa.me link still opens so
// the file can be attached manually.
import { toast } from "sonner";
import { downloadInvoicePdf } from "@/lib/invoice-pdf";
import { formatINR } from "@/lib/money";
import { whatsappLink } from "@/lib/reminders";
import { openPathNative, getNativeRuntime } from "@/lib/native-bridge";

/** Copy absolute file paths to the OS clipboard as a native file reference. */
export async function copyFilesToClipboardNative(paths: string[]): Promise<boolean> {
  if (getNativeRuntime() !== "tauri" || !paths.length) return false;
  try {
    const w = window as unknown as {
      __TAURI__?: { core?: { invoke?: (cmd: string, args?: unknown) => Promise<unknown> } };
    };
    const invoke: (cmd: string, args?: unknown) => Promise<unknown> =
      w.__TAURI__?.core?.invoke ??
      (await import("@tauri-apps/api/core").then((m) => m.invoke as (c: string, a?: unknown) => Promise<unknown>));
    await invoke("copy_files_to_clipboard", { paths });
    return true;
  } catch {
    return false;
  }
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

  const phone = (info.partyPhone || "").replace(/[^0-9]/g, "");
  const link = phone
    ? whatsappLink(phone, message)
    : `https://wa.me/?text=${encodeURIComponent(message)}`;

  // Open WhatsApp Desktop / Web. Native shell first, browser tab as fallback.
  const opened = await openPathNative(link);
  if (!opened.ok && typeof window !== "undefined") {
    window.open(link, "_blank", "noopener");
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
