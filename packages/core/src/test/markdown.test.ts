import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDocument } from "../markdown.js";

const doc = [
  "# Title", // 0
  "", // 1
  "Lead paragraph.", // 2
  "", // 3
  "## First", // 4
  "", // 5
  "- item one", // 6
  "  - nested", // 7
  "- item two", // 8
  "", // 9
  "```ts", // 10
  "const a = 1;", // 11
  "```", // 12
  "", // 13
  "## Second", // 14
  "", // 15
  '{% note warning "Risk" %}', // 16
  "Careful.", // 17
  "{% endnote %}", // 18
  "", // 19
  '{% cut "Details" %}', // 20
  "", // 21
  "| a | b |", // 22
  "|---|---|", // 23
  "| 1 | 2 |", // 24
  "", // 25
  "{% endcut %}", // 26
  "",
].join("\n");

test("parseDocument finds sections by ## headings", () => {
  const { sections } = parseDocument(doc);
  assert.deepEqual(sections, [
    { title: "First", startLine: 4, endLine: 14 },
    { title: "Second", startLine: 14, endLine: 27 },
  ]);
});

test("parseDocument lists top-level blocks, list items and blocks inside cuts and notes", () => {
  const { blocks } = parseDocument(doc);
  assert.deepEqual(
    blocks.map((b) => [b.type, b.startLine, b.endLine, b.section]),
    [
      ["heading", 0, 1, ""],
      ["paragraph", 2, 3, ""],
      ["heading", 4, 5, "First"],
      ["list_item", 6, 8, "First"],
      ["list_item", 8, 10, "First"], // markdown-it extends the last item over the blank line after it
      ["fence", 10, 13, "First"],
      ["heading", 14, 15, "Second"],
      ["note", 16, 17, "Second"],
      ["paragraph", 17, 18, "Second"],
      ["cut", 20, 21, "Second"],
      ["table", 22, 25, "Second"],
    ],
  );
});

test("parseDocument marks blocks with source lines in the HTML", () => {
  const { html } = parseDocument(doc);
  assert.match(html, /<h2 data-line="4" data-line-end="5" data-section="First">First<\/h2>/);
  assert.match(html, /<li data-line="6" data-line-end="8">/);
  assert.match(html, /<code data-line="10" data-line-end="13" class="language-ts">/);
  assert.match(html, /<div data-line="16" data-line-end="17" class="note note-warning"><p class="note-title">Risk<\/p>/);
  assert.match(html, /<p data-line="17" data-line-end="18">Careful.<\/p>\n<\/div>/);
  assert.match(html, /<details data-line="20" data-line-end="21" class="cut"><summary>Details<\/summary>/);
  assert.match(html, /<table data-line="22" data-line-end="25">/);
});

test("alert notes render as important and raw HTML is escaped", () => {
  const { html } = parseDocument("{% note alert %}\n<b>x</b>\n{% endnote %}\n");
  assert.match(html, /class="note note-important"/);
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
});
