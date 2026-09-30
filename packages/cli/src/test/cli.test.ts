import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReviewStore, addThread, ensureInitialized } from "@spec-review/core";

const run = promisify(execFile);
const CLI = new URL("../../dist/spec-review.mjs", import.meta.url).pathname;

interface Failure {
  code: number;
  stderr: string;
}

async function setup(): Promise<{ doc: string; store: ReviewStore }> {
  const root = await mkdtemp(join(tmpdir(), "sr-cli-"));
  await mkdir(join(root, ".git"));
  const doc = join(root, "spec.md");
  await writeFile(doc, "# Spec\n\n## Scope\n\nold sentence here\n");
  const store = await ReviewStore.open(doc);
  await ensureInitialized(store);
  return { doc, store };
}

test("list, reply, finish and status form one round", async () => {
  const { doc, store } = await setup();
  const t = await addThread(store, "Say new instead of old", { revision: 1, startLine: 4, endLine: 5, quote: "old sentence", section: "Scope" });

  const listed = JSON.parse((await run("node", [CLI, "list", doc])).stdout);
  assert.equal(listed.revision, 1);
  assert.deepEqual(
    listed.threads.map((x: { id: string; section: string; lines: number[]; outdated: boolean }) => [x.id, x.section, x.lines, x.outdated]),
    [[t.id, "Scope", [4, 5], false]],
  );

  const finishEarly = (await run("node", [CLI, "finish", doc]).catch((e: Failure) => e)) as Failure;
  assert.equal(finishEarly.code, 2);
  assert.match(finishEarly.stderr, new RegExp(t.id));

  await run("node", [CLI, "reply", doc, t.id, "--verdict", "fixed", "--message", "Replaced"]);
  await writeFile(doc, "# Spec\n\n## Scope\n\nnew sentence here\n");
  assert.match((await run("node", [CLI, "finish", doc, "--summary", "Also fixed the title"])).stdout, /revision 2 created/);

  const status = JSON.parse((await run("node", [CLI, "status", doc])).stdout);
  assert.deepEqual(status, { revision: 2, approved: false, dirty: false, open: 0, answered: 1, accepted: 0 });
  assert.equal(JSON.parse((await run("node", [CLI, "list", doc])).stdout).threads.length, 0);
});

test("declined without a message and unknown commands fail with exit code 1", async () => {
  const { doc, store } = await setup();
  const t = await addThread(store, "x");
  const declined = (await run("node", [CLI, "reply", doc, t.id, "--verdict", "declined"]).catch((e: Failure) => e)) as Failure;
  assert.equal(declined.code, 1);
  assert.match(declined.stderr, /explanation/);
  const unknown = (await run("node", [CLI, "frobnicate", doc]).catch((e: Failure) => e)) as Failure;
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /Usage/);
});

test("a corrupt data file names the file and exits with 1", async () => {
  const { doc, store } = await setup();
  await writeFile(store.metaFile, "{oops");
  const r = (await run("node", [CLI, "status", doc]).catch((e: Failure) => e)) as Failure;
  assert.equal(r.code, 1);
  assert.match(r.stderr, /meta\.json/);
});
