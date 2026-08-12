import { describe, expect, it } from "vitest";
import { annBuild, annCandidates, annAdd, annRemove, createAnn } from "../vector-index";
import { embed, cosine } from "../semantic-index";

function corpus(n: number) {
  const docs: Array<{ id: string; vec: Float32Array; name: string }> = [];
  for (let i = 0; i < n; i++) {
    const name = `Ledger ${i} ${["Traders", "Enterprises", "Paper Co", "Steel", "Agro"][i % 5]}`;
    docs.push({ id: String(i), name, vec: embed(name) });
  }
  return docs;
}

describe("vector-index (ANN)", () => {
  it("keeps top-1 recall against a linear scan", () => {
    const docs = corpus(2000);
    const idx = annBuild(256, docs);
    let hits = 0;
    const queries = docs.filter((_, i) => i % 97 === 0);
    for (const q of queries) {
      const exact = [...docs].sort((a, b) => cosine(q.vec, b.vec) - cosine(q.vec, a.vec))[0];
      const cands = annCandidates(idx, q.vec, 8);
      const pool = cands ? docs.filter((d) => cands.has(d.id)) : docs;
      const approx = [...pool].sort((a, b) => cosine(q.vec, b.vec) - cosine(q.vec, a.vec))[0];
      if (approx && approx.id === exact.id) hits++;
    }
    expect(hits / queries.length).toBeGreaterThanOrEqual(0.9);
  });

  it("scans far fewer docs than the full corpus", () => {
    const docs = corpus(2000);
    const idx = annBuild(256, docs);
    const cands = annCandidates(idx, embed("Ledger 42 Paper Co"), 8);
    expect(cands).not.toBeNull();
    expect(cands!.size).toBeLessThan(docs.length);
  });

  it("supports incremental add and remove", () => {
    const idx = createAnn(256);
    annAdd(idx, "a", embed("Arihant Paper Co"));
    annAdd(idx, "b", embed("Bharat Steel"));
    expect(idx.size).toBe(2);
    annRemove(idx, "a");
    expect(idx.size).toBe(1);
    expect(idx.keysById.has("a")).toBe(false);
    // re-adding the same id must not double count
    annAdd(idx, "b", embed("Bharat Steel Ltd"));
    expect(idx.size).toBe(1);
  });
});
