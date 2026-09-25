import { defineConfig } from "vite";
import { resolve } from "node:path";

/**
 * The visible build identifier is not produced here. The bundle keeps the
 * "__YARDIAN_BUILD__" placeholder verbatim; deploy.ps1 injects the real
 * identifier into the copy it writes to Home Assistant (same mechanism as
 * nvr-card's deploy-to-ha.ps1).
 */
export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "src/yardian-card.ts"),
      formats: ["es"],
      fileName: () => "yardian-card.js",
    },
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
  },
});
