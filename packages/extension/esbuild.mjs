import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("dist/skill", { recursive: true });
await build({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile: "dist/extension.cjs",
  external: ["vscode"],
  sourcemap: true,
  logLevel: "info",
});
copyFileSync("../../skill/SKILL.md", "dist/skill/SKILL.md");
copyFileSync("../cli/dist/spec-review.mjs", "dist/skill/spec-review.mjs");
