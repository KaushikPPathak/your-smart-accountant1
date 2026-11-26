// Sync protocol over the user's cloud folder. Carries encrypted files only.
//
// Each device writes numbered outbox batches (outbox-<device>-<batch>.enc).
// A reader applies each sender's batches in order, exactly once, and records
// how far it got in an acknowledgement file. A sender deletes its batches only
// after every peer has acknowledged them. A snapshot lets a new device start
// from the current state instead of replaying every batch.
//
// The protocol knows nothing about vouchers or ledgers. `apply` receives the
// entries of one batch and does the domain work.

import type { CloudFolder } from "@/lib/sync/cloud-folder";
import {
  decryptPacket,
  encryptPacket,
  packetAad,
  packetFromText,
  packetToText,
  type EncryptedPacket,
} from "@/lib/sync/sync-crypto";

const DEVICE_RE = /^[a-z0-9]{6,32}$/;
const COMPANY_RE = /^[A-Za-z0-9-]{1,64}$/;
const BATCH_DIGITS = 10;

export type SyncEntry = { kind: string; data: unknown };

export interface SyncState {
  /** Highest batch applied from each sender device. */
  lastApplied: Record<string, number>;
}

export interface Snapshot {
  batch: number;
  state: SyncState;
  data: unknown;
}

export class SyncProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncProtocolError";
  }
}

function checkIds(companyId: string, deviceId?: string): void {
  if (!COMPANY_RE.test(companyId)) throw new SyncProtocolError("Invalid company id");
  if (deviceId !== undefined && !DEVICE_RE.test(deviceId)) throw new SyncProtocolError("Invalid device id");
}

function pad(n: number): string {
  if (!Number.isInteger(n) || n < 1) throw new SyncProtocolError("Batch numbers start at 1");
  return String(n).padStart(BATCH_DIGITS, "0");
}

export function outboxName(deviceId: string, batch: number): string {
  return `outbox-${deviceId}-${pad(batch)}.enc`;
}

export function parseOutboxName(name: string): { deviceId: string; batch: number } | null {
  const m = /^outbox-([a-z0-9]{6,32})-(\d{10})\.enc$/.exec(name);
  return m ? { deviceId: m[1], batch: Number(m[2]) } : null;
}

export function snapshotName(batch: number): string {
  return `snapshot-${pad(batch)}.enc`;
}

export function ackName(reader: string, sender: string): string {
  return `ack-${reader}--${sender}.enc`;
}

function parseAckName(name: string): { reader: string; sender: string } | null {
  const m = /^ack-([a-z0-9]{6,32})--([a-z0-9]{6,32})\.enc$/.exec(name);
  return m ? { reader: m[1], sender: m[2] } : null;
}

async function writeEncrypted(
  folder: CloudFolder,
  key: Uint8Array,
  name: string,
  aad: Uint8Array,
  payload: unknown,
): Promise<void> {
  const packet = await encryptPacket(key, new TextEncoder().encode(JSON.stringify(payload)), aad);
  await folder.writeAtomic(name, packetToText(packet));
}

async function readEncrypted<T>(
  folder: CloudFolder,
  key: Uint8Array,
  name: string,
  aad: Uint8Array,
): Promise<T | null> {
  const text = await folder.read(name);
  if (text === null) return null;
  const pt = await decryptPacket(key, packetFromText(text), aad);
  return JSON.parse(new TextDecoder().decode(pt)) as T;
}

const outboxAad = (companyId: string, deviceId: string, batch: number) =>
  packetAad({ companyId, kind: `outbox:${deviceId}`, sequence: batch });

const ackAad = (companyId: string, reader: string, sender: string) =>
  packetAad({ companyId, kind: `ack:${reader}:${sender}`, sequence: 0 });

const snapshotAad = (companyId: string, batch: number) =>
  packetAad({ companyId, kind: "snapshot", sequence: batch });

/** Write one outbox batch from this device. */
export async function publishBatch(
  folder: CloudFolder,
  key: Uint8Array,
  companyId: string,
  deviceId: string,
  batch: number,
  entries: SyncEntry[],
): Promise<void> {
  checkIds(companyId, deviceId);
  if (entries.length === 0) throw new SyncProtocolError("Empty batch");
  await writeEncrypted(folder, key, outboxName(deviceId, batch), outboxAad(companyId, deviceId, batch), {
    deviceId,
    batch,
    entries,
  });
}

/**
 * Apply every new batch from the other devices, in order, exactly once.
 * Stops at the first gap so a missing file is picked up on a later cycle.
 * Returns the updated state and writes this device's acknowledgements.
 */
export async function processInbox(
  folder: CloudFolder,
  key: Uint8Array,
  companyId: string,
  readerId: string,
  state: SyncState,
  apply: (entries: SyncEntry[], meta: { sender: string; batch: number }) => Promise<void>,
): Promise<SyncState> {
  checkIds(companyId, readerId);
  const next: SyncState = { lastApplied: { ...state.lastApplied } };
  const names = await folder.list("outbox-");
  const bySender = new Map<string, number[]>();
  for (const n of names) {
    const p = parseOutboxName(n);
    if (!p || p.deviceId === readerId) continue;
    bySender.set(p.deviceId, [...(bySender.get(p.deviceId) ?? []), p.batch]);
  }

  for (const [sender, batches] of bySender) {
    const sorted = batches.sort((a, b) => a - b);
    let expected = (next.lastApplied[sender] ?? 0) + 1;
    for (const batch of sorted) {
      if (batch < expected) continue; // already applied
      if (batch > expected) break; // gap: wait for the missing batch
      const file = await readEncrypted<{ deviceId: string; batch: number; entries: SyncEntry[] }>(
        folder,
        key,
        outboxName(sender, batch),
        outboxAad(companyId, sender, batch),
      );
      if (!file || file.deviceId !== sender || file.batch !== batch) {
        throw new SyncProtocolError(`Batch ${batch} from ${sender} is inconsistent`);
      }
      await apply(file.entries, { sender, batch });
      next.lastApplied[sender] = batch;
      expected = batch + 1;
    }
    if (next.lastApplied[sender] !== undefined) {
      await writeEncrypted(folder, key, ackName(readerId, sender), ackAad(companyId, readerId, sender), {
        batch: next.lastApplied[sender],
      });
    }
  }
  return next;
}

/**
 * Delete this device's outbox batches that every peer has acknowledged.
 * If any peer has not acknowledged anything yet, nothing is deleted.
 */
export async function cleanupAcknowledged(
  folder: CloudFolder,
  key: Uint8Array,
  companyId: string,
  deviceId: string,
  peerIds: string[],
): Promise<number> {
  checkIds(companyId, deviceId);
  if (peerIds.length === 0) return 0;
  let safeUpTo = Number.POSITIVE_INFINITY;
  for (const peer of peerIds) {
    checkIds(companyId, peer);
    const ack = await readEncrypted<{ batch: number }>(
      folder,
      key,
      ackName(peer, deviceId),
      ackAad(companyId, peer, deviceId),
    );
    if (!ack) return 0;
    safeUpTo = Math.min(safeUpTo, ack.batch);
  }
  let deleted = 0;
  for (const n of await folder.list("outbox-")) {
    const p = parseOutboxName(n);
    if (p && p.deviceId === deviceId && p.batch <= safeUpTo) {
      await folder.delete(n);
      deleted++;
    }
  }
  return deleted;
}

/** Write a snapshot of the current state, taken after the given batch. */
export async function writeSnapshot(
  folder: CloudFolder,
  key: Uint8Array,
  companyId: string,
  snap: Snapshot,
): Promise<void> {
  checkIds(companyId);
  await writeEncrypted(folder, key, snapshotName(snap.batch), snapshotAad(companyId, snap.batch), snap);
}

/** Read the newest snapshot, or null if there is none. */
export async function readLatestSnapshot(
  folder: CloudFolder,
  key: Uint8Array,
  companyId: string,
): Promise<Snapshot | null> {
  checkIds(companyId);
  const names = (await folder.list("snapshot-")).filter((n) => /^snapshot-\d{10}\.enc$/.test(n));
  if (names.length === 0) return null;
  const latest = names.sort().at(-1)!;
  const batch = Number(latest.slice("snapshot-".length, "snapshot-".length + BATCH_DIGITS));
  const snap = await readEncrypted<Snapshot>(folder, key, latest, snapshotAad(companyId, batch));
  if (!snap || snap.batch !== batch) throw new SyncProtocolError("Snapshot is inconsistent");
  return snap;
}

export type { EncryptedPacket };
