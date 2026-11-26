import { describe, expect, it } from "vitest";
import { createMemoryFolder, createOneDriveFolder, isTempName } from "@/lib/sync/cloud-folder";

describe("memory folder", () => {
  it("writes, reads and lists without temporary files", async () => {
    const f = createMemoryFolder();
    await f.writeAtomic("outbox-pc-0001.enc", "AAA");
    await f.writeAtomic("snapshot-0002.enc", "BBB");
    expect(await f.read("outbox-pc-0001.enc")).toBe("AAA");
    expect(await f.list("outbox-")).toEqual(["outbox-pc-0001.enc"]);
    expect([...f.files.keys()].some(isTempName)).toBe(false);
  });

  it("replaces a file and leaves no temp copy", async () => {
    const f = createMemoryFolder();
    await f.writeAtomic("x.enc", "one");
    await f.writeAtomic("x.enc", "two");
    expect(await f.read("x.enc")).toBe("two");
  });

  it("rejects path traversal", async () => {
    const f = createMemoryFolder();
    await expect(f.writeAtomic("../evil", "x")).rejects.toThrow("Unsafe");
    await expect(f.read("a/b")).rejects.toThrow("Unsafe");
  });

  it("returns null for a missing file", async () => {
    expect(await createMemoryFolder().read("nope.enc")).toBeNull();
  });
});

// A fake Graph endpoint: enough to check the request sequence and the rename rule.
function fakeGraph() {
  const items = new Map<string, string>();
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    if (url.includes("/children")) {
      return new Response(JSON.stringify({ value: [...items.keys()].map((name) => ({ name })) }), { status: 200 });
    }
    const path = decodeURIComponent(url.split("approot:/")[1] ?? "").replace(/:(\/content)?$/, "");
    if (method === "PUT") {
      items.set(path, String(init.body));
      return new Response("", { status: 201 });
    }
    if (method === "PATCH") {
      const body = JSON.parse(String(init.body)) as { name: string };
      const value = items.get(path);
      if (value === undefined) return new Response("", { status: 404 });
      items.delete(path);
      items.set(body.name, value);
      return new Response("", { status: 200 });
    }
    if (method === "DELETE") {
      items.delete(path);
      return new Response(null, { status: 204 });
    }
    if (method === "GET" && url.endsWith("/content")) {
      const v = items.get(path);
      return v === undefined ? new Response("", { status: 404 }) : new Response(v, { status: 200 });
    }
    return new Response("", { status: 400 });
  }) as typeof fetch;
  return { fetchImpl, items };
}

describe("OneDrive folder", () => {
  it("replaces a file through the temp-then-rename sequence", async () => {
    const g = fakeGraph();
    const f = createOneDriveFolder(async () => "token", g.fetchImpl);
    await f.writeAtomic("snapshot.enc", "v1");
    expect(await f.read("snapshot.enc")).toBe("v1");
    await f.writeAtomic("snapshot.enc", "v2");
    expect(await f.read("snapshot.enc")).toBe("v2");
    expect(await f.list("snap")).toEqual(["snapshot.enc"]);
    expect([...g.items.keys()].some(isTempName)).toBe(false);
  });

  it("sends the bearer token on every request", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit = {}) => {
      seen.push(String((init.headers as Record<string, string>).Authorization));
      return new Response(JSON.stringify({ value: [] }), { status: 200 });
    }) as typeof fetch;
    await createOneDriveFolder(async () => "abc", fetchImpl).list("");
    expect(seen).toEqual(["Bearer abc"]);
  });

  it("reports a failed upload without renaming", async () => {
    const fetchImpl = (async () => new Response("", { status: 500 })) as typeof fetch;
    const f = createOneDriveFolder(async () => "t", fetchImpl);
    await expect(f.writeAtomic("a.enc", "x")).rejects.toThrow("upload failed");
  });
});
