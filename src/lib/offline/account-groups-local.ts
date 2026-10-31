// Group Manager data for the local-only build: custom sub-groups and renamed
// group labels, per company. Stored only in this PC's books.
import { offlineDb as db } from "@/lib/offline/db";
import { newId } from "@/lib/utils/sys-utils";
import { emitDataChange } from "@/lib/ai/cache-events";

export interface LocalSubgroup {
  id: string;
  parent_group_code: string;
  name: string;
}

export interface LocalOverride {
  group_code: string;
  label: string;
}

export async function listSubgroupsLocal(companyId: string): Promise<LocalSubgroup[]> {
  const rows: any[] = await db.cache_account_subgroups.where("company_id").equals(companyId).toArray();
  return rows
    .filter((r) => !r.deleted_at)
    .map((r) => ({ id: String(r.id), parent_group_code: String(r.parent_group_code), name: String(r.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listOverridesLocal(companyId: string): Promise<LocalOverride[]> {
  const rows: any[] = await db.cache_account_group_overrides.where("company_id").equals(companyId).toArray();
  return rows.map((r) => ({ group_code: String(r.group_code), label: String(r.label) }));
}

export async function addSubgroupLocal(companyId: string, parentCode: string, name: string): Promise<void> {
  const now = new Date().toISOString();
  await db.cache_account_subgroups.put({
    id: newId(),
    company_id: companyId,
    parent_group_code: parentCode,
    name,
    deleted_at: null,
    created_at: now,
    updated_at: now,
  });
  emitDataChange(companyId, "ledger");
}

export async function renameSubgroupLocal(id: string, name: string): Promise<void> {
  const n = await db.cache_account_subgroups.update(id, { name, updated_at: new Date().toISOString() });
  if (!n) throw new Error("Sub-group not found on this PC");
}

/** Soft delete: ledgers tagged to it fall back to the parent group. */
export async function deleteSubgroupLocal(id: string): Promise<void> {
  const n = await db.cache_account_subgroups.update(id, { deleted_at: new Date().toISOString() });
  if (!n) throw new Error("Sub-group not found on this PC");
}

export async function setOverrideLocal(companyId: string, groupCode: string, label: string): Promise<void> {
  const existing: any = await db.cache_account_group_overrides
    .where("[company_id+group_code]").equals([companyId, groupCode]).first();
  const now = new Date().toISOString();
  if (existing) {
    await db.cache_account_group_overrides.update(existing.id, { label, updated_at: now });
  } else {
    await db.cache_account_group_overrides.put({
      id: newId(), company_id: companyId, group_code: groupCode, label, created_at: now, updated_at: now,
    });
  }
  emitDataChange(companyId, "ledger");
}

export async function removeOverrideLocal(companyId: string, groupCode: string): Promise<void> {
  await db.cache_account_group_overrides
    .where("[company_id+group_code]").equals([companyId, groupCode]).delete();
  emitDataChange(companyId, "ledger");
}
