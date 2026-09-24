import { defineConfig, type Plugin } from "vite";
import { resolve } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf-8")) as {
  version: string;
};

/**
 * Single authoritative build tag for this invocation. Computed exactly
 * once here, injected into the bundle as __YARDIAN_BUILD_TAG__, and also
 * written to dist/build-info.json for deploy.ps1 to read -- nothing else
 * (including deploy.ps1) recomputes or reformats it, so the browser and
 * the deploy script always report the identical string.
 */
function formatBuildTag(version: string, buildTime: Date): string {
  const compactUtc = buildTime.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `v${version}+${compactUtc}`;
}

const buildTag = formatBuildTag(pkg.version, new Date());

/** Writes dist/build-info.json once the bundle has been emitted. */
function buildInfoPlugin(tag: string): Plugin {
  return {
    name: "yardian-build-info",
    closeBundle() {
      const outFile = resolve(__dirname, "dist/build-info.json");
      writeFileSync(outFile, `${JSON.stringify({ buildTag: tag }, null, 2)}\n`, "utf-8");
    },
  };
}

export default defineConfig({
  define: {
    __YARDIAN_BUILD_TAG__: JSON.stringify(buildTag),
  },
  plugins: [buildInfoPlugin(buildTag)],
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
