import { describe, expect, it } from "vitest";
import { applyBookEntries, type BookRow, type BookTable, type BookWriter } from "@/lib/sync/book-packets";
import { createMemoryFolder } from "@/lib/sync/cloud-folder";
import { generateCompanyKeyBytes } from "@/lib/sync/sync-crypto";
import { processInbox } from "@/lib/sync/sync-protocol";
import { EMPTY_PUBLISH_STATE, MAX_ENTRIES_PER_BATCH, publishChanges, type BookReader, type PublishState } from "@/lib/sync/pc-publisher";

function makeBooks() {
  const data = new Map<BookTable, BookRow[]>();
  const reader: BookReader = {
    async read(t) {
      return (data.get(t) ?? []).map((r) => ({ ...r }));
    },
  };
  return {
    data,
    reader,
    set(t: BookTable, rows: BookRow[]) { data.set(t, rows); },
  };
}

function phoneStore() {
  const rows = new Map<BookTable, Map<string, BookRow>>();
  const get = (t: BookTable) => {
    if (!rows.has(t)) rows.set(t, new Map());
    return rows.get(t)!;
  };
  const writer: BookWriter = {
    async put(t, rs) { for (const r of rs) get(t).set(r.id, r); },
    async remove(t, ids) { for (const id of ids) get(t).delete(id); },
  };
  return { rows, get, writer };
}

const CO = "co-1";
const DEV = "pcdevice1";
const READER = "phonedev1";

async function syncOnce(folder: ReturnType<typeof createMemoryFolder>, key: Uint8Array, books: ReturnType<typeof makeBooks>, state: PublishState) {
  return publishChanges({ folder, key, companyId: CO, deviceId: DEV, reader: books.reader, state });
}

describe("pc publisher", () => {
  it("sends everything on the first run and the phone ends up with the same rows", async () => {
    const books = makeBooks();
    books.set("ledgers", [{ id: "l1", company_id: CO, name: "Cash" }]);
    books.set("vouchers", [{ id: "v1", company_id: CO, voucher_type: "sales", total_paise: 118000 }]);
    const folder = createMemoryFolder();
    const key = generateCompanyKeyBytes();

    const res = await syncOnce(folder, key, books, EMPTY_PUBLISH_STATE);
    expect(res.entriesSent).toBe(2);
    expect(res.batchesWritten).toBe(1);

    const phone = phoneStore();
    const inbox = await processInbox(folder, key, CO, READER, { lastApplied: {} }, (entries) =>
      applyBookEntries(entries, phone.writer, CO).then(() => undefined),
    );
    expect(inbox.lastApplied[DEV]).toBe(1);
    expect(phone.get("ledgers").get("l1")?.name).toBe("Cash");
    expect(phone.get("vouchers").get("v1")?.total_paise).toBe(118000);
  });

  it("sends only changes on the next run, and a removed row becomes a tombstone", async () => {
    const books = makeBooks();
    books.set("vouchers", [
      { id: "v1", company_id: CO, total_paise: 100 },
      { id: "v2", company_id: CO, total_paise: 200 },
    ]);
    const folder = createMemoryFolder();
    const key = generateCompanyKeyBytes();
    const first = await syncOnce(folder, key, books, EMPTY_PUBLISH_STATE);

    // Only v2 changes, v1 is deleted.
    books.set("vouchers", [{ id: "v2", company_id: CO, total_paise: 250 }]);
    const second = await syncOnce(folder, key, books, first.state);
    expect(second.entriesSent).toBe(2);
    expect(second.state.batch).toBe(2);

    const phone = phoneStore();
    let st = { lastApplied: {} as Record<string, number> };
    st = await processInbox(folder, key, CO, READER, st, (e) => applyBookEntries(e, phone.writer, CO).then(() => undefined));
    expect(phone.get("vouchers").has("v1")).toBe(false);
    expect(phone.get("vouchers").get("v2")?.total_paise).toBe(250);
  });

  it("sends nothing when nothing changed", async () => {
    const books = makeBooks();
    books.set("items", [{ id: "i1", company_id: CO, name: "Rice" }]);
    const folder = createMemoryFolder();
    const key = generateCompanyKeyBytes();
    const first = await syncOnce(folder, key, books, EMPTY_PUBLISH_STATE);
    const again = await syncOnce(folder, key, books, first.state);
    expect(again.entriesSent).toBe(0);
    expect(again.batchesWritten).toBe(0);
  });

  it("splits large runs into several batches", async () => {
    const books = makeBooks();
    const rows: BookRow[] = Array.from({ length: MAX_ENTRIES_PER_BATCH + 10 }, (_, i) => ({ id: `e${i}`, company_id: CO, n: i }));
    books.set("voucher_entries", rows);
    const folder = createMemoryFolder();
    const res = await syncOnce(folder, generateCompanyKeyBytes(), books, EMPTY_PUBLISH_STATE);
    expect(res.batchesWritten).toBe(2);
    expect(res.state.batch).toBe(2);
  });
});
