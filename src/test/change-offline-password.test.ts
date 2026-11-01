import { describe, expect, it } from "vitest";
import { createLocalAccount, changeOfflinePassword, verifyOfflineLogin } from "@/lib/offline/creds-cache";

describe("changeOfflinePassword", () => {
  it("changes the password only when the current one matches", async () => {
    const acct = await createLocalAccount({ name: "Asha", username: "asha-pw", password: "oldpass1", role: "admin", hidden: false });

    await expect(changeOfflinePassword(acct.id, "wrong-one", "newpass1")).rejects.toThrow("Current password is wrong");
    await expect(changeOfflinePassword(acct.id, "oldpass1", "short")).rejects.toThrow("at least 6");

    await changeOfflinePassword(acct.id, "oldpass1", "newpass1");
    expect(await verifyOfflineLogin("asha-pw", "newpass1")).not.toBeNull();
    expect(await verifyOfflineLogin("asha-pw", "oldpass1")).toBeNull();
  });
});
