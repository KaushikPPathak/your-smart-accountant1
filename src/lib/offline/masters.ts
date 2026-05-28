// Offline-aware writes for master tables (ledgers, items).
//
// When online, behaves like a direct Supabase call and returns the persisted
// row. When offline, generates a client-side UUID, queues the mutation in
// the durable outbox, and returns a synthesized row so the UI can proceed
// optimistically. The sync worker replays the queue on reconnect.

import { supabase } from "@/integrations/supabase/client";
import { isOnlineNow } from "./online-status";
import { enqueueWrite } from "./outbox";

function newId(): string {
  return crypto.randomUUID();
}

// ---------- Ledgers ---------------------------------------------------------

export interface LedgerInsertPayload {
  company_id: string;
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type: any;
  group_code?: string | null;
  subgroup_id?: string | null;
  gstin?: string | null;
  pan?: string | null;
  state?: string | null;
  state_code?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  opening_balance_paise?: number;
  opening_balance_is_debit?: boolean;
  credit_limit_paise?: number;
  credit_days?: number;
}

export interface LedgerRow {
  id: string;
  name: string;
  type: string;
  state_code: string | null;
  gstin: string | null;
  gst_treatment: string | null;
}

export async function createLedger(payload: LedgerInsertPayload): Promise<LedgerRow> {
  if (isOnlineNow()) {
    const { data, error } = await supabase
      .from("ledgers")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insert(payload as any)
      .select("id, name, type, state_code, gstin, gst_treatment")
      .single();
    if (error) throw error;
    return data as LedgerRow;
  }
  const id = newId();
  await enqueueWrite({
    op: "insert",
    table: "ledgers",
    payload: { ...payload, id },
    company_id: payload.company_id,
    label: `Ledger: ${payload.name}`,
  });
  return {
    id,
    name: payload.name,
    type: String(payload.type),
    state_code: payload.state_code ?? null,
    gstin: payload.gstin ?? null,
    gst_treatment: "regular",
  };
}

export async function updateLedger(
  id: string,
  companyId: string,
  values: Partial<LedgerInsertPayload>,
): Promise<LedgerRow | null> {
  if (isOnlineNow()) {
    const { data, error } = await supabase
      .from("ledgers")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update(values as any)
      .eq("id", id)
      .select("id, name, type, state_code, gstin, gst_treatment")
      .single();
    if (error) throw error;
    return data as LedgerRow;
  }
  await enqueueWrite({
    op: "update",
    table: "ledgers",
    payload: { id, values },
    company_id: companyId,
    label: `Update ledger: ${values.name ?? id.slice(0, 8)}`,
  });
  return null;
}

export async function deleteLedger(id: string, companyId: string, label?: string): Promise<void> {
  if (isOnlineNow()) {
    const { error } = await supabase.from("ledgers").delete().eq("id", id);
    if (error) throw error;
    return;
  }
  await enqueueWrite({
    op: "delete",
    table: "ledgers",
    payload: { id },
    company_id: companyId,
    label: `Delete ledger: ${label ?? id.slice(0, 8)}`,
  });
}

export async function deactivateLedger(id: string, companyId: string): Promise<void> {
  if (isOnlineNow()) {
    const { error } = await supabase.from("ledgers").update({ is_active: false }).eq("id", id);
    if (error) throw error;
    return;
  }
  await enqueueWrite({
    op: "update",
    table: "ledgers",
    payload: { id, values: { is_active: false } },
    company_id: companyId,
    label: `Deactivate ledger: ${id.slice(0, 8)}`,
  });
}

// ---------- Items -----------------------------------------------------------

export interface ItemInsertPayload {
  company_id: string;
  name: string;
  hsn_code?: string | null;
  unit: string;
  gst_rate: number;
  purchase_price_paise?: number;
  sale_price_paise?: number;
  opening_stock_qty?: number;
  opening_stock_rate_paise?: number;
  reorder_level?: number;
}

export interface ItemRow {
  id: string;
  name: string;
  unit: string;
  gst_rate: number;
  hsn_code: string | null;
}

export async function createItem(payload: ItemInsertPayload): Promise<ItemRow> {
  if (isOnlineNow()) {
    const { data, error } = await supabase
      .from("items")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insert(payload as any)
      .select("id, name, unit, gst_rate, hsn_code")
      .single();
    if (error) throw error;
    return data as ItemRow;
  }
  const id = newId();
  await enqueueWrite({
    op: "insert",
    table: "items",
    payload: { ...payload, id },
    company_id: payload.company_id,
    label: `Item: ${payload.name}`,
  });
  return {
    id,
    name: payload.name,
    unit: payload.unit,
    gst_rate: payload.gst_rate,
    hsn_code: payload.hsn_code ?? null,
  };
}

export async function updateItem(
  id: string,
  companyId: string,
  values: Partial<ItemInsertPayload>,
): Promise<ItemRow | null> {
  if (isOnlineNow()) {
    const { data, error } = await supabase
      .from("items")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update(values as any)
      .eq("id", id)
      .select("id, name, unit, gst_rate, hsn_code")
      .single();
    if (error) throw error;
    return data as ItemRow;
  }
  await enqueueWrite({
    op: "update",
    table: "items",
    payload: { id, values },
    company_id: companyId,
    label: `Update item: ${values.name ?? id.slice(0, 8)}`,
  });
  return null;
}

export async function deleteItem(id: string, companyId: string, label?: string): Promise<void> {
  if (isOnlineNow()) {
    const { error } = await supabase.from("items").delete().eq("id", id);
    if (error) throw error;
    return;
  }
  await enqueueWrite({
    op: "delete",
    table: "items",
    payload: { id },
    company_id: companyId,
    label: `Delete item: ${label ?? id.slice(0, 8)}`,
  });
}

export async function deactivateItem(id: string, companyId: string): Promise<void> {
  if (isOnlineNow()) {
    const { error } = await supabase.from("items").update({ is_active: false }).eq("id", id);
    if (error) throw error;
    return;
  }
  await enqueueWrite({
    op: "update",
    table: "items",
    payload: { id, values: { is_active: false } },
    company_id: companyId,
    label: `Deactivate item: ${id.slice(0, 8)}`,
  });
}
