// Bill of materials (BOM) templates for the local-only build. Templates and
// their lines are stored in this PC's books.
import { offlineDb as db } from "@/lib/offline/db";
import { newId } from "@/lib/utils/sys-utils";

export interface BomTemplateRow {
  id: string;
  company_id: string;
  output_item_id: string;
  output_qty: number;
  notes: string | null;
  is_active: boolean;
}

export interface BomLineRow {
  id: string;
  template_id: string;
  input_item_id: string;
  qty_per_output: number;
  specs: BomSpecs | null;
  line_no: number;
}

export interface BomSpecs {
  gsm?: string;
  length_cm?: string;
  height_cm?: string;
  weight_per_unit_g?: string;
}

export interface LoadedBom {
  template: BomTemplateRow;
  lines: BomLineRow[];
}

/** Returns the active BOM (if any) for a given output item in a company. */
export async function loadBomForOutput(
  companyId: string,
  outputItemId: string,
): Promise<LoadedBom | null> {
  const templates: any[] = await db.cache_bom_templates.where("company_id").equals(companyId).toArray();
  const t = templates.find(
    (x) => String(x.output_item_id) === String(outputItemId) && x.is_active !== false && !x.deleted_at,
  );
  if (!t) return null;
  const lines: any[] = await db.cache_bom_template_lines.where("template_id").equals(t.id).toArray();
  return {
    template: {
      id: String(t.id),
      company_id: String(t.company_id),
      output_item_id: String(t.output_item_id),
      output_qty: Number(t.output_qty) || 0,
      notes: t.notes ?? null,
      is_active: t.is_active !== false,
    },
    lines: lines
      .map((l) => ({
        id: String(l.id),
        template_id: String(l.template_id),
        input_item_id: String(l.input_item_id),
        qty_per_output: Number(l.qty_per_output) || 0,
        specs: (l.specs ?? null) as BomSpecs | null,
        line_no: Number(l.line_no) || 0,
      }))
      .sort((a, b) => a.line_no - b.line_no),
  };
}

/** Saves a BOM template and replaces its lines. */
export async function saveBom(
  companyId: string,
  outputItemId: string,
  outputQty: number,
  notes: string | null,
  lines: Array<{ input_item_id: string; qty_per_output: number; specs: BomSpecs | null }>,
): Promise<void> {
  const now = new Date().toISOString();
  const existing = await loadBomForOutput(companyId, outputItemId);
  await db.transaction("rw", [db.cache_bom_templates, db.cache_bom_template_lines], async () => {
    let templateId: string;
    if (existing) {
      templateId = existing.template.id;
      await db.cache_bom_templates.update(templateId, { output_qty: outputQty, notes, updated_at: now });
      await db.cache_bom_template_lines.where("template_id").equals(templateId).delete();
    } else {
      templateId = newId();
      await db.cache_bom_templates.put({
        id: templateId,
        company_id: companyId,
        output_item_id: outputItemId,
        output_qty: outputQty,
        notes,
        is_active: true,
        created_at: now,
        updated_at: now,
      });
    }
    if (lines.length > 0) {
      await db.cache_bom_template_lines.bulkPut(
        lines.map((l, i) => ({
          id: newId(),
          template_id: templateId,
          company_id: companyId,
          input_item_id: l.input_item_id,
          qty_per_output: l.qty_per_output,
          specs: l.specs ?? null,
          line_no: i + 1,
        })),
      );
    }
  });
}
