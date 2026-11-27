import { describe, expect, it } from "vitest";
import { appFetch } from "@/lib/http-client";

describe("appFetch", () => {
  it("uses the browser fetch when not running in the desktop app", async () => {
    const original = globalThis.fetch;
    let called = "";
    globalThis.fetch = (async (url: string) => {
      called = String(url);
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    try {
      const res = await appFetch("https://example.test/x");
      expect(called).toBe("https://example.test/x");
      expect(await res.text()).toBe("ok");
    } finally {
      globalThis.fetch = original;
    }
  });
});
