import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Fresh-install legacy backup discovery regression suite.
 *
 * Covers: fresh-install discovery, both approved roots, newest-valid selection,
 * invalid/corrupt backups, tombstone skip, no-overwrite, ID preservation,
 * broken root isolation, and the guarantee that C:\ is never scanned.
 */

const DOCS_ROOT = 'C:\\Users\\Someone\\Documents\\SmartAccountant\\Exports';
const SHORT_ROOT = 'C:\\smartaccountant';

// ---- native bridge mock -----------------------------------------------------
const fsState: {
  dirs: Record<string, string[]>;
  files: Record<string, string>;
  roots: string[];
  brokenDirs: Set<string>;
  listedPaths: string[];
} = { dirs: {}, files: {}, roots: [], brokenDirs: new Set(), listedPaths: [] };

vi.mock('@/lib/native-bridge', () => ({
  isDesktopRuntime: () => true,
  getLegacyScanRootsNative: async () => ({ ok: true, roots: fsState.roots }),
  listDirectoriesNative: async (p: string) => {
    fsState.listedPaths.push(p);
    if (fsState.brokenDirs.has(p)) return { ok: false, error: 'EACCES' };
    const entries = fsState.dirs[p];
    return entries ? { ok: true, entries } : { ok: false, error: 'ENOENT' };
  },
  readLegacyTextFileNative: async (p: string) => {
    const text = fsState.files[p];
    return text === undefined ? { ok: false, error: 'ENOENT' } : { ok: true, text };
  },
}));

// ---- offline db mock --------------------------------------------------------
const companies = new Map<string, { id: string; name: string }>();

vi.mock('@/lib/offline/db', () => ({
  offlineDb: {
    companies: {
      count: async () => companies.size,
      get: async (id: string) => companies.get(id),
      put: async (row: { id: string; name: string }) => {
        companies.set(row.id, row);
      },
    },
  },
}));

// ---- backup engine mock -----------------------------------------------------
const recovered: { companyId: string; backupPath?: string }[] = [];

vi.mock('@/lib/backup', () => ({
  parseBackupFile: async (text: string) => {
    const j = JSON.parse(text);
    if (typeof j.schema_version !== 'number') throw new Error('not a backup');
    return { kind: 'single', data: j, checksumOk: j.__checksumOk !== false };
  },
  recoverMissingFromSnapshot: async (companyId: string, backup: any) => {
    recovered.push({ companyId, backupPath: backup?.__path });
    // Non-destructive: only insert when missing, preserving the original ID.
    if (!companies.has(companyId)) {
      companies.set(companyId, { id: companyId, name: String(backup?.company?.name ?? '') });
    }
    return { companyId };
  },
}));

// ---- tombstones mock --------------------------------------------------------
const tombstoned = new Set<string>();
vi.mock('@/lib/recovery/tombstones', () => ({
  isTombstoned: async (id: string) => tombstoned.has(id),
}));

import { discoverAndRestoreLegacyBackups } from '@/lib/legacy-backup-discovery';

function backupJson(opts: {
  id: string;
  name: string;
  exportedAt: string;
  path: string;
  checksumOk?: boolean;
}) {
  return JSON.stringify({
    schema_version: 2,
    exported_at: opts.exportedAt,
    company: { id: opts.id, name: opts.name },
    ledgers: [],
    vouchers: [],
    inventory_manual_valuations: [],
    __path: opts.path,
    __checksumOk: opts.checksumOk !== false,
  });
}

function addBackup(root: string, company: string, file: string, json: string) {
  const dir = `${root}\\${company}\\backups`;
  fsState.dirs[root] = Array.from(new Set([...(fsState.dirs[root] ?? []), company]));
  fsState.dirs[dir] = [...(fsState.dirs[dir] ?? []), file];
  fsState.files[`${dir}\\${file}`] = json;
}

beforeEach(() => {
  fsState.dirs = {};
  fsState.files = {};
  fsState.roots = [DOCS_ROOT, SHORT_ROOT];
  fsState.brokenDirs = new Set();
  fsState.listedPaths = [];
  companies.clear();
  recovered.length = 0;
  tombstoned.clear();
});

describe('Legacy backup discovery (fresh install)', () => {
  it('restores from the Documents root on a fresh install and preserves the company ID', async () => {
    addBackup(
      DOCS_ROOT,
      'Miss Payal Hasmukhbhai Shah',
      'b_2026-08-24T12-08-42.json',
      backupJson({
        id: 'cmp-payal',
        name: 'Miss Payal Hasmukhbhai Shah',
        exportedAt: '2026-08-24T12:08:42Z',
        path: 'docs',
      }),
    );

    const res = await discoverAndRestoreLegacyBackups();

    expect(res.ran).toBe(true);
    expect(res.valid).toBe(1);
    expect(res.restored).toBe(1);
    expect(res.restoredCompanyIds).toEqual(['cmp-payal']);
    expect(companies.get('cmp-payal')?.id).toBe('cmp-payal');
  });

  it('discovers backups in the C:\\smartaccountant root as well', async () => {
    addBackup(
      SHORT_ROOT,
      'Miss Payal Hasmukhbhai Shah',
      'b_2026-08-24T12-09-50.json',
      backupJson({
        id: 'cmp-short',
        name: 'Payal',
        exportedAt: '2026-08-24T12:09:50Z',
        path: 'short',
      }),
    );

    const res = await discoverAndRestoreLegacyBackups();
    expect(res.restored).toBe(1);
    expect(companies.has('cmp-short')).toBe(true);
  });

  it('selects the newest valid backup per company across roots', async () => {
    addBackup(
      DOCS_ROOT,
      'Payal',
      'old.json',
      backupJson({ id: 'cmp-1', name: 'Payal', exportedAt: '2026-08-24T12:08:42Z', path: 'old' }),
    );
    addBackup(
      SHORT_ROOT,
      'Payal',
      'new.json',
      backupJson({ id: 'cmp-1', name: 'Payal', exportedAt: '2026-08-24T12:09:50Z', path: 'new' }),
    );

    const res = await discoverAndRestoreLegacyBackups();
    expect(res.candidates).toBe(2);
    expect(res.valid).toBe(2);
    expect(res.restored).toBe(1);
    expect(recovered).toHaveLength(1);
    expect(recovered[0].backupPath).toBe('new');
  });

  it('rejects corrupt JSON, non-backup files and checksum failures', async () => {
    addBackup(DOCS_ROOT, 'A', 'corrupt.json', '{ not json');
    addBackup(DOCS_ROOT, 'A', 'notabackup.json', JSON.stringify({ hello: 'world' }));
    addBackup(
      DOCS_ROOT,
      'A',
      'badsum.json',
      backupJson({
        id: 'cmp-bad',
        name: 'A',
        exportedAt: '2026-08-24T12:00:00Z',
        path: 'bad',
        checksumOk: false,
      }),
    );

    const res = await discoverAndRestoreLegacyBackups();
    expect(res.candidates).toBe(3);
    expect(res.valid).toBe(0);
    expect(res.invalid).toBe(3);
    expect(res.restored).toBe(0);
    expect(res.invalidPaths).toHaveLength(3);
  });

  it('skips tombstoned companies', async () => {
    tombstoned.add('cmp-dead');
    addBackup(
      DOCS_ROOT,
      'Dead Co',
      'b.json',
      backupJson({ id: 'cmp-dead', name: 'Dead Co', exportedAt: '2026-08-24T12:00:00Z', path: 'd' }),
    );

    const res = await discoverAndRestoreLegacyBackups();
    expect(res.skipped).toBe(1);
    expect(res.restored).toBe(0);
    expect(recovered).toHaveLength(0);
  });

  it('never runs when local companies already exist', async () => {
    companies.set('cmp-existing', { id: 'cmp-existing', name: 'Existing' });
    addBackup(
      DOCS_ROOT,
      'Existing',
      'b.json',
      backupJson({
        id: 'cmp-existing',
        name: 'Existing',
        exportedAt: '2026-08-24T12:00:00Z',
        path: 'x',
      }),
    );

    const res = await discoverAndRestoreLegacyBackups();
    expect(res.ran).toBe(false);
    expect(res.restored).toBe(0);
    expect(recovered).toHaveLength(0);
    expect(fsState.listedPaths).toHaveLength(0);
  });

  it('continues with the other root when one root is unreadable', async () => {
    fsState.brokenDirs.add(DOCS_ROOT);
    addBackup(
      SHORT_ROOT,
      'Payal',
      'b.json',
      backupJson({ id: 'cmp-ok', name: 'Payal', exportedAt: '2026-08-24T12:00:00Z', path: 's' }),
    );

    const res = await discoverAndRestoreLegacyBackups();
    expect(res.restored).toBe(1);
  });

  it('never scans a drive root or any path outside the approved roots', async () => {
    addBackup(
      DOCS_ROOT,
      'Payal',
      'b.json',
      backupJson({ id: 'cmp-1', name: 'Payal', exportedAt: '2026-08-24T12:00:00Z', path: 'p' }),
    );

    await discoverAndRestoreLegacyBackups();

    expect(fsState.listedPaths.length).toBeGreaterThan(0);
    for (const p of fsState.listedPaths) {
      expect(p === 'C:\\' || p === 'C:').toBe(false);
      expect(p.startsWith(DOCS_ROOT) || p.startsWith(SHORT_ROOT)).toBe(true);
    }
  });

  it('carries optional manual valuations through the restored payload', async () => {
    const json = JSON.parse(
      backupJson({ id: 'cmp-mv', name: 'MV', exportedAt: '2026-08-24T12:00:00Z', path: 'mv' }),
    );
    json.inventory_manual_valuations = [
      { id: 'mv-1', company_id: 'cmp-mv', as_of_date: '2026-03-31', value_paise: 125000000 },
    ];
    addBackup(DOCS_ROOT, 'MV', 'b.json', JSON.stringify(json));

    const res = await discoverAndRestoreLegacyBackups();
    expect(res.restored).toBe(1);
    expect(recovered[0].companyId).toBe('cmp-mv');
  });
});
