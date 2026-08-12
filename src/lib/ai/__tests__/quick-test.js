// Quick browser-console smoke test for the AI layer.
// Paste into DevTools while the app is open — no imports needed.
//
//   copy(await __aiManualTest.all())   // full run
//   __aiQuickTest()                    // this file's summary run
//
// Assumes src/lib/ai/__tests__/manual-test.ts has been imported at least once
// (the AssistantChat and the Test Dashboard both do that on mount).

(async () => {
  const api = (window && window.__aiManualTest) || null;
  if (!api) {
    console.warn("[ai-quick-test] window.__aiManualTest not found — open the AI Test Dashboard first, then re-run.");
    return null;
  }
  console.log("[ai-quick-test] starting…");
  const t0 = performance.now();
  const summary = await api.all();
  const took = Math.round(performance.now() - t0);
  console.log(`[ai-quick-test] done in ${took}ms — ${summary.passed}/${summary.total} passed (${summary.passRate}%)`);
  const failed = summary.results.filter((r) => !r.passed);
  if (failed.length > 0) console.table(failed.map((r) => ({ test: r.name, ms: r.durationMs, message: r.message, error: r.error || "" })));
  return summary;
})();

// Also expose a re-runnable helper.
window.__aiQuickTest = async function () {
  if (!window.__aiManualTest) throw new Error("Open the AI Test Dashboard once, then retry.");
  return window.__aiManualTest.all();
};
