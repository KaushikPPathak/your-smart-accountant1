import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ meta: new Map<string, unknown>(), calls: [] as { url: string; headers: any }[], status: 200 }));

vi.mock("@/lib/offline/db", () => ({
  getMeta: async (k: string) => store.meta.get(k),
  setMeta: async (k: string, v: unknown) => { store.meta.set(k, v); },
}));

import { getInstallId, isInstallId, limitMessageFor, lookupGstinViaSetu, setGstinProxyUrlForTests } from "@/lib/setu";

beforeEach(() => {
  store.meta.clear();
  store.calls.length = 0;
  store.status = 200;
  setGstinProxyUrlForTests("https://example.supabase.co/functions/v1/setu-gstin-proxy");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: any) => {
    store.calls.push({ url, headers: init.headers });
    return new Response(JSON.stringify({ ok: store.status === 200, status: store.status, json: { sta: "Active" }, error: "x" }), { status: store.status });
  }));
});

describe("install id", () => {
  it("accepts only UUID v4 shapes", () => {
    expect(isInstallId("3f2504e0-4f89-41d3-9a0c-0305e82c3301")).toBe(true);
    expect(isInstallId("not-a-uuid")).toBe(false);
    expect(isInstallId(undefined)).toBe(false);
  });

  it("is created once and then reused", async () => {
    const a = await getInstallId();
    const b = await getInstallId();
    expect(isInstallId(a)).toBe(true);
    expect(b).toBe(a);
  });

  it("is sent with every lookup", async () => {
    const id = await getInstallId();
    await lookupGstinViaSetu("09AAAAA0000A1Z5");
    expect(store.calls[0].headers["x-install-id"]).toBe(id);
  });
});

describe("refusals", () => {
  it("maps 429 and 401 to plain messages", () => {
    expect(limitMessageFor(429)).toMatch(/limit is reached/);
    expect(limitMessageFor(401)).toMatch(/could not be identified/);
    expect(limitMessageFor(200)).toBeNull();
  });

  it("shows the limit message when the proxy refuses, without calling a result", async () => {
    store.status = 429;
    const r = await lookupGstinViaSetu("09AAAAA0000A1Z5");
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/limit is reached/);
  });
});
