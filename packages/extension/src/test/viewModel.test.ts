import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReviewStore, addThread, ensureInitialized, finishRound, replyAsAgent } from "@spec-review/core";
import { buildViewModel } from "../viewModel.js";

async function setup(): Promise<{ store: ReviewStore; doc: string }> {
  const root = await mkdtemp(join(tmpdir(), "sr-ext-"));
  await mkdir(join(root, ".git"));
  const doc = join(root, "a.md");
  await writeFile(doc, "# T\n\n## A\n\na one\n\n## B\n\nb one\n");
  const store = await ReviewStore.open(doc);
  await ensureInitialized(store);
  return { store, doc };
}

test("a fresh document has no changes and counts nothing", async () => {
  const { store } = await setup();
  const vm = await buildViewModel(store);
  assert.equal(vm.revision, 1);
  assert.equal(vm.baseRevision, 1);
  assert.equal(vm.dirty, false);
  assert.deepEqual(vm.changedBlocks, []);
  assert.deepEqual(
    vm.sections.map((s) => [s.title, s.viewed, s.changed]),
    [
      ["A", false, false],
      ["B", false, false],
    ],
  );
  assert.match(vm.html, /<h2 data-line="2"/);
});

test("after a round the model shows changed sections, relocated threads and summary", async () => {
  const { store, doc } = await setup();
  const t = await addThread(store, "fix a", { revision: 1, startLine: 4, endLine: 5, quote: "a one", section: "A" });
  await replyAsAgent(store, t.id, "fixed", "done");
  await writeFile(doc, "# T\n\nlead\n\n## A\n\na one\n\n## B\n\nb two\n");
  await finishRound(store, "Touched B too");
  const vm = await buildViewModel(store);
  assert.equal(vm.baseRevision, 1);
  assert.equal(vm.summary, "Touched B too");
  assert.deepEqual(
    vm.sections.map((s) => [s.title, s.changed, s.changedWithoutThread]),
    [
      ["A", false, false],
      ["B", true, true],
    ],
  );
  assert.deepEqual(vm.threads[0].lines, [6, 7]);
  assert.equal(vm.threads[0].outdated, false);
  assert.deepEqual(vm.changedBlocks, [
    [2, 3],
    [10, 11],
  ]);
  assert.deepEqual(vm.counts, { open: 0, answered: 1, accepted: 0 });
});

test("unsnapshotted edits compare against the latest revision and mark the model dirty", async () => {
  const { store, doc } = await setup();
  await writeFile(doc, "# T\n\n## A\n\na changed\n\n## B\n\nb one\n");
  const vm = await buildViewModel(store);
  assert.equal(vm.dirty, true);
  assert.equal(vm.baseRevision, 1);
  assert.deepEqual(
    vm.sections.filter((s) => s.changed).map((s) => s.title),
    ["A"],
  );
});

test("a thread whose quote is gone is outdated but keeps its section", async () => {
  const { store, doc } = await setup();
  const t = await addThread(store, "x", { revision: 1, startLine: 4, endLine: 5, quote: "a one", section: "A" });
  await replyAsAgent(store, t.id, "fixed", "rewritten");
  await writeFile(doc, "# T\n\n## A\n\nsomething else\n\n## B\n\nb one\n");
  await finishRound(store);
  const vm = await buildViewModel(store);
  assert.equal(vm.threads[0].outdated, true);
  assert.equal(vm.threads[0].lines, null);
  assert.equal(vm.threads[0].section, "A");
});
