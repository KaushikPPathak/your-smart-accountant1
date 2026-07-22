// Manual, interactive test helpers — call from the browser console.
//
//   import { manualTest } from "@/lib/ai/__tests__/manual-test";
//   await manualTest.all();          // run everything and print a report
//   await manualTest.router();       // just the intent router
//   await manualTest.pii("string");  // scrub a specific string
//   await manualTest.retrieve("cash balance today");
//   await manualTest.pipeline("balance of Ramesh");

import { AiTestHarness, summariseResults, type TestRunSummary } from "./test-harness";
import { routeQuery } from "@/lib/ai/query-router";
import { createRedactionMap, redactString } from "@/lib/ai/redactor";
import { retrieveForQuery } from "@/lib/ai/retrievers";
import { buildCompressedContext } from "@/lib/ai/sqliteContext";
import { setupTestFixtures, teardownTestFixtures, TEST_COMPANY_ID } from "./setup";

async function all(): Promise<TestRunSummary> {
  const harness = new AiTestHarness();
  const summary = await harness.runAll((r) => {
    // Live progress line per test.
    // eslint-disable-next-line no-console
    console.log(`${r.passed ? "✔" : "✘"} ${r.name} — ${r.durationMs}ms — ${r.message}`);
  });
  // eslint-disable-next-line no-console
  console.log("\n" + summariseResults(summary));
  return summary;
}

function router(q?: string) {
  const query = q ?? "cash balance today";
  const routed = routeQuery(query);
  // eslint-disable-next-line no-console
  console.table([routed]);
  return routed;
}

function pii(sample: string) {
  const map = createRedactionMap();
  const redacted = redactString(sample, map);
  const result = { input: sample, redacted, tokens: [...map.reverse.entries()] };
  // eslint-disable-next-line no-console
  console.log(result);
  return result;
}

async function retrieve(question: string) {
  await setupTestFixtures();
  try {
    const routed = routeQuery(question);
    const slice = await retrieveForQuery(routed, TEST_COMPANY_ID);
    // eslint-disable-next-line no-console
    console.log({ routed, scope: slice.scope, keys: Object.keys(slice.data), facts: slice.facts });
    return slice;
  } finally {
    await teardownTestFixtures();
  }
}

async function pipeline(question: string) {
  await setupTestFixtures();
  try {
    const ctx = await buildCompressedContext(question, TEST_COMPANY_ID);
    // eslint-disable-next-line no-console
    console.log({
      intent: ctx.intent,
      scope: ctx.scope,
      systemChars: ctx.systemMessage.content.length,
      userChars: ctx.userMessage.content.length,
      redactedValues: ctx.redaction.forward.size,
    });
    return ctx;
  } finally {
    await teardownTestFixtures();
  }
}

export const manualTest = { all, router, pii, retrieve, pipeline };

// Also expose on window for zero-import console use.
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__aiManualTest = manualTest;
}
