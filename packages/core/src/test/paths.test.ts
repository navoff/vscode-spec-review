import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findReviewRoot, reviewDir } from "../paths.js";

async function tree(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sr-"));
  await mkdir(join(root, "repo", "docs", "specs"), { recursive: true });
  await writeFile(join(root, "repo", "docs", "specs", "a.md"), "# A\n");
  return root;
}

test("findReviewRoot prefers an existing .spec-review over the repository root", async () => {
  const root = await tree();
  await mkdir(join(root, "repo", ".git"));
  await mkdir(join(root, "repo", "docs", ".spec-review"));
  assert.equal(await findReviewRoot(join(root, "repo", "docs", "specs", "a.md")), join(root, "repo", "docs"));
});

test("findReviewRoot falls back to the .git or .arc root", async () => {
  const root = await tree();
  await mkdir(join(root, "repo", ".arc"));
  assert.equal(await findReviewRoot(join(root, "repo", "docs", "specs", "a.md")), join(root, "repo"));
});

test("findReviewRoot falls back to the document directory", async () => {
  const root = await tree();
  const doc = join(root, "repo", "docs", "specs", "a.md");
  const found = await findReviewRoot(doc);
  // The temporary directory may sit inside someone's repository; the root is then above the document, never below.
  assert.ok(doc.startsWith(found + "/"));
});

test("reviewDir mirrors the document path under .spec-review", () => {
  assert.equal(reviewDir("/r", "/r/docs/specs/a.md"), "/r/.spec-review/docs/specs/a.md");
});
