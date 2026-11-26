// A user's own cloud folder (OneDrive first; Google Drive and Dropbox later
// with the same interface). Used as the transport for encrypted packets and
// encrypted backups. Only ciphertext is ever written here.
//
// Write rule: a file is written under a temporary name first and then renamed
// into place. Readers ignore temporary files, so a half-written file is never
// read. OneDrive cannot replace a file atomically in one call, so a replace is
// done as: upload temp, delete old, rename temp. Each step is idempotent, and a
// reader that finds no final file simply waits for the next cycle.

export const TEMP_SUFFIX = ".tmp";

export interface CloudFolder {
  /** Names of files in the sync folder, excluding temporary files. */
  list(prefix: string): Promise<string[]>;
  read(name: string): Promise<string | null>;
  /** Replace or create a file atomically from the reader's point of view. */
  writeAtomic(name: string, text: string): Promise<void>;
  delete(name: string): Promise<void>;
}

export function isTempName(name: string): boolean {
  return name.endsWith(TEMP_SUFFIX);
}

function assertSafeName(name: string): void {
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..") || name.length > 200) {
    throw new Error("Unsafe file name");
  }
}

/** In-memory folder for tests and for the fake sync harness. */
export function createMemoryFolder(): CloudFolder & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    async list(prefix) {
      return [...files.keys()].filter((n) => n.startsWith(prefix) && !isTempName(n)).sort();
    },
    async read(name) {
      assertSafeName(name);
      return files.get(name) ?? null;
    },
    async writeAtomic(name, text) {
      assertSafeName(name);
      files.set(name + TEMP_SUFFIX, text);
      files.set(name, text);
      files.delete(name + TEMP_SUFFIX);
    },
    async delete(name) {
      assertSafeName(name);
      files.delete(name);
    },
  };
}

export type TokenProvider = () => Promise<string>;

const APPROOT = "https://graph.microsoft.com/v1.0/me/drive/special/approot";

/**
 * OneDrive folder under the app's own folder (approot), via Microsoft Graph.
 * Works with a token from the sign-in flow; the token is never stored here.
 */
export function createOneDriveFolder(getToken: TokenProvider, fetchImpl: typeof fetch = fetch): CloudFolder {
  const auth = async (extra: Record<string, string> = {}) => ({
    Authorization: `Bearer ${await getToken()}`,
    ...extra,
  });
  const itemUrl = (name: string) => `${APPROOT}:/${encodeURIComponent(name)}:`;

  return {
    async list(prefix) {
      const res = await fetchImpl(`${APPROOT}:/children?$select=name`, { headers: await auth() });
      if (res.status === 404) return [];
      if (!res.ok) throw new Error(`OneDrive list failed (${res.status})`);
      const body = (await res.json()) as { value: Array<{ name: string }> };
      return body.value
        .map((v) => v.name)
        .filter((n) => n.startsWith(prefix) && !isTempName(n))
        .sort();
    },
    async read(name) {
      assertSafeName(name);
      const res = await fetchImpl(`${itemUrl(name)}/content`, { headers: await auth() });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`OneDrive read failed (${res.status})`);
      return res.text();
    },
    async writeAtomic(name, text) {
      assertSafeName(name);
      const tmp = name + TEMP_SUFFIX;
      const put = await fetchImpl(`${itemUrl(tmp)}/content`, {
        method: "PUT",
        headers: await auth({ "Content-Type": "text/plain" }),
        body: text,
      });
      if (!put.ok) throw new Error(`OneDrive upload failed (${put.status})`);
      // Remove the old final file (ignore if absent), then rename the temp file into place.
      await fetchImpl(itemUrl(name), { method: "DELETE", headers: await auth() });
      const ren = await fetchImpl(itemUrl(tmp), {
        method: "PATCH",
        headers: await auth({ "Content-Type": "application/json" }),
        body: JSON.stringify({ name }),
      });
      if (!ren.ok) throw new Error(`OneDrive rename failed (${ren.status})`);
    },
    async delete(name) {
      assertSafeName(name);
      const res = await fetchImpl(itemUrl(name), { method: "DELETE", headers: await auth() });
      if (!res.ok && res.status !== 404) throw new Error(`OneDrive delete failed (${res.status})`);
    },
  };
}
