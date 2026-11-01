// Partners, directors and other members of a company (share, profit-sharing
// ratio, capital contributed), kept in this PC's books.
import { offlineDb as db } from "@/lib/offline/db";
import { newId } from "@/lib/utils/sys-utils";

export async function listEntityMembersLocal(companyId: string): Promise<any[]> {
  const rows: any[] = await db.cache_entity_members.where("company_id").equals(companyId).toArray();
  return rows
    .filter((r) => !r.deleted_at)
    .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
}

export async function addEntityMemberLocal(companyId: string, values: Record<string, unknown>): Promise<any> {
  const now = new Date().toISOString();
  const row = { id: newId(), company_id: companyId, ...values, created_at: now, updated_at: now };
  await db.cache_entity_members.put(row);
  return row;
}

export async function updateEntityMemberLocal(id: string, patch: Record<string, unknown>): Promise<void> {
  const n = await db.cache_entity_members.update(id, { ...patch, updated_at: new Date().toISOString() });
  if (!n) throw new Error("Entry not found on this PC");
}

export async function deleteEntityMemberLocal(id: string): Promise<void> {
  await db.cache_entity_members.delete(id);
}
