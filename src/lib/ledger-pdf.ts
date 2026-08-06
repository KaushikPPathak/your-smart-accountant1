// src/lib/ledger-pdf.ts
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
  // Call your backend API that generates the ledger statement PDF
  // Return the file path + metadata shown above.
  // If you reuse Puppeteer/Playwright from invoice-pdf.ts, just swap the HTML template.
}
