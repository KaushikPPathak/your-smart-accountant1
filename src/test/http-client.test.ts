import { describe, expect, it } from "vitest";
import { appFetch, withoutOriginHeader } from "@/lib/http-client";

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

describe("withoutOriginHeader", () => {
  it("adds an empty Origin header and keeps the others", () => {
    const init = withoutOriginHeader({ method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    const h = new Headers(init.headers);
    expect(h.get("Origin")).toBe("");
    expect(h.get("Content-Type")).toBe("application/x-www-form-urlencoded");
    expect(init.method).toBe("POST");
  });

  it("works with no init at all", () => {
    expect(new Headers(withoutOriginHeader().headers).get("Origin")).toBe("");
  });
});
