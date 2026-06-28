import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

const isTauri = Boolean(process.env.TAURI_ENV_PLATFORM || process.env.TAURI_PLATFORM);

const sharedBuild = {
  target: "es2020" as const,
  cssMinify: true as const,
  reportCompressedSize: false,
  chunkSizeWarningLimit: 1500,
  assetsInlineLimit: 4096,
  rollupOptions: {
    output: {
      manualChunks(id: string) {
        if (!id.includes("node_modules")) return;
        if (/[\\/]node_modules[\\/](jspdf|jspdf-autotable|pdf-lib)[\\/]/.test(id)) return "exports-pdf";
        if (/[\\/]node_modules[\\/](xlsx|exceljs)[\\/]/.test(id)) return "exports-xlsx";
        if (/[\\/]node_modules[\\/](docx|html-docx-js)[\\/]/.test(id)) return "exports-docx";
        if (/[\\/]node_modules[\\/](recharts|d3-[^/\\]+)[\\/]/.test(id)) return "charts";
        if (/[\\/]node_modules[\\/]@mlc-ai[\\/]/.test(id)) return "webllm";
        if (/[\\/]node_modules[\\/](tesseract\.js|pdfjs-dist)[\\/]/.test(id)) return "ocr";
      },
    },
  },
};

export default defineConfig({
  base: isTauri ? "./" : "/",
  clearScreen: false,
  envPrefix: ["VITE_", "TAURI_ENV_"],
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    tsconfigPaths(),
  ],
  server: isTauri
    ? {
        port: 1420,
        strictPort: true,
        host: process.env.TAURI_DEV_HOST || "localhost",
        hmr: process.env.TAURI_DEV_HOST
          ? { protocol: "ws", host: process.env.TAURI_DEV_HOST, port: 1421 }
          : undefined,
        watch: { ignored: ["**/src-tauri/**"] },
      }
    : { host: "::", port: 8080 },
  build: {
    ...sharedBuild,
    outDir: isTauri ? "dist/client" : "dist",
    emptyOutDir: true,
  },
});
