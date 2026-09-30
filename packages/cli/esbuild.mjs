import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });
await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: "dist/spec-review.mjs",
  banner: { js: "#!/usr/bin/env node" },
  logLevel: "info",
});
// The skill ships the bundle; it is a build product, not a source file.
copyFileSync("dist/spec-review.mjs", "../../skill/spec-review.mjs");
