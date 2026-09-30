import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReviewStore, ensureInitialized, finishRound } from "@spec-review/core";
import { syncViewed } from "../viewed.js";

async function setup(): Promise<{ store: ReviewStore; doc: string }> {
  const root = await mkdtemp(join(tmpdir(), "sr-ext-"));
  await mkdir(join(root, ".git"));
  const doc = join(root, "a.md");
  await writeFile(doc, "# T\n\n## A\n\na1\n\n## B\n\nb1\n");
  const store = await ReviewStore.open(doc);
  await ensureInitialized(store);
  return { store, doc };
}

test("syncViewed drops marks of sections changed since the marks were made", async () => {
  const { store, doc } = await setup();
  await store.writeViewed({ revision: 1, sections: ["A", "B"] });
  await writeFile(doc, "# T\n\n## A\n\na1\n\n## B\n\nb2\n");
  await finishRound(store);
  await writeFile(doc, "# T\n\n## A\n\na1\n\n## B\n\nb3\n");
  await finishRound(store);
  assert.deepEqual(await syncViewed(store), { revision: 3, sections: ["A"] });
  assert.deepEqual(await store.readViewed(), { revision: 3, sections: ["A"] });
});

test("syncViewed starts empty at the current revision", async () => {
  const { store } = await setup();
  assert.deepEqual(await syncViewed(store), { revision: 1, sections: [] });
});
