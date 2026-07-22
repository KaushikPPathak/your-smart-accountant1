// AI test harness — runs a suite of non-destructive checks against the
// production AI modules and returns structured results.
//
// Each test method is small, self-contained, and returns a TestResult.
// The harness never mutates real company data: setup writes rows under
// TEST_COMPANY_ID, teardown removes them.

import { routeQuery } from "@/lib/ai/query-router";
import { createRedactionMap, redactString, redactDeep, unredact } from "@/lib/ai/redactor";
import { retrieveForQuery } from "@/lib/ai/retrievers";
import { lookupAnswer, storeAnswer, invalidateByTags, invalidateAnswerCache, answerCacheStats } from "@/lib/ai/answer-cache";
import { emitDataChange } from "@/lib/ai/cache-events";
import { getIndex, semanticSearch, invalidateSemanticIndex } from "@/lib/ai/semantic-index";
import { buildCompressedContext } from "@/lib/ai/sqliteContext";
import { offlineDb } from "@/lib/offline/db";
import { setupTestFixtures, teardownTestFixtures, TEST_COMPANY_ID } from "./setup";
import { ROUTER_FIXTURES, PII_SAMPLE } from "./mocks/mock-data";

export interface TestResult {
  name: string;
  passed: boolean;
  durationMs: number;
  message: string;
  details?: Record<string, unknown>;
  error?: string;
}

export interface TestRunSummary {
  results: TestResult[];
  totalMs: number;
  passed: number;
  failed: number;
  total: number;
  passRate: number;
  startedAt: string;
  finishedAt: string;
}

type TestFn = () => Promise<Omit<TestResult, "name" | "durationMs">>;

export class AiTestHarness {
  private tests: Array<{ name: string; fn: TestFn }> = [];

  constructor() {
    this.register("Database connection", () => this.testDatabaseConnection());
    this.register("Intent router accuracy", () => this.testRouterAccuracy());
    this.register("Data minimization (≤50 rows)", () => this.testDataMinimization());
    this.register("PII scrubbing", () => this.testPiiScrubbing());
    this.register("Semantic index (typo tolerance)", () => this.testSemanticIndex());
    this.register("Answer cache operations", () => this.testAnswerCache());
    this.register("Smart invalidation (surgical)", () => this.testSmartInvalidation());
    this.register("Citation contract presence", () => this.testCitationContract());
    this.register("Cache warm-up module", () => this.testCacheWarmup());
    this.register("End-to-end pipeline", () => this.testEndToEnd());
  }

  private register(name: string, fn: TestFn) {
    this.tests.push({ name, fn });
  }

  async runAll(onProgress?: (r: TestResult) => void): Promise<TestRunSummary> {
    const startedAt = new Date().toISOString();
    const t0 = performance.now();
    const results: TestResult[] = [];

    try { await setupTestFixtures(); } catch (err) {
      results.push({
        name: "Setup fixtures", passed: false, durationMs: 0,
        message: "Failed to write mock fixtures — remaining tests will still run.",
        error: err instanceof Error ? err.message : String(err),
      });
    }

    for (const t of this.tests) {
      const started = performance.now();
      let result: TestResult;
      try {
        const partial = await t.fn();
        result = { name: t.name, durationMs: Math.round(performance.now() - started), ...partial };
      } catch (err) {
        result = {
          name: t.name, passed: false,
          durationMs: Math.round(performance.now() - started),
          message: "Threw during execution",
          error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        };
      }
      results.push(result);
      onProgress?.(result);
    }

    try { await teardownTestFixtures(); } catch { /* swallow */ }

    const totalMs = Math.round(performance.now() - t0);
    const passed = results.filter((r) => r.passed).length;
    const failed = results.length - passed;
    return {
      results,
      totalMs,
      passed,
      failed,
      total: results.length,
      passRate: results.length === 0 ? 0 : Math.round((passed / results.length) * 100),
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }

  // ---- individual tests -----------------------------------------------------

  private async testDatabaseConnection(): Promise<Omit<TestResult, "name" | "durationMs">> {
    const anyDb = offlineDb as unknown as { isOpen?: () => boolean; open?: () => Promise<unknown>; tables?: Array<{ name: string }> };
    if (!anyDb) return { passed: false, message: "offlineDb not exported" };
    if (typeof anyDb.open === "function" && anyDb.isOpen && !anyDb.isOpen()) {
      await anyDb.open();
    }
    const tableCount = anyDb.tables?.length ?? 0;
    const has = (n: string) => anyDb.tables?.some((t) => t.name === n) ?? false;
    const required = ["ledgers_cache", "vouchers_cache", "voucher_entries_cache"];
    const missing = required.filter((n) => !has(n));
    if (missing.length > 0) {
      return { passed: false, message: `Missing tables: ${missing.join(", ")}`, details: { tableCount } };
    }
    return { passed: true, message: `Connected — ${tableCount} tables available`, details: { tableCount } };
  }

  private async testRouterAccuracy(): Promise<Omit<TestResult, "name" | "durationMs">> {
    const misses: Array<{ q: string; expected: string; got: string }> = [];
    for (const f of ROUTER_FIXTURES) {
      const routed = routeQuery(f.q);
      if (routed.intent !== f.intent) misses.push({ q: f.q, expected: f.intent, got: routed.intent });
    }
    const accuracy = ((ROUTER_FIXTURES.length - misses.length) / ROUTER_FIXTURES.length) * 100;
    const passed = misses.length === 0;
    return {
      passed,
      message: `${(ROUTER_FIXTURES.length - misses.length)}/${ROUTER_FIXTURES.length} intents matched (${accuracy.toFixed(0)}%)`,
      details: { misses },
    };
  }

  private async testDataMinimization(): Promise<Omit<TestResult, "name" | "durationMs">> {
    const routed = routeQuery("trial balance");
    const slice = await retrieveForQuery(routed, TEST_COMPANY_ID);
    const rowCounts: Record<string, number> = {};
    let maxRows = 0;
    for (const [k, v] of Object.entries(slice.data)) {
      const n = Array.isArray(v) ? v.length : 0;
      rowCounts[k] = n;
      if (n > maxRows) maxRows = n;
    }
    // 50-row ceiling per collection is the contract for a scoped retriever
    // in the test dataset. Real books can grow larger, but the mock fixture
    // never has more than a handful.
    const passed = maxRows <= 50;
    return {
      passed,
      message: passed
        ? `All collections within 50-row cap (max=${maxRows})`
        : `A collection exceeded the 50-row cap (max=${maxRows})`,
      details: { rowCounts, scope: slice.scope },
    };
  }

  private async testPiiScrubbing(): Promise<Omit<TestResult, "name" | "durationMs">> {
    const map = createRedactionMap();
    const redacted = redactString(PII_SAMPLE, map);
    const leaks: string[] = [];
    const forbidden = ["27AAAPL1234C1ZV", "AAAPL1234C", "9876543210", "9812345678", "ramesh@example.com", "123456789012"];
    for (const f of forbidden) if (redacted.includes(f)) leaks.push(f);
    const roundTrip = unredact(redacted, map);
    const roundTripOk = roundTrip === PII_SAMPLE;
    const deep = redactDeep({ note: PII_SAMPLE, nested: [{ pan: "AAAPL1234C" }] }, map);
    const deepText = JSON.stringify(deep);
    const deepLeaks = forbidden.filter((f) => deepText.includes(f));
    const passed = leaks.length === 0 && deepLeaks.length === 0 && roundTripOk;
    return {
      passed,
      message: passed
        ? `Scrubbed ${map.forward.size} unique PII values; round-trip clean`
        : `PII leaked: ${[...leaks, ...deepLeaks].join(", ")}`,
      details: { redacted, uniquePii: map.forward.size, roundTripOk },
    };
  }

  private async testSemanticIndex(): Promise<Omit<TestResult, "name" | "durationMs">> {
    invalidateSemanticIndex(TEST_COMPANY_ID);
    const idx = await getIndex(TEST_COMPANY_ID);
    if (idx.docs.length === 0) {
      return { passed: false, message: "Semantic index built with 0 docs — fixtures may not be visible to the index builder" };
    }
    // Deliberate typo — "Rmesh" should still surface "Ramesh & Co".
    const hits = await semanticSearch(TEST_COMPANY_ID, "Rmesh", { k: 5, minScore: 0.05 });
    const hit = hits.find((h) => /ramesh/i.test(h.name));
    const passed = !!hit;
    return {
      passed,
      message: passed
        ? `Typo "Rmesh" matched "${hit!.name}" (score=${hit!.score.toFixed(2)}, docs=${idx.docs.length})`
        : `Typo "Rmesh" did not match any indexed doc (hits=${hits.length}, docs=${idx.docs.length})`,
      details: { docs: idx.docs.length, topHits: hits.slice(0, 3) },
    };
  }

  private async testAnswerCache(): Promise<Omit<TestResult, "name" | "durationMs">> {
    invalidateAnswerCache(TEST_COMPANY_ID);
    const q = "trial balance as on 31-03-2026";
    storeAnswer(TEST_COMPANY_ID, "trial_balance", "period:2026-Q4", q, "TB total = 17,00,000");
    const hit = lookupAnswer(TEST_COMPANY_ID, "trial_balance", "period:2026-Q4", q);
    const miss = lookupAnswer(TEST_COMPANY_ID, "trial_balance", "period:2026-Q4", "totally different question");
    const stats = answerCacheStats();
    const passed = hit === "TB total = 17,00,000" && miss === null && stats.entries >= 1;
    return {
      passed,
      message: passed
        ? `Store/lookup/miss all correct (entries=${stats.entries})`
        : `Cache misbehaved — hit=${JSON.stringify(hit)} miss=${JSON.stringify(miss)}`,
      details: { stats },
    };
  }

  private async testSmartInvalidation(): Promise<Omit<TestResult, "name" | "durationMs">> {
    invalidateAnswerCache(TEST_COMPANY_ID);
    storeAnswer(TEST_COMPANY_ID, "trial_balance", "period:2026-Q4", "tb q1", "A");
    storeAnswer(TEST_COMPANY_ID, "stock",         "item:widget",     "stock q", "B");
    storeAnswer(TEST_COMPANY_ID, "gst",           "period:2026-03",  "gst q",  "C");
    const before = answerCacheStats().entries;

    // A ledger change must drop trial_balance and gst entries but preserve stock.
    emitDataChange(TEST_COMPANY_ID, "ledger");
    const stockStillThere = lookupAnswer(TEST_COMPANY_ID, "stock", "item:widget", "stock q") === "B";
    const tbGone = lookupAnswer(TEST_COMPANY_ID, "trial_balance", "period:2026-Q4", "tb q1") === null;
    const after = answerCacheStats().entries;
    const surgical = tbGone && stockStillThere && after < before;

    // Fall-back check: invalidateByTags returns count of dropped rows.
    storeAnswer(TEST_COMPANY_ID, "stock", "item:widget", "stock q2", "D");
    const dropped = invalidateByTags(TEST_COMPANY_ID, ["intent:stock"]);
    const passed = surgical && dropped >= 1;
    return {
      passed,
      message: passed
        ? `Ledger event dropped ${before - after}/${before}; stock survived; tag-drop removed ${dropped}`
        : `Invalidation was not surgical (before=${before}, after=${after}, stockSurvived=${stockStillThere}, tbGone=${tbGone})`,
      details: { before, after, dropped },
    };
  }

  private async testCitationContract(): Promise<Omit<TestResult, "name" | "durationMs">> {
    const ctx = await buildCompressedContext("trial balance as on 31-03-2026", TEST_COMPANY_ID);
    const sys = ctx.systemMessage.content;
    const required = ["CITATIONS", "[V:", "[L:", "[F:"];
    const missing = required.filter((r) => !sys.includes(r));
    const passed = missing.length === 0;
    return {
      passed,
      message: passed ? "System prompt enforces V/L/F citation format" : `Missing citation tokens: ${missing.join(", ")}`,
      details: { systemPromptChars: sys.length, intent: ctx.intent, scope: ctx.scope },
    };
  }

  private async testCacheWarmup(): Promise<Omit<TestResult, "name" | "durationMs">> {
    const mod = await import("@/lib/ai/cache-warmup");
    const ok = typeof mod.scheduleWarmup === "function";
    if (!ok) return { passed: false, message: "scheduleWarmup export missing" };
    // Calling with null must be a no-op (never throws, never enqueues).
    let threw = false;
    try { mod.scheduleWarmup(null); mod.scheduleWarmup(undefined); } catch { threw = true; }
    return {
      passed: !threw,
      message: threw ? "scheduleWarmup threw on nullish input" : "scheduleWarmup exists and tolerates null input",
    };
  }

  private async testEndToEnd(): Promise<Omit<TestResult, "name" | "durationMs">> {
    const ctx = await buildCompressedContext(
      "what is the balance of Ramesh & Co with gstin 27AAAPL1234C1ZV",
      TEST_COMPANY_ID,
    );
    const payload = ctx.userMessage.content;
    const leaked = payload.includes("27AAAPL1234C1ZV");
    const hasIntent = /"intent"\s*:/.test(payload);
    const hasScope = typeof ctx.scope === "string" && ctx.scope.length > 0;
    const passed = !leaked && hasIntent && hasScope;
    return {
      passed,
      message: passed
        ? `Pipeline produced a scoped, redacted payload (${payload.length} chars, intent=${ctx.intent})`
        : `Pipeline output failed contract — leaked=${leaked} hasIntent=${hasIntent} hasScope=${hasScope}`,
      details: { payloadChars: payload.length, intent: ctx.intent, scope: ctx.scope },
    };
  }
}

export function summariseResults(summary: TestRunSummary): string {
  const lines: string[] = [];
  lines.push(`AI Test Harness — ${summary.finishedAt}`);
  lines.push(`Total: ${summary.total}  Passed: ${summary.passed}  Failed: ${summary.failed}  Pass rate: ${summary.passRate}%  Time: ${summary.totalMs}ms`);
  lines.push("");
  for (const r of summary.results) {
    lines.push(`${r.passed ? "PASS" : "FAIL"}  ${r.name}  (${r.durationMs}ms)`);
    lines.push(`      ${r.message}`);
    if (r.error) lines.push(`      error: ${r.error}`);
    if (r.details) lines.push(`      details: ${JSON.stringify(r.details)}`);
  }
  return lines.join("\n");
}
