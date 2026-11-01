import { describe, expect, it, beforeEach } from "vitest";
import { offlineDb as db } from "@/lib/offline/db";
import { saveBom, loadBomForOutput } from "@/lib/bom";

describe("BOM templates (local)", () => {
  beforeEach(async () => {
    await Promise.all([db.cache_bom_templates.clear(), db.cache_bom_template_lines.clear()]);
  });

  it("saves a BOM and reads it back in line order", async () => {
    await saveBom("co-1", "OUT-1", 10, "pack", [
      { input_item_id: "IN-B", qty_per_output: 2, specs: { gsm: "120" } },
      { input_item_id: "IN-A", qty_per_output: 1, specs: null },
    ]);
    const b = await loadBomForOutput("co-1", "OUT-1");
    expect(b).not.toBeNull();
    expect(b!.template.output_qty).toBe(10);
    expect(b!.lines.map((l) => l.input_item_id)).toEqual(["IN-B", "IN-A"]);
    expect(b!.lines[0].specs).toEqual({ gsm: "120" });
  });

  it("saving again replaces the lines and keeps one template", async () => {
    await saveBom("co-1", "OUT-1", 10, null, [{ input_item_id: "IN-A", qty_per_output: 1, specs: null }]);
    await saveBom("co-1", "OUT-1", 5, "changed", [{ input_item_id: "IN-C", qty_per_output: 3, specs: null }]);
    const b = await loadBomForOutput("co-1", "OUT-1");
    expect(b!.template.output_qty).toBe(5);
    expect(b!.lines.map((l) => l.input_item_id)).toEqual(["IN-C"]);
    expect(await db.cache_bom_templates.count()).toBe(1);
  });

  it("keeps companies separate", async () => {
    await saveBom("co-1", "OUT-1", 10, null, []);
    expect(await loadBomForOutput("co-2", "OUT-1")).toBeNull();
  });
});
