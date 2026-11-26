import { beforeEach, describe, expect, it } from "vitest";
import { getClientId, getStoredClientId } from "@/lib/cloud-providers";
import { ensureOneDriveClientId, isOneDriveSignedIn } from "@/lib/sync/onedrive-session";
import { ONEDRIVE_CLIENT_ID } from "@/lib/sync/onedrive-config";

describe("OneDrive session", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("sets the app client id when none is stored", () => {
    expect(getStoredClientId("onedrive")).toBeNull();
    expect(ensureOneDriveClientId()).toBe(ONEDRIVE_CLIENT_ID);
    expect(getClientId("onedrive")).toBe(ONEDRIVE_CLIENT_ID);
  });

  it("keeps a client id the user already stored", () => {
    localStorage.setItem("ym_cloud_client_id:onedrive", "user-own-id");
    expect(ensureOneDriveClientId()).toBe("user-own-id");
  });

  it("reports not signed in before any token is stored", () => {
    expect(isOneDriveSignedIn()).toBe(false);
  });
});
