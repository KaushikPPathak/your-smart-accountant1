import { supabase } from "@/integrations/supabase/client";

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
  const { data: t } = await supabase
    .from("bom_templates")
    .select("id, company_id, output_item_id, output_qty, notes, is_active")
    .eq("company_id", companyId)
    .eq("output_item_id", outputItemId)
    .eq("is_active", true)
    .maybeSingle();
  if (!t) return null;
  const { data: lines } = await supabase
    .from("bom_template_lines")
    .select("id, template_id, input_item_id, qty_per_output, specs, line_no")
    .eq("template_id", t.id)
    .order("line_no");
  return {
    template: t as BomTemplateRow,
    lines: (lines || []) as BomLineRow[],
  };
}

/** Upserts a BOM template + replaces its lines. */
export async function saveBom(
  companyId: string,
  outputItemId: string,
  outputQty: number,
  notes: string | null,
  lines: Array<{ input_item_id: string; qty_per_output: number; specs: BomSpecs | null }>,
): Promise<void> {
  const existing = await loadBomForOutput(companyId, outputItemId);
  let templateId: string;
  if (existing) {
    templateId = existing.template.id;
    const { error: uErr } = await supabase
      .from("bom_templates")
      .update({ output_qty: outputQty, notes })
      .eq("id", templateId);
    if (uErr) throw uErr;
    await supabase.from("bom_template_lines").delete().eq("template_id", templateId);
  } else {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("bom_templates")
      .insert({
        company_id: companyId,
        output_item_id: outputItemId,
        output_qty: outputQty,
        notes,
        created_by: user?.id ?? null,
      })
      .select("id")
      .single();
    if (error) throw error;
    templateId = data.id;
  }
  if (lines.length > 0) {
    const rows = lines.map((l, i) => ({
      template_id: templateId,
      input_item_id: l.input_item_id,
      qty_per_output: l.qty_per_output,
      specs: (l.specs ?? null) as unknown as Record<string, string>,
      line_no: i + 1,
    }));
    const { error } = await supabase.from("bom_template_lines").insert(rows);
    if (error) throw error;
  }
}
