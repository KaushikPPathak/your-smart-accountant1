// Pulls accounting context from the local SQLite "brain" and runs it
// through Headroom compression before handing it to the LLM.
//
// Every raw row set we fetch is also stashed in the CCR cache so the
// LLM can ask for the original rows back later via `retrieveOriginal`.

import { safeBrainSelect } from "@/brain/SqliteBrain";
import { cacheRowsForCcr, compressMessages } from "./headroom";

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
  ledgers: unknown[];
  parties: unknown[];
  recentVouchers: unknown[];
  recentEntries: unknown[];
}

async function fetchSnapshot(): Promise<RawSnapshot> {
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
  return { ledgers, parties, recentVouchers, recentEntries };
}

/**
 * Build a compressed context bundle for a user question.
 * Pulls raw rows from SQLite, caches them for CCR retrieval, and
 * runs them through Headroom before they leave the device.
 */
export async function buildCompressedContext(userQuestion: string): Promise<CompressedContext> {
  const snap = await fetchSnapshot();

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
