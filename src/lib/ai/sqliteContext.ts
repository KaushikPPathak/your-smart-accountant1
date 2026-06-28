// Pulls accounting context from the local SQLite "brain" and runs it
// through Headroom compression before handing it to the LLM.
//
// Every raw row set we fetch is also stashed in the CCR cache so the
// LLM can ask for the original rows back later via `retrieveOriginal`.

import { safeBrainSelect } from "@/brain/SqliteBrain";
import { cacheRowsForCcr, compressMessages } from "./headroom";
import {
  readCompanies,
  readLedgers,
  readVoucherEntriesForCompany,
  readVouchers,
  withCacheFallback,
} from "@/lib/offline/cache-read";

export interface AccountingContext {
  companyId?: string;
  ledgers?: number;
  parties?: number;
  recentVouchers?: number;
}

export interface CompressedContext {
  systemMessage: { role: "system"; content: string };
  userMessage: { role: "user"; content: string };
  ccrHashes: Record<string, string>;
  compressed: boolean;
}

interface RawSnapshot {
  source?: "sqlite" | "indexeddb";
  companyId?: string | null;
  companies?: unknown[];
  ledgers: unknown[];
  parties: unknown[];
  recentVouchers: unknown[];
  recentEntries: unknown[];
}

function resolveContextCompanyId(explicitCompanyId?: string | null): string | null {
  if (explicitCompanyId) return explicitCompanyId;
  if (typeof window === "undefined") return null;
  try { return localStorage.getItem("ym_active_company_id"); } catch { return null; }
}

function sliceRecent<T>(rows: T[], limit: number): T[] {
  return rows.slice(0, limit);
}

async function fetchIndexedDbSnapshot(companyId?: string | null): Promise<RawSnapshot> {
  const companies = await readCompanies();
  const targetCompanyId = companyId || String((companies as any[])[0]?.id ?? "") || null;
  if (!targetCompanyId) {
    return {
      source: "indexeddb",
      companyId: null,
      companies: companies as unknown[],
      ledgers: [],
      parties: [],
      recentVouchers: [],
      recentEntries: [],
    };
  }

  const [ledgers, vouchers, entries] = await Promise.all([
    readLedgers(targetCompanyId),
    readVouchers(targetCompanyId),
    readVoucherEntriesForCompany(targetCompanyId),
  ]);
  const normalizedLedgers = (ledgers as any[]).map((l) => ({
    id: l.id,
    name: l.name,
    group_name: l.group_name ?? l.group ?? l.type,
    type: l.type,
    gst_applicable: l.gst_applicable,
    gstin: l.gstin,
    opening_balance_paise: l.opening_balance_paise,
    opening_balance_is_debit: l.opening_balance_is_debit,
  }));
  const parties = normalizedLedgers.filter((l: any) => l.gstin || /debtor|creditor|party|customer|supplier/i.test(String(l.group_name ?? l.type ?? "")));

  return {
    source: "indexeddb",
    companyId: targetCompanyId,
    companies: companies as unknown[],
    ledgers: sliceRecent(normalizedLedgers, 500),
    parties: sliceRecent(parties, 500),
    recentVouchers: sliceRecent((vouchers as any[]).map((v) => ({
      id: v.id,
      voucher_type: v.voucher_type,
      date: v.voucher_date ?? v.date,
      voucher_number: v.voucher_number,
      total_amount: v.total_paise ?? v.total_amount,
      party_ledger_id: v.party_ledger_id,
    })), 100),
    recentEntries: sliceRecent((entries as any[]).map((e) => ({
      voucher_id: e.voucher_id,
      ledger_id: e.ledger_id,
      debit_paise: e.debit_paise,
      credit_paise: e.credit_paise,
    })), 200),
  };
}

async function fetchSqliteSnapshot(): Promise<RawSnapshot> {
  const [ledgers, parties, recentVouchers, recentEntries] = await Promise.all([
    safeBrainSelect(
      `SELECT id, name, group_name, gst_applicable FROM ledgers ORDER BY name LIMIT 500`,
    ),
    safeBrainSelect(
      `SELECT id, name, gstin, state FROM parties ORDER BY name LIMIT 500`,
    ),
    safeBrainSelect(
      `SELECT v.id, v.voucher_type, v.date, v.total_amount, p.name as party_name
       FROM vouchers v LEFT JOIN parties p ON v.party_id = p.id
       ORDER BY v.created_at DESC LIMIT 100`,
    ),
    safeBrainSelect(
      `SELECT ve.voucher_id, ve.ledger_id, ve.debit_paise, ve.credit_paise
       FROM voucher_entries ve
       ORDER BY ve.id DESC LIMIT 200`,
    ),
  ]);
  return { source: "sqlite", companyId: null, ledgers, parties, recentVouchers, recentEntries };
}

async function fetchSnapshot(companyId?: string | null): Promise<RawSnapshot> {
  return withCacheFallback<RawSnapshot>(
    async () => {
      const sqlite = await fetchSqliteSnapshot();
      const rowCount = sqlite.ledgers.length + sqlite.parties.length + sqlite.recentVouchers.length + sqlite.recentEntries.length;
      if (rowCount === 0) throw new Error("SQLite brain is empty; using IndexedDB offline cache");
      return sqlite;
    },
    async () => fetchIndexedDbSnapshot(companyId),
  );
}

/**
 * Build a compressed context bundle for a user question.
 * Pulls raw rows from SQLite, caches them for CCR retrieval, and
 * runs them through Headroom before they leave the device.
 */
export async function buildCompressedContext(userQuestion: string, companyId?: string | null): Promise<CompressedContext> {
  const snap = await fetchSnapshot(resolveContextCompanyId(companyId));

  const ccrHashes: Record<string, string> = {
    ledgers: cacheRowsForCcr("ledgers", snap.ledgers),
    parties: cacheRowsForCcr("parties", snap.parties),
    vouchers: cacheRowsForCcr("vouchers", snap.recentVouchers),
    voucher_entries: cacheRowsForCcr("voucher_entries", snap.recentEntries),
  };

  const systemMessage = {
    role: "system" as const,
    content:
      "You are an accounting assistant working with offline SQLite data. " +
      "The user's accounting context is attached as JSON. If you need the " +
      "exact, full row data for a specific record, request it by calling " +
      'the `retrieveOriginal` tool with the matching hash from "ccrHashes".',
  };

  const userMessage = {
    role: "user" as const,
    content: JSON.stringify(
      {
        question: userQuestion,
        ccrHashes,
        context: {
          source: snap.source,
          companyId: snap.companyId,
          companies: snap.companies,
          ledgers: snap.ledgers,
          parties: snap.parties,
          recentVouchers: snap.recentVouchers,
          recentEntries: snap.recentEntries,
        },
      },
      null,
      0,
    ),
  };

  const { messages, compressed } = await compressMessages([systemMessage, userMessage], {
    model: "local-webllm",
  });

  return {
    systemMessage: messages[0] as { role: "system"; content: string },
    userMessage: messages[1] as { role: "user"; content: string },
    ccrHashes,
    compressed,
  };
}
