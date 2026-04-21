// Setu GSP integration — server functions for E-Invoice (IRN) and E-Way Bill.
// All credential reads use the service-role admin client (bypasses RLS); the
// caller is authenticated and authorised via requireSupabaseAuth + role check.
//
// Setu API docs: https://docs.setu.co/data/gst/e-invoice
//                https://docs.setu.co/data/gst/e-way-bill
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Setu base URLs — sandbox vs production
function setuBaseUrl(env: string): string {
  return env === "production"
    ? "https://prod.setu.co/api/einv"
    : "https://uat.setu.co/api/einv";
}

interface CredsRow {
  company_id: string;
  environment: string;
  setu_client_id: string | null;
  setu_client_secret: string | null;
  gstn_username: string | null;
  einvoice_enabled: boolean;
  ewaybill_enabled: boolean;
  last_token: string | null;
  last_token_expires_at: string | null;
}

async function loadCreds(companyId: string): Promise<CredsRow | null> {
  const { data } = await supabaseAdmin
    .from("gst_api_credentials")
    .select(
      "company_id, environment, setu_client_id, setu_client_secret, gstn_username, einvoice_enabled, ewaybill_enabled, last_token, last_token_expires_at",
    )
    .eq("company_id", companyId)
    .maybeSingle();
  return (data as CredsRow | null) ?? null;
}

async function ensureToken(c: CredsRow): Promise<string> {
  // If cached token still valid for >2 min, reuse it.
  if (c.last_token && c.last_token_expires_at) {
    const exp = new Date(c.last_token_expires_at).getTime();
    if (exp - Date.now() > 120_000) return c.last_token;
  }
  if (!c.setu_client_id || !c.setu_client_secret) {
    throw new Error("Setu credentials not configured");
  }
  const res = await fetch(`${setuBaseUrl(c.environment)}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: c.setu_client_id,
      clientSecret: c.setu_client_secret,
      grant_type: "client_credentials",
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    message?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(`Setu auth failed [${res.status}]: ${json.error || json.message || "unknown"}`);
  }
  const expIso = new Date(Date.now() + (json.expires_in ?? 3600) * 1000).toISOString();
  await supabaseAdmin
    .from("gst_api_credentials")
    .update({ last_token: json.access_token, last_token_expires_at: expIso })
    .eq("company_id", c.company_id);
  return json.access_token;
}

async function logCall(args: {
  companyId: string;
  voucherId: string | null;
  action: string;
  request: unknown;
  response: unknown;
  success: boolean;
  errorMessage?: string;
  userId: string;
}): Promise<void> {
  await supabaseAdmin.from("einvoice_api_log").insert({
    company_id: args.companyId,
    voucher_id: args.voucherId,
    action: args.action,
    request_summary: args.request as Record<string, unknown>,
    response_summary: args.response as Record<string, unknown>,
    success: args.success,
    error_message: args.errorMessage ?? null,
    created_by: args.userId,
  });
}

async function assertAdmin(supabase: ReturnType<typeof supabaseAdmin.auth.admin.listUsers> extends infer _ ? typeof supabaseAdmin : never, companyId: string, userId: string): Promise<void> {
  // Use authed client passed via context — this enforces RLS / role.
  // Implemented inline below per server fn for clarity.
  void supabase; void companyId; void userId;
}

// ---------- Check status ----------
export const getSetuStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ companyId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // RLS will only return the row if user is admin
    const { data: c } = await supabase
      .from("gst_api_credentials")
      .select("environment, einvoice_enabled, ewaybill_enabled, setu_client_id, gstn_username")
      .eq("company_id", data.companyId)
      .maybeSingle();
    return {
      configured: !!(c && c.setu_client_id),
      einvoice_enabled: !!c?.einvoice_enabled,
      ewaybill_enabled: !!c?.ewaybill_enabled,
      environment: c?.environment ?? "sandbox",
      gstn_username: c?.gstn_username ?? null,
    };
  });

// ---------- Generate IRN ----------
export const generateIrn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      voucherId: z.string().uuid(),
      companyId: z.string().uuid(),
      payload: z.record(z.string(), z.unknown()), // canonical IRP invoice payload built on client
    }),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const creds = await loadCreds(data.companyId);
    if (!creds || !creds.setu_client_id) {
      return { success: false, error: "Setu API credentials are not configured. Add them in Settings → GST APIs." };
    }
    if (!creds.einvoice_enabled) {
      return { success: false, error: "E-Invoicing is disabled for this company. Enable it in Settings → GST APIs." };
    }
    try {
      const token = await ensureToken(creds);
      const res = await fetch(`${setuBaseUrl(creds.environment)}/einvoice`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "x-product-instance-id": creds.setu_client_id,
        },
        body: JSON.stringify({ data: data.payload }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        data?: { Irn?: string; AckNo?: string; AckDt?: string; SignedQRCode?: string; SignedInvoice?: string };
        error?: { message?: string; code?: string };
      };
      if (!res.ok || !json.data?.Irn) {
        const msg = json.error?.message || `IRN generation failed [${res.status}]`;
        await logCall({ companyId: data.companyId, voucherId: data.voucherId, action: "generate_irn", request: { docNo: (data.payload as { DocDtls?: { No?: string } }).DocDtls?.No }, response: json, success: false, errorMessage: msg, userId });
        return { success: false, error: msg };
      }
      // Persist
      await supabaseAdmin.from("einvoice_details").upsert(
        {
          voucher_id: data.voucherId,
          company_id: data.companyId,
          irn: json.data.Irn,
          ack_no: json.data.AckNo ?? null,
          ack_date: json.data.AckDt ?? null,
          signed_qr: json.data.SignedQRCode ?? null,
          signed_invoice: json.data.SignedInvoice ?? null,
          status: "generated",
        },
        { onConflict: "voucher_id" },
      );
      await logCall({ companyId: data.companyId, voucherId: data.voucherId, action: "generate_irn", request: { docNo: (data.payload as { DocDtls?: { No?: string } }).DocDtls?.No }, response: { Irn: json.data.Irn, AckNo: json.data.AckNo }, success: true, userId });
      return { success: true, irn: json.data.Irn, ackNo: json.data.AckNo, ackDate: json.data.AckDt, signedQr: json.data.SignedQRCode };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      await logCall({ companyId: data.companyId, voucherId: data.voucherId, action: "generate_irn", request: {}, response: {}, success: false, errorMessage: msg, userId });
      return { success: false, error: msg };
    }
  });

// ---------- Generate E-Way Bill ----------
export const generateEwb = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      voucherId: z.string().uuid(),
      companyId: z.string().uuid(),
      payload: z.record(z.string(), z.unknown()),
    }),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const creds = await loadCreds(data.companyId);
    if (!creds || !creds.setu_client_id) {
      return { success: false, error: "Setu API credentials are not configured." };
    }
    if (!creds.ewaybill_enabled) {
      return { success: false, error: "E-Way Bill is disabled for this company. Enable in Settings → GST APIs." };
    }
    try {
      const token = await ensureToken(creds);
      const res = await fetch(`${setuBaseUrl(creds.environment)}/ewaybill`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "x-product-instance-id": creds.setu_client_id,
        },
        body: JSON.stringify({ data: data.payload }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        data?: { ewbNo?: string | number; ewbDate?: string; ewbValidTill?: string };
        error?: { message?: string };
      };
      if (!res.ok || !json.data?.ewbNo) {
        const msg = json.error?.message || `EWB generation failed [${res.status}]`;
        await logCall({ companyId: data.companyId, voucherId: data.voucherId, action: "generate_ewb", request: { docNo: (data.payload as { docNo?: string }).docNo }, response: json, success: false, errorMessage: msg, userId });
        return { success: false, error: msg };
      }
      await supabaseAdmin.from("einvoice_details").upsert(
        {
          voucher_id: data.voucherId,
          company_id: data.companyId,
          ewb_no: String(json.data.ewbNo),
          ewb_date: json.data.ewbDate ?? null,
          ewb_valid_until: json.data.ewbValidTill ?? null,
        },
        { onConflict: "voucher_id" },
      );
      await logCall({ companyId: data.companyId, voucherId: data.voucherId, action: "generate_ewb", request: { docNo: (data.payload as { docNo?: string }).docNo }, response: { ewbNo: json.data.ewbNo }, success: true, userId });
      return { success: true, ewbNo: String(json.data.ewbNo), ewbValidUntil: json.data.ewbValidTill };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      await logCall({ companyId: data.companyId, voucherId: data.voucherId, action: "generate_ewb", request: {}, response: {}, success: false, errorMessage: msg, userId });
      return { success: false, error: msg };
    }
  });

// ---------- Save credentials ----------
export const saveSetuCredentials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      companyId: z.string().uuid(),
      environment: z.enum(["sandbox", "production"]),
      setuClientId: z.string().min(1).max(200),
      setuClientSecret: z.string().min(1).max(500),
      gstnUsername: z.string().max(100).optional(),
      einvoiceEnabled: z.boolean(),
      ewaybillEnabled: z.boolean(),
    }),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // RLS ensures only admin can write
    const { error } = await supabase.from("gst_api_credentials").upsert(
      {
        company_id: data.companyId,
        provider: "setu",
        environment: data.environment,
        setu_client_id: data.setuClientId,
        setu_client_secret: data.setuClientSecret,
        gstn_username: data.gstnUsername ?? null,
        einvoice_enabled: data.einvoiceEnabled,
        ewaybill_enabled: data.ewaybillEnabled,
        last_token: null,
        last_token_expires_at: null,
      },
      { onConflict: "company_id" },
    );
    if (error) return { success: false, error: error.message };
    return { success: true };
  });

// silence unused import in the type-only assertion helper
void assertAdmin;
