import { createServerFn } from "@tanstack/react-start";

interface ProxyInput {
  gstin: string;
  clientId?: string;
  clientSecret?: string;
  productInstanceId?: string;
  environment?: "production" | "sandbox";
}

export const lookupGstinSetuProxy = createServerFn({ method: "POST" })
  .inputValidator((input: ProxyInput) => input)
  .handler(async ({ data }) => {
    const gstin = (data.gstin || "").trim().toUpperCase();
    if (!gstin) {
      return { ok: false as const, status: 400, error: "GSTIN is required", json: null as unknown };
    }

    const clientId = data.clientId || process.env.SETU_CLIENT_ID || "com.shcglobaltrade";
    const clientSecret = data.clientSecret || process.env.SETU_API_KEY || "";
    const productInstanceId = data.productInstanceId || process.env.SETU_PRODUCT_INSTANCE_ID || "";
    const env = data.environment === "sandbox" ? "sandbox" : "production";

    if (!clientId || !clientSecret) {
      return { ok: false as const, status: 400, error: "Setu credentials not configured", json: null as unknown };
    }

    const url =
      env === "sandbox"
        ? "https://dg-sandbox.setu.co/api/verify/gstin"
        : "https://dg.setu.co/api/verify/gstin";

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-client-id": clientId,
      "x-client-secret": clientSecret,
    };
    if (productInstanceId) headers["x-product-instance-id"] = productInstanceId;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ gstin }),
      });
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        /* ignore */
      }
      return { ok: res.ok, status: res.status, error: undefined as string | undefined, json };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false as const, status: 0, error: `Upstream error: ${msg}`, json: null as unknown };
    }
  });
