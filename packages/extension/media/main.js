// The webview keeps no state of its own beyond the current model, the scroll position and the
// "only open" filter. Every action goes to the extension host, which writes the data and sends a new model.
(function () {
  const vscode = acquireVsCodeApi();
  const toc = document.getElementById("toc");
  const head = document.getElementById("head");
  const doc = document.getElementById("doc");
  const main = document.querySelector("main");
  let model;
  let filterOpen = false;

  const post = (m) => vscode.postMessage(m);
  const el = (tag, attrs = {}, ...children) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "onclick") e.addEventListener("click", v);
      else if (k === "onchange") e.addEventListener("change", v);
      else if (k === "class") e.className = v;
      else if (v !== false && v !== undefined) e.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children) e.append(c);
    return e;
  };
  const line = (node) => Number(node.getAttribute("data-line"));
  const lineEnd = (node) => Number(node.getAttribute("data-line-end"));
  const lined = () => [...doc.querySelectorAll("[data-line]")];

  window.addEventListener("message", (ev) => {
    const m = ev.data;
    if (m.type === "model") render(m.model, m.focus);
    if (m.type === "error") doc.replaceChildren(el("div", { id: "error" }, m.message));
    if (m.type === "comment") startComment();
  });

  function render(next, focus) {
    const scroll = main.scrollTop;
    model = next;
    renderHead();
    renderDoc();
    renderToc();
    if (focus === "first-change") {
      const first = doc.querySelector(".changed-block, .deleted");
      if (first) first.scrollIntoView({ block: "center" });
    } else main.scrollTop = scroll;
  }

  function renderHead() {
    const changedCount = model.sections.filter((s) => s.changed).length;
    const viewedCount = model.sections.filter((s) => s.viewed).length;
    const base = el("select", { onchange: (e) => post({ type: "setBase", revision: Number(e.target.value) }) });
    for (let r = 1; r <= model.revision; r++) base.append(el("option", { value: String(r), selected: r === model.baseRevision }, `revision ${r}`));
    head.replaceChildren(
      el("span", { class: "badge" }, `revision ${model.revision}${model.dirty ? " + unsnapshotted edits" : ""}`),
      el("span", {}, "compare with "),
      base,
      el("button", { class: "secondary", onclick: () => post({ type: "compare" }) }, "Open diff"),
      el("span", {}, `${changedCount} section${changedCount === 1 ? "" : "s"} changed`),
      el("span", {}, `open ${model.counts.open} · answered ${model.counts.answered} · accepted ${model.counts.accepted}`),
      el("label", {}, el("input", { type: "checkbox", checked: filterOpen, onchange: (e) => { filterOpen = e.target.checked; renderDoc(); } }), " only open"),
      el("button", { class: "secondary", onclick: () => startComment(null) }, "Comment on document"),
      ...(model.dirty ? [el("button", { onclick: () => post({ type: "snapshot" }) }, "Snapshot revision")] : []),
      el("button", { class: model.approved ? "" : "secondary", onclick: () => post({ type: "approve", approved: !model.approved }) }, model.approved ? "Approved ✓" : "Approve"),
      ...(model.summary ? [el("div", { class: "summary" }, el("b", {}, "Agent summary: "), model.summary)] : []),
      el("div", { class: "progress" }, el("div", { style: `width:${model.sections.length ? (100 * viewedCount) / model.sections.length : 0}%` })),
    );
  }

  function renderDoc() {
    doc.innerHTML = model.html;
    rewriteImages();
    wrapSections();
    markChanges();
    placeThreads();
  }

  function rewriteImages() {
    for (const img of doc.querySelectorAll("img")) {
      const src = img.getAttribute("src") || "";
      if (/^(https?:|data:)/.test(src)) continue;
      img.src = model.docBase + "/" + src;
    }
  }

  // Each `##` heading and everything up to the next one becomes a card with a viewed toggle.
  function wrapSections() {
    for (const s of model.sections) {
      const h2 = doc.querySelector(`h2[data-line="${s.startLine}"]`);
      if (!h2) continue;
      const card = el("section", { class: `card${s.viewed ? " viewed" : ""}`, "data-section": s.title });
      h2.before(card);
      const bar = el(
        "div",
        { class: "card-bar" },
        el("span", {}, ...(s.changed ? [el("span", { class: `badge${s.changedWithoutThread ? " warn" : ""}` }, s.changedWithoutThread ? "changed without a comment" : "changed")] : [])),
        el(
          "span",
          {},
          el("button", { class: "secondary", onclick: () => post({ type: "compare", line: s.startLine }) }, "Diff"),
          " ",
          el("button", { class: "secondary", onclick: () => post({ type: "openSource", line: s.startLine }) }, "Source"),
          " ",
          el("label", {}, el("input", { type: "checkbox", checked: s.viewed, onchange: (e) => post({ type: "toggleViewed", section: s.title, viewed: e.target.checked }) }), " viewed"),
        ),
      );
      card.append(bar);
      let node = h2;
      while (node && !(node.tagName === "H2" && node !== h2)) {
        const nextNode = node.nextSibling;
        card.append(node);
        node = nextNode;
      }
    }
  }

  function markChanges() {
    const nodes = lined();
    for (const [start, end] of model.changedBlocks) {
      for (const node of nodes) if (line(node) === start && lineEnd(node) === end) node.classList.add("changed-block");
    }
    for (const d of model.deletions) {
      const marker = el("div", { class: "deleted" }, "Text removed here", el("pre", {}, d.text));
      const after = nodes.find((n) => line(n) >= d.beforeLine);
      if (after) after.before(marker);
      else doc.append(marker);
    }
  }

  // The element a thread hangs under: the innermost block covering its first line, else its section, else the document.
  function blockFor(startLine, section) {
    if (startLine !== null) {
      const exact = lined().filter((n) => line(n) <= startLine && lineEnd(n) > startLine).pop();
      if (exact) return exact.closest("li, p, table, pre, blockquote, h1, h2, h3, h4, details, .note") || exact;
    }
    return [...doc.querySelectorAll("section.card")].find((c) => c.getAttribute("data-section") === section) || doc;
  }

  function placeThreads() {
    const general = el("div", { id: "general-threads" });
    doc.prepend(general);
    for (const t of model.threads) {
      if (filterOpen && t.state !== "open") continue;
      const view = threadView(t);
      if (!t.anchor) general.append(view);
      else blockFor(t.lines ? t.lines[0] : null, t.section).after(view);
    }
  }

  function threadView(t) {
    const box = el("div", { class: `thread ${t.state}` });
    if (t.anchor) {
      box.append(el("div", { class: `quote${t.outdated ? " outdated" : ""}` }, t.anchor.quote));
      if (t.outdated) {
        const link = el("a", { href: "#" }, `Open revision ${t.anchor.revision}`);
        link.addEventListener("click", (e) => { e.preventDefault(); post({ type: "openRevision", revision: t.anchor.revision }); });
        box.append(el("div", {}, "The quoted text changed. ", link));
      }
    }
    for (const m of t.messages) {
      const msg = el("div", { class: "msg" }, el("span", { class: "who" }, m.author === "user" ? "You" : "Agent"));
      if (m.verdict) msg.append(el("span", { class: `verdict ${m.verdict}` }, m.verdict));
      msg.append(el("div", { class: "text" }, m.text));
      box.append(msg);
    }
    const actions = el("div", { class: "actions" });
    if (t.state !== "accepted") {
      actions.append(el("button", { onclick: () => post({ type: "accept", id: t.id }) }, "Accept"));
      actions.append(el("button", { class: "secondary", onclick: () => replyTo(t, box, actions) }, "Reply"));
    }
    actions.append(el("span", { class: "badge state" }, t.state));
    box.append(actions);
    return box;
  }

  function replyTo(t, box, actions) {
    if (box.querySelector("textarea")) return;
    const area = el("textarea", { placeholder: "Your reply" });
    const send = el("button", { onclick: () => { if (area.value.trim()) post({ type: "reply", id: t.id, text: area.value.trim() }); } }, "Send");
    box.append(area, el("div", { class: "actions" }, send));
    actions.remove();
    area.focus();
  }

  // A comment on the current selection: the anchor is the innermost block that carries source lines.
  function startComment(anchorOverride) {
    let anchor;
    if (anchorOverride !== null) {
      const sel = window.getSelection();
      const quote = sel ? sel.toString().trim() : "";
      const node = sel && sel.anchorNode ? (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement) : null;
      const block = node ? node.closest("[data-line]") : null;
      if (!quote || !block) {
        showComposer(undefined, "Select some text in the document first; this comment will apply to the whole document.");
        return;
      }
      const card = block.closest("section.card");
      anchor = { startLine: line(block), endLine: lineEnd(block), quote, section: card ? card.getAttribute("data-section") : "" };
    }
    showComposer(anchor);
  }

  function showComposer(anchor, note) {
    const old = document.getElementById("composer");
    if (old) old.remove();
    const area = el("textarea", { placeholder: anchor ? "Comment on the selection" : "Comment on the whole document" });
    const box = el(
      "div",
      { id: "composer" },
      ...(note ? [el("div", {}, note)] : []),
      ...(anchor ? [el("div", { class: "quote" }, anchor.quote)] : []),
      area,
      el(
        "div",
        { class: "actions" },
        el("button", { onclick: () => { if (area.value.trim()) { post({ type: "addThread", text: area.value.trim(), anchor }); box.remove(); } } }, "Save"),
        el("button", { class: "secondary", onclick: () => box.remove() }, "Cancel"),
      ),
    );
    document.body.append(box);
    area.focus();
  }

  function renderToc() {
    toc.replaceChildren();
    for (const h of doc.querySelectorAll("h2, h3")) {
      const s = h.tagName === "H2" ? model.sections.find((x) => x.title === h.textContent) : undefined;
      const a = el("a", { href: "#", class: `${h.tagName.toLowerCase()}${s && s.viewed ? " viewed" : ""}${s && s.changed ? " changed" : ""}` }, h.textContent);
      a.addEventListener("click", (e) => { e.preventDefault(); h.scrollIntoView({ block: "start" }); });
      toc.append(a);
    }
  }

  post({ type: "ready" });
})();
