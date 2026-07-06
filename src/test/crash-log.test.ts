// Layer 5 tests — crash-log ring buffer + recordFailure semantics.
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearCrashes,
  exportCrashes,
  listCrashes,
  recordFailure,
} from "@/lib/crash-log";

// jsdom provides window + localStorage via vitest.config.ts environment.

describe("crash-log", () => {
  beforeEach(() => {
    clearCrashes();
  });

  it("starts empty", () => {
    expect(listCrashes()).toEqual([]);
  });

  it("records a failure with message + scope + context", () => {
    recordFailure("restore", new Error("dexie tx aborted"), { company: "abc" });
    const list = listCrashes();
    expect(list).toHaveLength(1);
    expect(list[0].scope).toBe("restore");
    expect(list[0].message).toBe("dexie tx aborted");
    expect(list[0].kind).toBe("failure");
    expect(list[0].context).toEqual({ company: "abc" });
    expect(typeof list[0].id).toBe("string");
    expect(typeof list[0].ts).toBe("number");
  });

  it("accepts non-Error values", () => {
    recordFailure("backup", "disk full");
    recordFailure("backup", { code: 42 });
    const list = listCrashes();
    expect(list[1].message).toBe("disk full"); // reversed: newest first, second-newest is 'disk full'
    expect(list[0].message).toContain("object");
  });

  it("returns entries newest-first", () => {
    recordFailure("a", new Error("first"));
    recordFailure("b", new Error("second"));
    recordFailure("c", new Error("third"));
    const list = listCrashes();
    expect(list.map((e) => e.scope)).toEqual(["c", "b", "a"]);
  });

  it("caps ring buffer at 100 entries", () => {
    for (let i = 0; i < 150; i++) {
      recordFailure("stress", new Error(`e${i}`));
    }
    const list = listCrashes();
    expect(list).toHaveLength(100);
    // Newest first: the very newest is e149; the oldest kept is e50.
    expect(list[0].message).toBe("e149");
    expect(list[list.length - 1].message).toBe("e50");
  });

  it("clearCrashes empties the buffer", () => {
    recordFailure("x", new Error("y"));
    expect(listCrashes()).toHaveLength(1);
    clearCrashes();
    expect(listCrashes()).toHaveLength(0);
  });

  it("exportCrashes returns valid JSON with entries + timestamp", () => {
    recordFailure("restore", new Error("boom"));
    const parsed = JSON.parse(exportCrashes()) as {
      exported_at: string;
      entries: Array<{ message: string }>;
    };
    expect(typeof parsed.exported_at).toBe("string");
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0].message).toBe("boom");
  });

  it("sanitizes deeply nested context without throwing", () => {
    const deep: Record<string, unknown> = {};
    let cur = deep;
    for (let i = 0; i < 20; i++) {
      const next: Record<string, unknown> = {};
      cur.child = next;
      cur = next;
    }
    expect(() => recordFailure("deep", new Error("x"), deep)).not.toThrow();
    const list = listCrashes();
    expect(list[0].context).toBeDefined();
  });
});
