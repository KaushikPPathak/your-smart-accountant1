import { describe, expect, it } from "vitest";
import { routeQuery } from "@/lib/ai/query-router";
import { QUESTION_CATALOG, catalogSummary } from "@/lib/ai/question-catalog";

describe("questionnaire architecture", () => {
  it("lists all 35 questions once, with unique ids", () => {
    expect(QUESTION_CATALOG).toHaveLength(35);
    expect(new Set(QUESTION_CATALOG.map((q) => q.id)).size).toBe(35);
  });

  for (const entry of QUESTION_CATALOG) {
    describe(entry.id, () => {
      const r = routeQuery(entry.question);

      it("the router gives the recorded intent", () => {
        expect(r.intent).toBe(entry.routeIntent);
      });

      it("the recorded router outcome matches what the chat does", () => {
        const actual = r.unsupportedReport ? "declined" : r.requiresLLM ? "cannot" : r.intent === "unknown" ? "cannot" : "local";
        expect(actual).toBe(entry.router);
      });

      it("answered or partial questions have a local function", () => {
        if (entry.status === "answered" || entry.status === "partial") {
          expect(entry.router).toBe("local");
          expect(entry.tool).not.toBeNull();
        }
      });

      it("planned or not-in-books questions are not answered locally yet", () => {
        if (entry.status === "planned" || entry.status === "not_in_books") {
          expect(entry.router).not.toBe("local");
        }
      });
    });
  }

  it("summary counts add up", () => {
    const s = catalogSummary();
    expect(s.answered + s.partial + s.planned + s.not_in_books).toBe(35);
  });
});
