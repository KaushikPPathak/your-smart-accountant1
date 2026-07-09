import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "./router";
import { setupAppShellCache } from "./lib/pwa-registration";
import { checkSchemaVersionOnBoot } from "./lib/offline/schema-version";
import "./styles.css";

// Self-healing schema check: if the local cache was written by an older
// version of the app, silently trigger a full snapshot refetch (when
// online + not local-only). Fire-and-forget — never blocks first paint.
void checkSchemaVersionOnBoot().catch((err) => {
  console.warn("schema-version check failed:", err);
});

// Ask the browser to keep our IndexedDB / cache data across eviction
// pressure. Best-effort: silently no-ops on browsers without the API.
if (typeof navigator !== "undefined" && navigator.storage?.persist) {
  void navigator.storage.persisted().then((already) => {
    if (!already) {
      navigator.storage.persist().catch(() => {
        /* user denied or unsupported — ignore */
      });
    }
  });
}

setupAppShellCache();

const router = getRouter();
const container = document.getElementById("root");
if (!container) throw new Error("Root container #root not found");
createRoot(container).render(<RouterProvider router={router} />);
