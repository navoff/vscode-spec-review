import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CorruptFileError, ReviewStore } from "../store.js";
import type { Thread } from "../types.js";

async function docInRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sr-"));
  await mkdir(join(root, ".git"));
  await mkdir(join(root, "docs"));
  const doc = join(root, "docs", "a.md");
  await writeFile(doc, "# A\n\ntext\n");
  return doc;
}

const thread = (id: string): Thread => ({
  id,
  createdAt: "2026-09-30T10:00:00.000Z",
  state: "open",
  messages: [{ author: "user", at: "2026-09-30T10:00:00.000Z", text: "hi" }],
});

test("open resolves the data directory next to the repository root", async () => {
  const doc = await docInRepo();
  const store = await ReviewStore.open(doc);
  assert.equal(store.dir, join(doc, "..", "..", ".spec-review", "docs", "a.md"));
});

test("meta is undefined before the first write and round-trips after", async () => {
  const store = await ReviewStore.open(await docInRepo());
  assert.equal(await store.readMeta(), undefined);
  const meta = { docPath: store.docPath, revision: 1, approved: false, revisions: { "1": { at: "2026-09-30T10:00:00.000Z" } } };
  await store.writeMeta(meta);
  assert.deepEqual(await store.readMeta(), meta);
});

test("threads are listed oldest first and written without leftovers", async () => {
  const store = await ReviewStore.open(await docInRepo());
  await store.writeThread({ ...thread("b"), createdAt: "2026-09-30T11:00:00.000Z" });
  await store.writeThread(thread("a"));
  assert.deepEqual((await store.listThreads()).map((t) => t.id), ["a", "b"]);
  assert.deepEqual((await readdir(join(store.dir, "threads"))).sort(), ["a.json", "b.json"]);
});

test("revisions and viewed marks round-trip", async () => {
  const store = await ReviewStore.open(await docInRepo());
  await store.writeRevision(1, "# A\n");
  assert.equal(await store.readRevision(1), "# A\n");
  assert.equal(store.revisionFile(12), join(store.dir, "revisions", "0012.md"));
  assert.deepEqual(await store.readViewed(), { revision: 0, sections: [] });
  await store.writeViewed({ revision: 1, sections: ["Scope"] });
  assert.deepEqual(await store.readViewed(), { revision: 1, sections: ["Scope"] });
});

test("a corrupt file is reported with its path and never overwritten", async () => {
  const store = await ReviewStore.open(await docInRepo());
  await mkdir(store.dir, { recursive: true });
  await writeFile(join(store.dir, "meta.json"), "{not json");
  await assert.rejects(store.readMeta(), (e: unknown) => e instanceof CorruptFileError && e.file.endsWith("meta.json"));
  await assert.rejects(store.writeMeta({ docPath: store.docPath, revision: 1, approved: false, revisions: {} }), CorruptFileError);
});

test("readDocument returns the current text of the document", async () => {
  const store = await ReviewStore.open(await docInRepo());
  assert.equal(await store.readDocument(), "# A\n\ntext\n");
});
