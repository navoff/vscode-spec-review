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
  assert.ok(cards[1].querySelector(".status.changed")?.textContent?.includes("without a comment"));
  assert.ok(!cards[0].classList.contains("collapsed"), "a viewed section stays open");
  assert.equal(cards[0].querySelector("a.action")?.textContent, "Unmark");
  assert.ok(cards[1].querySelector('p[data-line="12"]')?.classList.contains("changed-block"));
  assert.match(d.querySelector(".deleted")?.textContent ?? "", /gone/);
  assert.deepEqual(
    [...d.querySelectorAll("#toc a .title")].map((a) => a.textContent),
    ["A", "B"],
  );
  assert.ok(d.querySelector('#toc a:nth-child(2) .dot'), "changed section B gets a dot");
  assert.match(d.getElementById("head")?.textContent ?? "", /revision 2 \(latest\)/);
  assert.doesNotMatch(d.getElementById("head")?.textContent ?? "", /Open diff|sections changed|answered/);
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
        thread("t4", { revision: 1, startLine: 4, endLine: 5, quote: "A", section: "A" }, [4, 5]),
        thread("t1", { revision: 1, startLine: 6, endLine: 7, quote: "a one", section: "A" }, [6, 7]),
        thread("t2", { revision: 1, startLine: 6, endLine: 7, quote: "vanished", section: "B" }, null, true),
        thread("t3", undefined, null),
      ],
    }),
  );
  const d = dom.window.document;
  assert.equal(d.querySelector('p[data-line="6"]')?.nextElementSibling?.textContent?.includes("text t1"), true);
  const cardA = d.querySelector('section.card[data-section="A"]');
  assert.equal(cardA?.querySelector(".card-bar .thread"), null, "a thread on the heading must not land in the header row");
  assert.equal(cardA?.querySelector(".card-body")?.firstElementChild?.textContent?.includes("text t4"), true);
  const cardB = d.querySelector('section.card[data-section="B"]');
  const inCardB = cardB?.querySelector(".card-body")?.firstElementChild;
  assert.equal(inCardB?.textContent?.includes("text t2"), true);
  assert.ok(inCardB?.querySelector(".quote.outdated"));
  assert.equal(d.getElementById("general-threads")?.textContent?.includes("text t3"), true);
  assert.deepEqual(
    [...d.querySelectorAll("#toc a")].map((a) => a.querySelector(".count")?.textContent ?? ""),
    ["2", "1"],
  );
});

test("section Diff buttons are hidden while only the first revision exists", () => {
  const { dom } = page(model({ revision: 1, baseRevision: 1 }));
  const labels = [...dom.window.document.querySelectorAll("section.card button")].map((b) => b.textContent);
  assert.deepEqual(labels, []);
  const actions = [...dom.window.document.querySelectorAll('section.card[data-section="B"] a.action')].map((a) => a.textContent);
  assert.deepEqual(actions, ["Mark viewed", "Source"]);
});

test("buttons post the expected messages", () => {
  const { dom, posted } = page(model());
  const d = dom.window.document;
  posted.length = 0;
  const actions = [...d.querySelectorAll('section.card[data-section="B"] a.action')] as HTMLElement[];
  assert.deepEqual(actions.map((a) => a.textContent), ["Mark viewed", "Diff", "Source"]);
  actions[0].click();
  actions[1].click();
  assert.deepEqual(JSON.parse(JSON.stringify(posted)), [
    { type: "toggleViewed", section: "B", viewed: true },
    { type: "compare", line: 10 },
  ]);
});

test("a table of contents link scrolls to the heading looked up at click time", () => {
  const { dom } = page(model());
  const w = dom.window;
  const main = w.document.querySelector("main") as HTMLElement;
  let scrolledTo: number | undefined;
  (main as unknown as { scrollTo: (o: { top: number }) => void }).scrollTo = (o) => {
    scrolledTo = o.top;
  };
  // jsdom has no layout: place the B card 500px below the top of main.
  const cardB = w.document.querySelector('section.card[data-section="B"]') as HTMLElement;
  cardB.getBoundingClientRect = () => ({ top: 500 }) as DOMRect;
  main.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
  // Re-render first so a stale element reference would miss the live heading.
  w.dispatchEvent(new w.MessageEvent("message", { data: { type: "model", model: model() } }));
  const newCardB = w.document.querySelector('section.card[data-section="B"]') as HTMLElement;
  newCardB.getBoundingClientRect = () => ({ top: 500 }) as DOMRect;
  ([...w.document.querySelectorAll("#toc a")].find((a) => a.querySelector(".title")?.textContent === "B") as HTMLElement).click();
  assert.equal(scrolledTo, 500 - 8);
});

test("the comment form opens under the selected block and survives a re-render with its draft", () => {
  const { dom } = page(model());
  const w = dom.window;
  const d = w.document;
  const p6 = d.querySelector('p[data-line="6"]') as HTMLElement;
  // jsdom has no real selection API over layout; fake what startComment reads.
  const fakeSelection = { toString: () => "a one", anchorNode: p6.firstChild } as unknown as Selection;
  w.getSelection = () => fakeSelection;
  w.dispatchEvent(new w.MessageEvent("message", { data: { type: "comment" } }));
  const composer = d.getElementById("composer") as HTMLElement;
  assert.equal(p6.nextElementSibling, composer);
  const area = composer.querySelector("textarea") as HTMLTextAreaElement;
  area.value = "draft text";
  area.dispatchEvent(new w.Event("input"));
  w.dispatchEvent(new w.MessageEvent("message", { data: { type: "model", model: model() } }));
  const again = d.getElementById("composer") as HTMLElement;
  assert.equal(d.querySelector('p[data-line="6"]')?.nextElementSibling, again);
  assert.equal((again.querySelector("textarea") as HTMLTextAreaElement).value, "draft text");
});

test("Ctrl+Enter saves the comment form and Escape closes it", () => {
  const { dom, posted } = page(model());
  const w = dom.window;
  const d = w.document;
  const p6 = d.querySelector('p[data-line="6"]') as HTMLElement;
  w.getSelection = () => ({ toString: () => "a one", anchorNode: p6.firstChild }) as unknown as Selection;
  w.dispatchEvent(new w.MessageEvent("message", { data: { type: "comment" } }));
  let area = d.querySelector("#composer textarea") as HTMLTextAreaElement;
  area.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape" }));
  assert.equal(d.getElementById("composer"), null);
  w.dispatchEvent(new w.MessageEvent("message", { data: { type: "comment" } }));
  area = d.querySelector("#composer textarea") as HTMLTextAreaElement;
  area.value = "shorter";
  posted.length = 0;
  area.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }));
  assert.equal(d.getElementById("composer"), null);
  assert.deepEqual(JSON.parse(JSON.stringify(posted)), [{ type: "addThread", text: "shorter", anchor: { startLine: 6, endLine: 7, quote: "a one", section: "A" } }]);
});

test("accepted threads are collapsed and a click on the bar unfolds them", () => {
  const thread = {
    id: "t9",
    createdAt: "2026-09-30T10:00:00.000Z",
    state: "accepted" as const,
    anchor: { revision: 1, startLine: 6, endLine: 7, quote: "a one", section: "A" },
    lines: [6, 7] as [number, number],
    outdated: false,
    section: "A",
    messages: [{ author: "user" as const, at: "2026-09-30T10:00:00.000Z", text: "first message" }],
  };
  const { dom } = page(model({ threads: [thread] }));
  const d = dom.window.document;
  let box = d.querySelector(".thread") as HTMLElement;
  assert.ok(box.classList.contains("collapsed"));
  assert.equal(box.querySelector(".thread-body"), null);
  assert.match(box.querySelector(".snippet")?.textContent ?? "", /first message/);
  assert.equal(box.querySelector(".status")?.textContent, "Resolved issue");
  assert.equal(box.querySelector("a.action")?.textContent, "Reopen");
  (box.querySelector(".chevron") as HTMLElement).click();
  box = d.querySelector(".thread") as HTMLElement;
  assert.ok(!box.classList.contains("collapsed"));
  assert.match(box.querySelector(".thread-body .text")?.textContent ?? "", /first message/);
});

test("a viewed section shows no Changed pill or dot", () => {
  const { dom } = page(model({ sections: model().sections.map((s) => ({ ...s, viewed: true })) }));
  const d = dom.window.document;
  assert.equal(d.querySelector("section.card .status.changed"), null);
  assert.equal(d.querySelector("#toc .dot"), null);
});

test("h3 entries in the table of contents inherit the viewed mark of their section", () => {
  const parsed = parseDocument("# T\n\n## A\n\n### A sub\n\ntext\n\n## B\n\n### B sub\n\ntext\n");
  const { dom } = page(
    model({
      html: parsed.html,
      sections: parsed.sections.map((s) => ({ ...s, viewed: s.title === "A", changed: false, changedWithoutThread: false })),
      changedBlocks: [],
      deletions: [],
    }),
  );
  const rows = [...dom.window.document.querySelectorAll("#toc a")].map((a) => [a.querySelector(".title")?.textContent, a.classList.contains("viewed")]);
  assert.deepEqual(rows, [
    ["A", true],
    ["A sub", true],
    ["B", false],
    ["B sub", false],
  ]);
});

test("Finish review is hidden on a fresh document and warns while something is left", () => {
  const finish = (dom: JSDOM) => [...dom.window.document.querySelectorAll("#head button")].find((b) => b.textContent?.includes("Finish review")) as HTMLButtonElement | undefined;
  assert.equal(finish(page(model({ revision: 1, baseRevision: 1, threads: [] })).dom), undefined);
  const openThread = {
    id: "o1",
    createdAt: "2026-09-30T10:00:00.000Z",
    state: "open" as const,
    lines: null,
    outdated: false,
    section: "",
    messages: [{ author: "user" as const, at: "2026-09-30T10:00:00.000Z", text: "x" }],
  };
  const allViewed = model().sections.map((s) => ({ ...s, viewed: true }));
  const withIssue = finish(page(model({ threads: [openThread], counts: { open: 1, answered: 0, accepted: 0 }, sections: allViewed })).dom);
  assert.equal(withIssue?.disabled, false);
  assert.ok(withIssue?.querySelector(".mark"), "a warning mark while an issue is unresolved");
  assert.match(withIssue?.title ?? "", /1 unresolved issue left/);
  const unviewed = finish(page(model({ revision: 2 })).dom);
  assert.ok(unviewed?.querySelector(".mark"), "a warning mark while a section is not viewed");
  assert.match(unviewed?.title ?? "", /1 section not viewed/);
  const clean = finish(page(model({ revision: 2, sections: allViewed })).dom);
  assert.equal(clean?.querySelector(".mark"), null);
});
