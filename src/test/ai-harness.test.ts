import "fake-indexeddb/auto";
import { it, expect } from "vitest";
import { AiTestHarness } from "@/lib/ai/__tests__/test-harness";
it("harness", async () => {
  const s = await new AiTestHarness().runAll();
  for (const r of s.results) console.log(r.passed ? "PASS" : "FAIL", r.name, "-", r.message);
  expect(s.failed).toBe(0);
}, 60000);
