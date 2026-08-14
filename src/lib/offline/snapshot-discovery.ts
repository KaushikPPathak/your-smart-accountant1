// src/lib/offline/snapshot-discovery.ts
//
// DISCOVERY ENGINE: Scans the local snapshots/ folder on boot to re-register
// companies that are present on disk but missing from the IndexedDB list.
// Handles cases where the database was reset or the profile was lost.
//
// This is idempotent: existing companies are skipped.
// Authoritative recovery source: <APPLOCALDATA>/snapshots/<YYYY-MM-DD>/<companySlug>.json

import { listDirectoriesNative, readAbsoluteTextFileNative, isDesktopRuntime } from "@/lib/native-bridge";
import { getAppPaths } from "@/lib/app-paths";
import { offlineDb } from "./db";
import { isBackupEnvelope, type BackupEnvelope } from "@/lib/backup-policy";
import type { CompanyBackup } from "@/lib/backup";


interface DiscoveredCompany {
  id: string;
  name: string;
  mode: string;
  snapshotPath: string;
  date: string;
}

/**
 * Scans for snapshots and injects missing companies into the IndexedDB picker.
 * Returns the number of newly discovered companies.
 */
export async function discoverCompaniesFromSnapshots(): Promise<number> {
  if (!isDesktopRuntime()) return 0;

  try {
    const paths = await getAppPaths();
    if (!paths?.root) return 0;

    const { join } = await import("@tauri-apps/api/path");
    const snapshotRoot = await join(paths.root, "snapshots");

    // 1. List all date-based snapshot folders (e.g. 2026-08-14)
    const folderRes = await listDirectoriesNative(snapshotRoot);
    if (!folderRes.ok || !folderRes.entries?.length) return 0;

    // Sort folders newest first so we find the latest metadata
    const sortedFolders = folderRes.entries
      .filter(name => /^\d{4}-\d{2}-\d{2}$/.test(name))
      .sort((a, b) => b.localeCompare(a));

    const latestSnapshots = new Map<string, DiscoveredCompany>();
    const existingIds = new Set((await offlineDb.companies.toArray()).map(c => c.id));

    // 2. Scan folders until we've processed all or hit a limit
    for (const folder of sortedFolders) {
      const folderPath = await join(snapshotRoot, folder);
      const filesRes = await listDirectoriesNative(folderPath);
      
      if (filesRes.ok && filesRes.entries) {
        for (const fileName of filesRes.entries) {
          if (!fileName.endsWith(".json")) continue;
          
          const filePath = await join(folderPath, fileName);
          const company = await peekCompanyMetadata(filePath);
          
          if (company && !existingIds.has(company.id)) {
            // Only keep the latest one found across all folders
            if (!latestSnapshots.has(company.id)) {
              latestSnapshots.set(company.id, {
                ...company,
                snapshotPath: filePath,
                date: folder
              });
            }
          }
        }
      }
    }

    if (latestSnapshots.size === 0) return 0;

    // 3. Register discovered companies
    let count = 0;
    for (const company of latestSnapshots.values()) {
      try {
        await offlineDb.transaction("rw", offlineDb.companies, offlineDb.cache_companies, async () => {
          // Re-verify existence inside transaction
          const exists = await offlineDb.companies.get(company.id);
          if (exists) return;

          await offlineDb.companies.put({
            id: company.id,
            name: company.name,
            has_password: false // Reset to no password on recovery
          });

          await offlineDb.cache_companies.put({
            id: company.id,
            name: company.name,
            mode: company.mode || "trial_local",
            updated_at: new Date().toISOString()
          });
          
          count++;
        });
      } catch (err) {
        console.warn(`Failed to register discovered company ${company.name}:`, err);
      }
    }

    if (count > 0) {
      console.log(`✅ Discovery: found and registered ${count} companies from local snapshots.`);
    }

    return count;
  } catch (err) {
    console.warn("Snapshot discovery failed:", err);
    return 0;
  }
}

/**
 * Reads just the start of a snapshot file to extract company ID and Name.
 */
async function peekCompanyMetadata(absPath: string): Promise<{ id: string; name: string; mode: string } | null> {
  try {
    const res = await readAbsoluteTextFileNative(absPath);
    if (!res.ok || !res.text) return null;
    
    const j = JSON.parse(res.text) as any;
    
    // Support both wrapped envelopes (v2) and raw snapshots (v1)
    const payload = j.payload || j;
    
    // Sometimes the 'company' field is an object, sometimes it might be missing
    // in older/corrupt snapshots, try to find ID/Name in the payload directly too.
    const company = payload.company || payload;

    if (!company || !company.id || !company.name) {
       // If still missing, check for legacy 'company_id'/'company_name' keys
       const id = company.id || payload.company_id || payload.id;
       const name = company.name || payload.company_name || payload.name;
       if (!id || !name) return null;
       return {
         id: String(id),
         name: String(name),
         mode: String(company.mode || payload.mode || "trial_local")
       };
    }
    
    return {
      id: String(company.id),
      name: String(company.name),
      mode: String(company.mode || "trial_local")
    };

  } catch {
    return null;
  }
}
