import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { parseDocument } from "@spec-review/core";
import type { ViewModel } from "../viewModel.js";

const script = readFileSync(new URL("../../media/main.js", import.meta.url), "utf8");

const source = "# T\n\nlead\n\n## A\n\na one\n\n- item\n\n## B\n\nb two\n";

function model(extra: Partial<ViewModel> = {}): ViewModel & { docBase: string } {
  const parsed = parseDocument(source);
  return {
    docPath: "/x/a.md",
    docBase: "vscode-resource://x",
    revision: 2,
    baseRevision: 1,
    approved: false,
    dirty: false,
    html: parsed.html,
    sections: parsed.sections.map((s) => ({ ...s, viewed: s.title === "A", changed: s.title === "B", changedWithoutThread: s.title === "B" })),
    threads: [],
    changedBlocks: [[12, 13]],
    deletions: [{ beforeLine: 8, text: "gone\n" }],
    counts: { open: 0, answered: 0, accepted: 0 },
    ...extra,
  };
}

/** Load main.js into a page the way the panel does and hand it a model. */
function page(vm: ViewModel & { docBase: string }): { dom: JSDOM; posted: unknown[] } {
  const posted: unknown[] = [];
  const dom = new JSDOM('<body><nav id="toc"></nav><main><header id="head"></header><article id="doc"></article></main></body>', { runScripts: "outside-only" });
  const win = dom.window as unknown as Record<string, unknown>;
  win.acquireVsCodeApi = () => ({ postMessage: (m: unknown) => posted.push(m) });
  dom.window.eval(script);
  dom.window.dispatchEvent(new dom.window.MessageEvent("message", { data: { type: "model", model: vm } }));
  return { dom, posted };
}

test("the webview asks for the model, wraps sections into cards and marks changes", () => {
  const { dom, posted } = page(model());
  assert.deepEqual(JSON.parse(JSON.stringify(posted)), [{ type: "ready" }]);
  const d = dom.window.document;
  const cards = [...d.querySelectorAll("section.card")];
  assert.deepEqual(
    cards.map((c) => c.getAttribute("data-section")),
    ["A", "B"],
  );
  assert.ok(cards[0].classList.contains("viewed"));
  assert.ok(cards[1].querySelector(".badge.warn")?.textContent?.includes("without a comment"));
  assert.ok(cards[1].querySelector('p[data-line="12"]')?.classList.contains("changed-block"));
  assert.match(d.querySelector(".deleted")?.textContent ?? "", /gone/);
  assert.deepEqual(
    [...d.querySelectorAll("#toc a")].map((a) => a.textContent),
    ["A", "B"],
  );
  assert.match(d.getElementById("head")?.textContent ?? "", /revision 2/);
});

test("threads hang under their block, outdated ones under their section, general ones on top", () => {
  const thread = (id: string, anchor: ViewModel["threads"][0]["anchor"], lines: [number, number] | null, outdated = false) => ({
    id,
    createdAt: "2026-09-30T10:00:00.000Z",
    state: "open" as const,
    anchor,
    lines,
    outdated,
    section: anchor?.section ?? "",
    messages: [{ author: "user" as const, at: "2026-09-30T10:00:00.000Z", text: `text ${id}` }],
  });
  const { dom } = page(
    model({
      threads: [
        thread("t1", { revision: 1, startLine: 6, endLine: 7, quote: "a one", section: "A" }, [6, 7]),
        thread("t2", { revision: 1, startLine: 6, endLine: 7, quote: "vanished", section: "B" }, null, true),
        thread("t3", undefined, null),
      ],
    }),
  );
  const d = dom.window.document;
  assert.equal(d.querySelector('p[data-line="6"]')?.nextElementSibling?.textContent?.includes("text t1"), true);
  const cardB = d.querySelector('section.card[data-section="B"]');
  assert.equal(cardB?.nextElementSibling?.textContent?.includes("text t2"), true);
  assert.ok(cardB?.nextElementSibling?.querySelector(".quote.outdated"));
  assert.equal(d.getElementById("general-threads")?.textContent?.includes("text t3"), true);
});

test("buttons post the expected messages", () => {
  const { dom, posted } = page(model());
  const d = dom.window.document;
  posted.length = 0;
  const viewedBox = d.querySelector('section.card[data-section="B"] input[type=checkbox]') as HTMLInputElement;
  viewedBox.checked = true;
  viewedBox.dispatchEvent(new dom.window.Event("change"));
  (d.querySelector('section.card[data-section="B"] button') as HTMLButtonElement).click();
  assert.deepEqual(JSON.parse(JSON.stringify(posted)), [
    { type: "toggleViewed", section: "B", viewed: true },
    { type: "compare", line: 10 },
  ]);
});
