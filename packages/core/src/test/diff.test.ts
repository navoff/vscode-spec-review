import { test } from "node:test";
import assert from "node:assert/strict";
import { changedBlocks, changedSections, deletionsBetweenBlocks, diffRevisions } from "../diff.js";
import { parseDocument } from "../markdown.js";

const oldText = "# T\n\n## A\n\none\n\ntwo\n\n## B\n\nthree\n";
const newText = "# T\n\n## A\n\none changed\n\n## B\n\nthree\n\nfour\n";

test("diffRevisions reports ranges in the new text with the removed lines", () => {
  assert.deepEqual(diffRevisions(oldText, newText), [
    { start: 4, end: 5, removed: "one\n" },
    { start: 6, end: 6, removed: "two\n\n" },
    { start: 9, end: 11, removed: "" },
  ]);
});

test("changedBlocks and changedSections map changes onto the new document", () => {
  const { blocks, sections } = parseDocument(newText);
  const changes = diffRevisions(oldText, newText);
  assert.deepEqual(
    changedBlocks(blocks, changes).map((i) => blocks[i].startLine),
    [4, 10],
  );
  assert.deepEqual(changedSections(sections, changes), ["A", "B"]);
  assert.deepEqual(deletionsBetweenBlocks(blocks, changes), [{ beforeLine: 6, text: "two\n\n" }]);
});

test("identical texts have no changes", () => {
  assert.deepEqual(diffRevisions(oldText, oldText), []);
});
