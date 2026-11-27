import { describe, expect, it } from "vitest";
import {
  BookPacketError,
  applyBookEntries,
  bookDeleteEntry,
  bookRowEntries,
  type BookRow,
  type BookTable,
  type BookWriter,
} from "@/lib/sync/book-packets";

function memoryWriter() {
  const tables = new Map<BookTable, Map<string, BookRow>>();
  const get = (t: BookTable) => {
    if (!tables.has(t)) tables.set(t, new Map());
    return tables.get(t)!;
  };
  const writer: BookWriter = {
    async put(t, rows) {
      for (const r of rows) get(t).set(r.id, r);
    },
    async remove(t, ids) {
      for (const id of ids) get(t).delete(id);
    },
  };
  return { writer, get };
}

describe("book packets", () => {
  it("round-trips masters, vouchers and lines in order", async () => {
    const entries = [
      ...bookRowEntries("ledgers", [{ id: "l1", company_id: "co", name: "Cash" }], "co"),
      ...bookRowEntries("vouchers", [{ id: "v1", company_id: "co", voucher_type: "sales" }], "co"),
      ...bookRowEntries("voucher_entries", [{ id: "e1", company_id: "co", voucher_id: "v1", ledger_id: "l1", amount_paise: 10000 }], "co"),
    ];
    const { writer, get } = memoryWriter();
    expect(await applyBookEntries(entries, writer, "co")).toBe(3);
    expect(get("vouchers").get("v1")?.voucher_type).toBe("sales");
    expect(get("voucher_entries").get("e1")?.amount_paise).toBe(10000);
  });

  it("applies a delete tombstone", async () => {
    const { writer, get } = memoryWriter();
    await applyBookEntries(bookRowEntries("vouchers", [{ id: "v1", company_id: "co" }], "co"), writer, "co");
    await applyBookEntries([bookDeleteEntry("vouchers", "v1")], writer, "co");
    expect(get("vouchers").has("v1")).toBe(false);
  });

  it("applying the same entries twice gives the same result", async () => {
    const { writer, get } = memoryWriter();
    const entries = bookRowEntries("vouchers", [{ id: "v1", company_id: "co", total_paise: 5 }], "co");
    await applyBookEntries(entries, writer, "co");
    await applyBookEntries(entries, writer, "co");
    expect(get("vouchers").size).toBe(1);
    expect(get("vouchers").get("v1")?.total_paise).toBe(5);
  });

  it("rejects a row that belongs to another company", () => {
    expect(() => bookRowEntries("vouchers", [{ id: "v1", company_id: "other" }], "co")).toThrow(BookPacketError);
  });

  it("rejects an unknown table or entry kind without writing", async () => {
    const { writer, get } = memoryWriter();
    await expect(
      applyBookEntries([{ kind: "book.put", data: { table: "secrets", row: { id: "x" } } }], writer, "co"),
    ).rejects.toThrow(BookPacketError);
    await expect(
      applyBookEntries([{ kind: "book.drop", data: { table: "vouchers", row: { id: "x" } } }], writer, "co"),
    ).rejects.toThrow(BookPacketError);
    expect(get("vouchers").size).toBe(0);
  });

  it("rejects a row without an id", () => {
    expect(() => bookRowEntries("ledgers", [{ id: "", company_id: "co" }], "co")).toThrow(BookPacketError);
  });
});
