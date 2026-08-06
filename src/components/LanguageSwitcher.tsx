export function LanguageSwitcher() {
  return (
    <div className="p-4 max-w-2xl mx-auto bg-card rounded-lg border shadow-sm my-8">
      <h2 className="text-xl font-bold mb-4 text-foreground">WhatsApp Integration Status</h2>
      <div className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
        We have implemented a custom native WhatsApp integration for the Tauri desktop wrapper. Please review and incorporate the following changes.

## What was built

1. Embedded WhatsApp Web inside a Tauri `WebviewWindow` (not a browser tab).
   - Users log in once via QR code / phone number inside the app.
   - The session persists forever because the WebView2 data directory is pinned to `%LOCALAPPDATA%\\com.smartaccountant.app\\EBWebView\\`.
   - On every "Send via WhatsApp" click, the existing window is reused and navigated directly to the target customer chat.

2. Native file clipboard copy (CF_HDROP on Windows).
   - The invoice PDF is copied to the OS clipboard as a real file reference.
   - User presses Ctrl+V in the WhatsApp chat to attach the PDF.

3. Background PDF prefetch and in-memory cache so repeated sends are instant.

4. Audio feedback beep on successful clipboard copy.

5. Keyboard shortcut: Alt + W triggers send.

## Protected Files (DO NOT overwrite these)

- `src-tauri/src/lib.rs` — Contains the Rust commands `copy_files_to_clipboard` and `show_whatsapp_web`, plus the pinned WebView2 data directory logic.
- `src-tauri/capabilities/default.json` — Contains permissions including `core:window:allow-show`, `core:window:allow-set-focus`, and the `whatsapp_web` window entry.
- `src/lib/whatsapp-invoice.ts` — Contains all frontend logic: `sendInvoiceViaWhatsApp`, `useWhatsAppShortcut`, `sanitizePhoneForWhatsApp`, `prefetchInvoicePdf`, and `copyFilesToClipboardNative`.

## Frontend integration required

Wherever the "Send via WhatsApp" button or action exists in the UI, ensure it calls:

```ts
import { sendInvoiceViaWhatsApp, useWhatsAppShortcut } from "@/lib/whatsapp-invoice";

// In the invoice detail / voucher view component:
useWhatsAppShortcut(voucherId, companyId, true);

// On button click:
<button onClick={() => sendInvoiceViaWhatsApp(voucherId, companyId)}>
  Send via WhatsApp
</button>
```
      </div>
    </div>
  );
}
