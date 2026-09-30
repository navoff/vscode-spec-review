import { test } from "node:test";
import assert from "node:assert/strict";
import { relocate } from "../anchor.js";

const base = { revision: 1, section: "S" };

test("relocate finds the quote after lines were inserted above", () => {
  const text = "# T\n\nnew para\n\nthe quick brown\nfox jumps\n";
  assert.deepEqual(relocate({ ...base, startLine: 2, endLine: 4, quote: "quick brown fox" }, text), { startLine: 4, endLine: 6 });
});

test("relocate ignores whitespace differences", () => {
  assert.deepEqual(relocate({ ...base, startLine: 0, endLine: 1, quote: "a  b\nc" }, "x\na b c\n"), { startLine: 1, endLine: 2 });
});

test("relocate picks the occurrence nearest to the original line", () => {
  const text = "same\n\n\n\nsame\n";
  assert.deepEqual(relocate({ ...base, startLine: 3, endLine: 4, quote: "same" }, text), { startLine: 4, endLine: 5 });
});

test("relocate returns undefined when the quote is gone", () => {
  assert.equal(relocate({ ...base, startLine: 0, endLine: 1, quote: "gone" }, "still here\n"), undefined);
});
