// Online/offline detection.
//
// Keep this completely client-local. Probing backend health endpoints from the
// browser can create noisy 401s when extensions or stale keys rewrite headers.
import { useEffect, useState } from "react";
export function isOnlineNow() {
    if (typeof navigator === "undefined")
        return true;
    return navigator.onLine !== false;
}
let lastPingAt = 0;
let lastPingResult = true;
export async function pingOnline(_timeoutMs = 2500) {
    if (!isOnlineNow())
        return false;
    const now = Date.now();
    if (now - lastPingAt < 10000)
        return lastPingResult;
    lastPingResult = isOnlineNow();
    lastPingAt = now;
    return lastPingResult;
}
export function useOnlineStatus() {
    const [online, setOnline] = useState(isOnlineNow());
    useEffect(() => {
        const on = () => setOnline(true);
        const off = () => setOnline(false);
        window.addEventListener("online", on);
        window.addEventListener("offline", off);
        return () => {
            window.removeEventListener("online", on);
            window.removeEventListener("offline", off);
        };
    }, []);
    return online;
}
