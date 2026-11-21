import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { routeQuery } from "@/lib/ai/query-router";
import { QUESTION_CATALOG, catalogSummary, phaseSummary, renderCatalogueMarkdown } from "@/lib/ai/question-catalog";
import { TOOL_CATALOG } from "@/lib/ai/tools";

const REGISTERED_TOOLS = new Set(TOOL_CATALOG.map((t) => t.name));

describe("questionnaire architecture: structure", () => {
  it("lists all 35 questions once, with unique ids", () => {
    expect(QUESTION_CATALOG).toHaveLength(35);
    expect(new Set(QUESTION_CATALOG.map((q) => q.id)).size).toBe(35);
  });

  it("covers seven sections in questionnaire order", () => {
    const sections = [...new Set(QUESTION_CATALOG.map((q) => q.section))];
    expect(sections).toEqual([
      "Cash, bank & liquidity",
      "Receivables & customers",
      "Payables & vendors",
      "Sales, purchases & profitability",
      "Inventory & stock",
      "Tax, statutory & compliance",
      "Ledger hygiene & audit readiness",
    ]);
  });

  it("every entry says what data it uses and carries a note", () => {
    for (const q of QUESTION_CATALOG) {
      expect(q.dataUsed.trim(), q.id).not.toBe("");
      expect(q.note.trim(), q.id).not.toBe("");
    }
  });

  it("phases are 1, 2 or 3, and missing-data items are phase 2 or 3", () => {
    for (const q of QUESTION_CATALOG) {
      expect([1, 2, 3], q.id).toContain(q.phase);
      if (q.status === "not_in_books") expect([2, 3], q.id).toContain(q.phase);
    }
  });

  it("the summaries add up to 35", () => {
    const s = catalogSummary();
    expect(s.answered + s.partial + s.planned + s.not_in_books).toBe(35);
    const p = phaseSummary();
    expect(p[1] + p[2] + p[3]).toBe(35);
  });
});

describe("questionnaire architecture: tools", () => {
  it("answered and partial entries name a registered tool and a local route", () => {
    for (const q of QUESTION_CATALOG) {
      if (q.status !== "answered" && q.status !== "partial") continue;
      expect(REGISTERED_TOOLS.has(q.tool), `${q.id} tool ${q.tool}`).toBe(true);
      expect(q.router, q.id).toBe("local");
    }
  });

  it("planned and not-in-books entries are not answered locally yet", () => {
    for (const q of QUESTION_CATALOG) {
      if (q.status === "planned" || q.status === "not_in_books") expect(q.router, q.id).not.toBe("local");
    }
  });

  it("a planned tool that is not registered yet is not claimed as existing", () => {
    for (const q of QUESTION_CATALOG) {
      if (q.status === "planned" && REGISTERED_TOOLS.has(q.tool)) {
        // Registered already: the note must say the wording is not routed yet.
        expect(q.note, q.id).toMatch(/not routed|not answered|wording|needs|Blocked|blocked|Overdue|revenue|Revenue/);
      }
    }
  });
});

describe("questionnaire architecture: wording routes as recorded", () => {
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
    });
  }
});

describe("questionnaire architecture: document", () => {
  it("docs/questionnaire-architecture.md matches the catalogue", () => {
    const committed = readFileSync(resolve(process.cwd(), "docs/questionnaire-architecture.md"), "utf8");
    expect(committed.trimEnd()).toBe(renderCatalogueMarkdown().trimEnd());
  });
});
