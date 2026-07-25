// Morning briefing bundle — the "human colleague" surface.
//
// Combines a warm greeting, a few current KPIs, and the anomaly list into
// one object the dashboard card renders. Everything is derived from the
// local IndexedDB cache; zero LLM tokens, zero credits, runs offline.

import { readVouchers } from "@/lib/offline/cache-read";
import { scanAllAnomalies, type Anomaly } from "./anomalies";

export interface BriefingKpis {
  todaysVouchers: number;
  weekSalesPaise: number;
  weekPurchasePaise: number;
  lastVoucherDate: string | null;
}

export interface BriefingBundle {
  companyId: string;
  date: string;               // ISO date the briefing was generated for
  greeting: string;           // "Good morning" / "Namaste" style
  kpis: BriefingKpis;
  anomalies: Anomaly[];
  hasContent: boolean;        // true if there's anything worth showing
}

function greetingFor(now: Date, userName?: string): string {
  const h = now.getHours();
  const partOfDay = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const dayName = now.toLocaleString("en-IN", { weekday: "long" });
  const suffix = userName ? `, ${userName}` : "";
  return `${partOfDay}${suffix} — it's ${dayName}.`;
}

function isoToday(): string { return new Date().toISOString().slice(0, 10); }
function isoAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export async function buildBriefing(
  companyId: string,
  opts?: { userName?: string; now?: Date },
): Promise<BriefingBundle> {
  const now = opts?.now ?? new Date();
  const today = isoToday();
  const weekStart = isoAgo(6);

  const [weekVouchers, anomalies] = await Promise.all([
    readVouchers(companyId, { from: weekStart, to: today }),
    scanAllAnomalies(companyId),
  ]);

  let todaysVouchers = 0;
  let weekSalesPaise = 0;
  let weekPurchasePaise = 0;
  let lastVoucherDate: string | null = null;
  for (const v of weekVouchers as any[]) {
    const d = String(v.voucher_date ?? "");
    if (d === today) todaysVouchers++;
    if (!lastVoucherDate || d > lastVoucherDate) lastVoucherDate = d;
    const total = Number(v.total_paise ?? 0);
    if (v.voucher_type === "sales") weekSalesPaise += total;
    else if (v.voucher_type === "purchase") weekPurchasePaise += total;
  }

  return {
    companyId,
    date: today,
    greeting: greetingFor(now, opts?.userName),
    kpis: { todaysVouchers, weekSalesPaise, weekPurchasePaise, lastVoucherDate },
    anomalies,
    hasContent: anomalies.length > 0 || todaysVouchers > 0 || weekSalesPaise > 0,
  };
}

// Per-day, per-company dismissal — briefing re-appears every morning.
const DISMISS_KEY = "ym_briefing_dismissed";
export function briefingDismissed(companyId: string, date = isoToday()): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const map = JSON.parse(raw) as Record<string, string>;
    return map[companyId] === date;
  } catch { return false; }
}
export function dismissBriefing(companyId: string, date = isoToday()): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    const map = raw ? JSON.parse(raw) as Record<string, string> : {};
    map[companyId] = date;
    window.localStorage.setItem(DISMISS_KEY, JSON.stringify(map));
  } catch { /* ignore */ }
}
