import { describe, expect, it } from "vitest";
import { createMemoryFolder } from "@/lib/sync/cloud-folder";
import {
  cleanupAcknowledged,
  outboxName,
  processInbox,
  publishBatch,
  readLatestSnapshot,
  writeSnapshot,
  type SyncEntry,
  type SyncState,
} from "@/lib/sync/sync-protocol";
import { generateCompanyKeyBytes } from "@/lib/sync/sync-crypto";

const PC = "pcdevice1";
const PHONE = "phonedev1";
const CO = "co-1";
const e = (n: number): SyncEntry => ({ kind: "voucher", data: { n } });

describe("sync protocol", () => {
  it("applies each batch once, in order", async () => {
    const f = createMemoryFolder();
    const key = generateCompanyKeyBytes();
    await publishBatch(f, key, CO, PHONE, 1, [e(1)]);
    await publishBatch(f, key, CO, PHONE, 2, [e(2), e(3)]);
    const seen: number[] = [];
    let st: SyncState = { lastApplied: {} };
    st = await processInbox(f, key, CO, PC, st, async (entries) => {
      seen.push(...entries.map((x) => (x.data as { n: number }).n));
    });
    expect(seen).toEqual([1, 2, 3]);
    // Running again applies nothing new.
    st = await processInbox(f, key, CO, PC, st, async () => {
      throw new Error("should not apply again");
    });
    expect(st.lastApplied[PHONE]).toBe(2);
  });

  it("waits at a gap and applies the rest when the missing batch arrives", async () => {
    const f = createMemoryFolder();
    const key = generateCompanyKeyBytes();
    await publishBatch(f, key, CO, PHONE, 2, [e(2)]); // batch 1 not here yet
    const seen: number[] = [];
    const apply = async (entries: SyncEntry[]) => void seen.push(...entries.map((x) => (x.data as { n: number }).n));
    let st = await processInbox(f, key, CO, PC, { lastApplied: {} }, apply);
    expect(seen).toEqual([]);
    await publishBatch(f, key, CO, PHONE, 1, [e(1)]);
    st = await processInbox(f, key, CO, PC, st, apply);
    expect(seen).toEqual([1, 2]);
  });

  it("refuses a batch copied under another device's name", async () => {
    const f = createMemoryFolder();
    const key = generateCompanyKeyBytes();
    await publishBatch(f, key, CO, PHONE, 1, [e(1)]);
    const copied = f.files.get(outboxName(PHONE, 1))!;
    f.files.set(outboxName("otherdev1", 1), copied);
    await expect(
      processInbox(f, key, CO, PC, { lastApplied: {} }, async () => {}),
    ).rejects.toThrow();
  });

  it("does not read batches written by this device itself", async () => {
    const f = createMemoryFolder();
    const key = generateCompanyKeyBytes();
    await publishBatch(f, key, CO, PC, 1, [e(1)]);
    const st = await processInbox(f, key, CO, PC, { lastApplied: {} }, async () => {
      throw new Error("own batch applied");
    });
    expect(st.lastApplied).toEqual({});
  });

  it("deletes batches only after every peer acknowledged them", async () => {
    const f = createMemoryFolder();
    const key = generateCompanyKeyBytes();
    await publishBatch(f, key, CO, PHONE, 1, [e(1)]);
    await publishBatch(f, key, CO, PHONE, 2, [e(2)]);
    // PC reads and acknowledges.
    await processInbox(f, key, CO, PC, { lastApplied: {} }, async () => {});
    // Phone cleans up using PC's ack.
    expect(await cleanupAcknowledged(f, key, CO, PHONE, [PC])).toBe(2);
    expect(await f.list("outbox-")).toEqual([]);
  });

  it("keeps batches when a peer has not acknowledged", async () => {
    const f = createMemoryFolder();
    const key = generateCompanyKeyBytes();
    await publishBatch(f, key, CO, PHONE, 1, [e(1)]);
    expect(await cleanupAcknowledged(f, key, CO, PHONE, [PC])).toBe(0);
    expect((await f.list("outbox-")).length).toBe(1);
  });

  it("round-trips a snapshot and returns the newest", async () => {
    const f = createMemoryFolder();
    const key = generateCompanyKeyBytes();
    await writeSnapshot(f, key, CO, { batch: 3, state: { lastApplied: { [PHONE]: 3 } }, data: { old: true } });
    await writeSnapshot(f, key, CO, { batch: 7, state: { lastApplied: { [PHONE]: 7 } }, data: { new: true } });
    const snap = await readLatestSnapshot(f, key, CO);
    expect(snap?.batch).toBe(7);
    expect(snap?.data).toEqual({ new: true });
  });

  it("returns null when there is no snapshot", async () => {
    expect(await readLatestSnapshot(createMemoryFolder(), generateCompanyKeyBytes(), CO)).toBeNull();
  });

  it("rejects bad ids and empty batches", async () => {
    const f = createMemoryFolder();
    const key = generateCompanyKeyBytes();
    await expect(publishBatch(f, key, CO, "BAD", 1, [e(1)])).rejects.toThrow("device id");
    await expect(publishBatch(f, key, CO, PHONE, 1, [])).rejects.toThrow("Empty");
    await expect(publishBatch(f, key, "co|1", PHONE, 1, [e(1)])).rejects.toThrow("company");
  });
});
