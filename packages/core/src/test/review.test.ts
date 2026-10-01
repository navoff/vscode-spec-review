import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReviewStore } from "../store.js";
import {
  OpenThreadsError,
  acceptThread,
  addThread,
  ensureInitialized,
  finishRound,
  replyAsAgent,
  reopenThread,
  replyAsUser,
  resetReview,
  reviewStatus,
  setApproved,
} from "../review.js";

async function setup(): Promise<{ store: ReviewStore; doc: string }> {
  const root = await mkdtemp(join(tmpdir(), "sr-"));
  await mkdir(join(root, ".git"));
  const doc = join(root, "a.md");
  await writeFile(doc, "# A\n\n## S\n\nold text\n");
  const store = await ReviewStore.open(doc);
  return { store, doc };
}

const anchor = { revision: 1, startLine: 4, endLine: 5, quote: "old text", section: "S" };

test("ensureInitialized snapshots revision 1 once", async () => {
  const { store } = await setup();
  const meta = await ensureInitialized(store);
  assert.equal(meta.revision, 1);
  assert.equal(await store.readRevision(1), "# A\n\n## S\n\nold text\n");
  assert.ok(meta.revisions["1"].at);
  assert.equal((await ensureInitialized(store)).revision, 1);
});

test("addThread initializes the review data on first use", async () => {
  const { store } = await setup();
  assert.equal(await store.readMeta(), undefined);
  await addThread(store, "first", anchor);
  assert.equal((await store.readMeta())?.revision, 1);
  assert.equal(await store.readRevision(1), "# A\n\n## S\n\nold text\n");
});

test("a thread goes open -> answered -> open -> answered -> accepted", async () => {
  const { store } = await setup();
  await ensureInitialized(store);
  const t = await addThread(store, "Rename this", anchor);
  assert.equal(t.state, "open");
  assert.equal(t.messages[0].text, "Rename this");
  assert.equal((await replyAsAgent(store, t.id, "fixed", "Renamed")).state, "answered");
  assert.equal((await replyAsUser(store, t.id, "Not enough")).state, "open");
  assert.equal((await replyAsAgent(store, t.id, "question", "Which name?")).state, "answered");
  const done = await acceptThread(store, t.id);
  assert.equal(done.state, "accepted");
  assert.deepEqual(
    done.messages.map((m) => m.author),
    ["user", "agent", "user", "agent"],
  );
  assert.equal(done.messages[1].verdict, "fixed");
});

test("declined without an explanation is refused", async () => {
  const { store } = await setup();
  await ensureInitialized(store);
  const t = await addThread(store, "x", anchor);
  await assert.rejects(replyAsAgent(store, t.id, "declined", "  "), /explanation/);
});

test("finishRound refuses while threads are open and lists them", async () => {
  const { store } = await setup();
  await ensureInitialized(store);
  const t = await addThread(store, "x", anchor);
  await assert.rejects(finishRound(store), (e: unknown) => e instanceof OpenThreadsError && e.ids.includes(t.id));
});

test("finishRound snapshots a changed document and records the summary", async () => {
  const { store, doc } = await setup();
  await ensureInitialized(store);
  const t = await addThread(store, "x", anchor);
  await replyAsAgent(store, t.id, "fixed", "done");
  await writeFile(doc, "# A\n\n## S\n\nnew text\n");
  assert.deepEqual(await finishRound(store, "Also fixed a typo"), { revision: 2, created: true });
  assert.equal(await store.readRevision(2), "# A\n\n## S\n\nnew text\n");
  const meta = await store.readMeta();
  assert.equal(meta?.revision, 2);
  assert.equal(meta?.revisions["2"].summary, "Also fixed a typo");
});

test("finishRound without changes creates no revision", async () => {
  const { store } = await setup();
  await ensureInitialized(store);
  assert.deepEqual(await finishRound(store), { revision: 1, created: false });
});

test("reviewStatus counts threads and detects unsnapshotted edits", async () => {
  const { store, doc } = await setup();
  await ensureInitialized(store);
  const a = await addThread(store, "a", anchor);
  await addThread(store, "b");
  await replyAsAgent(store, a.id, "fixed", "ok");
  await setApproved(store, true);
  assert.deepEqual(await reviewStatus(store), { revision: 1, approved: true, dirty: false, open: 1, answered: 1, accepted: 0 });
  await writeFile(doc, "changed\n");
  assert.equal((await reviewStatus(store)).dirty, true);
});

test("reopenThread puts an accepted thread back to open", async () => {
  const { store } = await setup();
  await ensureInitialized(store);
  const t = await addThread(store, "x", anchor);
  await acceptThread(store, t.id);
  assert.equal((await reopenThread(store, t.id)).state, "open");
});

test("resetReview drops all data and starts again at revision 1", async () => {
  const { store, doc } = await setup();
  await ensureInitialized(store);
  const t = await addThread(store, "x", anchor);
  await replyAsAgent(store, t.id, "fixed", "ok");
  await writeFile(doc, "# A\n\n## S\n\nnewer\n");
  await finishRound(store);
  await store.writeViewed({ revision: 2, sections: ["S"] });
  await resetReview(store);
  assert.equal(await store.readMeta(), undefined);
  assert.deepEqual(await store.listThreads(), []);
  assert.deepEqual(await store.readViewed(), { revision: 0, sections: [] });
});

test("resetReview removes parent directories left empty, up to .spec-review", async () => {
  const root = await mkdtemp(join(tmpdir(), "sr-"));
  await mkdir(join(root, ".git"));
  await mkdir(join(root, "docs", "demo"), { recursive: true });
  const doc = join(root, "docs", "demo", "a.md");
  await writeFile(doc, "# A\n");
  const store = await ReviewStore.open(doc);
  await addThread(store, "x");
  await resetReview(store);
  await assert.rejects(readdir(join(root, ".spec-review")), /ENOENT/);
});

test("resetReview keeps a parent directory that still holds another review", async () => {
  const root = await mkdtemp(join(tmpdir(), "sr-"));
  await mkdir(join(root, ".git"));
  await mkdir(join(root, "docs"));
  await writeFile(join(root, "docs", "a.md"), "# A\n");
  await writeFile(join(root, "docs", "b.md"), "# B\n");
  const a = await ReviewStore.open(join(root, "docs", "a.md"));
  const b = await ReviewStore.open(join(root, "docs", "b.md"));
  await addThread(a, "x");
  await addThread(b, "y");
  await resetReview(a);
  assert.deepEqual(await readdir(join(root, ".spec-review", "docs")), ["b.md"]);
});
