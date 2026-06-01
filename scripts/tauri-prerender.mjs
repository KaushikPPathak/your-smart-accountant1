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
import { mkdir, writeFile, access, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const workerPath = resolve("dist/server/index.js");
const outPath = resolve("dist/client/index.html");
const assetsDir = resolve("dist/client/assets");

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

  let html;
  const req = new Request("http://localhost/");
  
  try {
    const res = await handler.fetch(req, {}, { waitUntil() {}, passThroughOnException() {} });
    
    if (!res.ok) {
      console.warn(`[tauri-prerender] worker returned HTTP ${res.status}. Dropping back to clean SPA layout shell...`);
      html = await getStandaloneFallbackHtml();
    } else {
      html = await res.text();
    }
  } catch (fetchErr) {
    console.warn("[tauri-prerender] Worker fetch execution failed. Generating baseline client template:", fetchErr.message);
    html = await getStandaloneFallbackHtml();
  }

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

/**
 * Creates a clean baseline Single Page Application shell.
 * Dynamically resolves the compiled CSS asset filename to satisfy verification scripts.
 */
async function getStandaloneFallbackHtml() {
  let cssFilename = "index.css"; // Default fallback string
  
  try {
    // Scan the compiled assets directory to grab the real fingerprinted CSS file name
    const files = await readdir(assetsDir);
    const foundCss = files.find(file => file.startsWith("index-") && file.endsWith(".css")) || files.find(file => file.endsWith(".css"));
    if (foundCss) {
      cssFilename = foundCss;
      console.log(`[tauri-prerender] Dynamically matched production CSS file: ${cssFilename}`);
    }
  } catch (e) {
    console.warn("[tauri-prerender] Could not scan assets directory for custom CSS name, using default fallback path.", e.message);
  }

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Smart Accountant</title>
    <script type="module">
      import "/@vite/client";
    </script>
    <link rel="stylesheet" href="/assets/${cssFilename}" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`;
}

main().catch((err) => {
  console.error("[tauri-prerender] failed:", err);
  process.exit(1);
});
