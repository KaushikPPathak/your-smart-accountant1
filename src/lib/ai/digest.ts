// Phase J — Digest export.
//
// Turns the local morning briefing into a plain-text digest the proprietor
// can copy into WhatsApp/email or save as a .txt file. Generated entirely
// on-device from the briefing bundle; nothing is transmitted by the app
// itself — the user chooses where to paste it.

import { formatINR } from "@/lib/money";
import type { BriefingBundle } from "./briefing";

export function renderDigestText(bundle: BriefingBundle, companyName?: string): string {
  const lines: string[] = [];
  const head = companyName ? `${companyName} — daily digest` : "Daily digest";
  lines.push(head);
  lines.push(bundle.date);
  lines.push("");
  lines.push(`Vouchers entered today: ${bundle.kpis.todaysVouchers}`);
  lines.push(`Sales (last 7 days): ${formatINR(bundle.kpis.weekSalesPaise)}`);
  lines.push(`Purchases (last 7 days): ${formatINR(bundle.kpis.weekPurchasePaise)}`);
  if (bundle.kpis.lastVoucherDate) {
    lines.push(`Last voucher dated: ${bundle.kpis.lastVoucherDate}`);
  }

  if (bundle.anomalies.length) {
    lines.push("");
    lines.push(`Needs attention (${bundle.anomalies.length}):`);
    for (const a of bundle.anomalies.slice(0, 15)) {
      lines.push(`- [${a.severity.toUpperCase()}] ${a.title}${a.detail ? ` — ${a.detail}` : ""}`);
    }
    if (bundle.anomalies.length > 15) {
      lines.push(`- ...and ${bundle.anomalies.length - 15} more inside the app`);
    }
  } else {
    lines.push("");
    lines.push("No anomalies detected.");
  }

  lines.push("");
  lines.push("Generated on this device. Figures are from your local books.");
  return lines.join("\n");
}

export async function copyDigest(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function downloadDigest(text: string, fileName = "daily-digest.txt"): void {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
