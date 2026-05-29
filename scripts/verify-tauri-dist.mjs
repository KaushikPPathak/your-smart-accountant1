#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";

const indexPath = resolve("dist/client/index.html");
const distDir = dirname(indexPath);

async function mustExist(path) {
  try {
    await access(path, constants.R_OK);
  } catch {
    console.error(`[tauri-dist] missing required file: ${path}`);
    process.exit(1);
  }
}

await mustExist(indexPath);

const html = await readFile(indexPath, "utf8");
if (!html.includes("</html>")) {
  console.error("[tauri-dist] index.html is incomplete");
  process.exit(1);
}

const assetRefs = [...html.matchAll(/(?:href|src)=["']\.\/(assets\/[^"']+)["']/g)].map((m) => m[1]);
if (assetRefs.length === 0) {
  console.error("[tauri-dist] index.html does not reference embedded assets");
  process.exit(1);
}

for (const ref of assetRefs) {
  await mustExist(resolve(distDir, ref));
}

console.log(`[tauri-dist] verified index.html and ${assetRefs.length} embedded asset refs`);