#!/usr/bin/env node
/**
 * After `vite build`, the Cloudflare SSR worker lives at dist/server/index.js
 * and there is no static dist/client/index.html. Tauri loads `frontendDist`
 * from the file system, so it needs an index.html on disk.
 *
 * This script invokes the SSR worker once for "/" and writes the rendered
 * HTML to dist/client/index.html. The client router then takes over after
 * hydration and handles all in-app navigation offline.
 */
import { mkdir, writeFile, access } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const workerPath = resolve("dist/server/index.js");
const outPath = resolve("dist/client/index.html");

async function main() {
  try {
    await access(workerPath);
  } catch {
    console.error(`[tauri-prerender] worker not found at ${workerPath}`);
    process.exit(1);
  }

  const mod = await import(pathToFileURL(workerPath).href);
  const handler = mod.default ?? mod;
  if (!handler?.fetch) {
    console.error("[tauri-prerender] worker has no fetch handler");
    process.exit(1);
  }

  const req = new Request("http://localhost/");
  const res = await handler.fetch(req, {}, { waitUntil() {}, passThroughOnException() {} });
  if (!res.ok) {
    console.error(`[tauri-prerender] worker returned HTTP ${res.status}`);
    process.exit(1);
  }
  let html = await res.text();

  // Rewrite absolute asset paths to be relative so file:// loading works
  // regardless of the directory Tauri serves from.
  html = html
    .replace(/(href|src)="\/assets\//g, '$1="./assets/')
    .replace(/(href|src)='\/assets\//g, "$1='./assets/");

  if (!html.includes("</html>")) {
    console.error("[tauri-prerender] rendered HTML is incomplete");
    process.exit(1);
  }

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, html, "utf8");
  console.log(`[tauri-prerender] wrote ${outPath} (${html.length} bytes)`);
}

main().catch((err) => {
  console.error("[tauri-prerender] failed:", err);
  process.exit(1);
});
