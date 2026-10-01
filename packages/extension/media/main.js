// The webview keeps no state of its own beyond the current model, the scroll position and the
// set of collapsed threads. Every action goes to the extension host, which writes the data and sends a new model.
(function () {
  const vscode = acquireVsCodeApi();
  const toc = document.getElementById("toc");
  const head = document.getElementById("head");
  const doc = document.getElementById("doc");
  const main = document.querySelector("main");
  let model;
  // Thread ids whose collapsed state the user changed by hand; others follow the default (accepted = collapsed).
  const collapsedOverride = new Map();

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
    if (m.type === "model") {
      if (m.reset) {
        collapsedOverride.clear();
        sectionOverride.clear();
        draft = undefined;
        main.scrollTop = 0;
      }
      render(m.model, m.reset ? "top" : m.focus);
    }
    if (m.type === "error") doc.replaceChildren(el("div", { id: "error" }, m.message));
    if (m.type === "comment") startComment();
    if (m.type === "flash") flash(m.text);
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
    } else if (focus === "top") main.scrollTop = 0;
    else main.scrollTop = scroll;
  }

  function renderHead() {
    const viewedCount = model.sections.filter((s) => s.viewed).length;
    // The document shown is always the current text; the select only picks which revision the changes are counted from.
    const base = el("select", { onchange: (e) => post({ type: "setBase", revision: Number(e.target.value) }) });
    for (let r = 1; r <= model.revision; r++) {
      if (r === model.revision && !model.dirty) continue;
      base.append(el("option", { value: String(r), selected: r === model.baseRevision }, `revision ${r}`));
    }
    const current = model.dirty ? `revision ${model.revision} + unsnapshotted edits` : `revision ${model.revision} (latest)`;
    head.replaceChildren(
      el("span", { class: "badge" }, current),
      ...(base.options.length > 0 ? [el("span", {}, "changes since "), base] : []),
      ...(model.dirty ? [el("button", { onclick: () => post({ type: "snapshot" }) }, "Snapshot revision")] : []),
      el("button", { class: "pill neutral", title: "Copy a prompt for the agent to the clipboard", onclick: () => post({ type: "copyPrompt" }) }, sendIcon(), "Send to agent"),
      ...finishButton(),
      el("div", { class: "progress" }, el("div", { style: `width:${model.sections.length ? (100 * viewedCount) / model.sections.length : 0}%` })),
    );
  }

  // Finish review appears once the review has any history and is greyed out while issues are still open.
  function finishButton() {
    const started = model.revision > 1 || model.threads.length > 0;
    if (!started) return [];
    // Finishing needs every thread resolved and every section viewed.
    const unresolved = model.counts.open + model.counts.answered;
    const unviewed = model.sections.filter((s) => !s.viewed).length;
    const blocked = unresolved > 0 || unviewed > 0;
    const reasons = [];
    if (unresolved > 0) reasons.push(`${unresolved} unresolved issue${unresolved === 1 ? "" : "s"}`);
    if (unviewed > 0) reasons.push(`${unviewed} section${unviewed === 1 ? "" : "s"} not viewed`);
    const title = blocked ? `${reasons.join(", ")} left` : "Delete all revisions and threads and start over from the current text";
    return [el("button", { class: "pill finish", disabled: blocked, title, onclick: () => post({ type: "finishReview" }) }, thumbIcon(), "Finish review")];
  }

  function renderDoc() {
    doc.innerHTML = model.html;
    rewriteImages();
    wrapSections();
    markChanges();
    placeThreads();
    if (draft) showComposer(draft.anchor, draft.text);
  }

  function rewriteImages() {
    for (const img of doc.querySelectorAll("img")) {
      const src = img.getAttribute("src") || "";
      if (/^(https?:|data:)/.test(src)) continue;
      img.src = model.docBase + "/" + src;
    }
  }

  // Each `##` heading and everything up to the next one becomes a card with a viewed toggle.
  // Section cards the user folded by hand; everything else stays open, viewed or not.
  const sectionOverride = new Map();
  const sectionCollapsed = (s) => sectionOverride.get(s.title) === true;

  // Each `##` heading and everything up to the next one becomes a card, laid out like a reviewed file:
  // a header row with the title, status pills, text actions and a chevron that folds the card to that row.
  function wrapSections() {
    for (const s of model.sections) {
      const h2 = doc.querySelector(`h2[data-line="${s.startLine}"]`);
      if (!h2) continue;
      const collapsed = sectionCollapsed(s);
      const card = el("section", { class: `card${s.viewed ? " viewed" : ""}${collapsed ? " collapsed" : ""}`, "data-section": s.title });
      h2.before(card);
      const link = (label, onclick) => {
        const a = el("a", { href: "#", class: "action" }, label);
        a.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); onclick(); });
        return a;
      };
      const toggle = () => {
        sectionOverride.set(s.title, !sectionCollapsed(s));
        renderDoc();
      };
      const chevron = el("a", { href: "#", class: "chevron", title: collapsed ? "Expand" : "Collapse" }, collapsed ? "⌄" : "⌃");
      chevron.addEventListener("click", (e) => { e.preventDefault(); toggle(); });
      const bar = el(
        "div",
        { class: "card-bar" },
        h2,
        // Viewed means the reviewer has seen this version of the section, so the Changed pill goes away with the mark.
        ...(s.changed && !s.viewed ? [el("span", { class: "status changed" }, s.changedWithoutThread ? "Changed without a comment" : "Changed")] : []),
        ...(s.viewed ? [el("span", { class: "status resolved" }, "Viewed")] : []),
        link(s.viewed ? "Unmark" : "Mark viewed", () => { sectionOverride.delete(s.title); post({ type: "toggleViewed", section: s.title, viewed: !s.viewed }); }),
        // Nothing to compare with while there is only the first revision and no edits since.
        ...(model.revision > 1 || model.dirty ? [link("Diff", () => post({ type: "compare", line: s.startLine }))] : []),
        link("Source", () => post({ type: "openSource", line: s.startLine })),
        chevron,
      );
      bar.addEventListener("click", (e) => { if (e.target === bar) toggle(); });
      card.append(bar);
      const body = el("div", { class: "card-body" });
      let node = card.nextSibling;
      while (node && !(node.nodeType === 1 && node.tagName === "H2")) {
        const nextNode = node.nextSibling;
        body.append(node);
        node = nextNode;
      }
      card.append(body);
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

  // Put a thread or a form under its block. A block that is the section heading lives in the card
  // header, so the node goes to the top of the card body instead; a lost block falls back to the same place.
  function attach(host, node) {
    if (host === doc) {
      document.getElementById("general-threads").append(node);
      return;
    }
    const card = host.classList && host.classList.contains("card") ? host : host.closest(".card-bar") ? host.closest("section.card") : null;
    if (card) card.querySelector(".card-body").prepend(node);
    else host.after(node);
  }

  function placeThreads() {
    const general = el("div", { id: "general-threads" });
    doc.prepend(general);
    // The agent's note about the latest round sits above the document, in the card style, not in the header.
    if (model.summary && model.revision > 1) {
      doc.prepend(
        el(
          "div",
          { class: "thread summary" },
          el("div", { class: "thread-bar" }, avatar("agent"), el("span", { class: "who" }, "Agent"), el("span", { class: "when" }, `revision ${model.revision}`)),
          el("div", { class: "thread-body" }, el("div", { class: "text" }, model.summary)),
        ),
      );
    }
    for (const t of model.threads) {
      const view = threadView(t);
      if (!t.anchor) general.append(view);
      else attach(blockFor(t.lines ? t.lines[0] : null, t.section), view);
    }
  }

  function isCollapsed(t) {
    return collapsedOverride.has(t.id) ? collapsedOverride.get(t.id) : t.state === "accepted";
  }

  const WHO = { user: "You", agent: "Agent" };
  const avatar = (author) => el("span", { class: `avatar ${author}` }, author === "user" ? "Y" : "A");

  // The status pill in the thread header, as in a pull request review: what the thread waits for now.
  function statusOf(t) {
    if (t.state === "accepted") return { label: "Resolved issue", cls: "resolved" };
    if (t.state === "answered") {
      const last = [...t.messages].reverse().find((m) => m.author === "agent");
      const verdict = last && last.verdict ? last.verdict : "answered";
      return { label: { fixed: "Fixed", declined: "Declined", question: "Question" }[verdict] || "Answered", cls: verdict };
    }
    return { label: "Opened issue", cls: "open" };
  }

  function message(m, extra) {
    const head = el("div", { class: "msg-head" }, avatar(m.author), el("span", { class: "who" }, WHO[m.author]));
    if (extra) head.append(...extra);
    if (m.verdict) head.append(el("span", { class: `verdict ${m.verdict}` }, m.verdict));
    return el("div", { class: `msg ${m.author}` }, head, el("div", { class: "text" }, m.text));
  }

  function threadView(t) {
    const collapsed = isCollapsed(t);
    const box = el("div", { class: `thread ${t.state}${collapsed ? " collapsed" : ""}` });
    const status = statusOf(t);
    const [first, ...replies] = t.messages;
    const toggle = () => {
      collapsedOverride.set(t.id, !isCollapsed(t));
      box.replaceWith(threadView(t));
    };
    const action =
      t.state === "accepted"
        ? el("a", { href: "#", class: "action" }, "Reopen")
        : el("a", { href: "#", class: "action" }, "Resolve");
    action.addEventListener("click", (e) => {
      e.preventDefault();
      collapsedOverride.delete(t.id);
      post(t.state === "accepted" ? { type: "reopen", id: t.id } : { type: "accept", id: t.id });
    });
    const chevron = el("a", { href: "#", class: "chevron", title: collapsed ? "Expand" : "Collapse" }, collapsed ? "⌄" : "⌃");
    chevron.addEventListener("click", (e) => { e.preventDefault(); toggle(); });
    const bar = el(
      "div",
      { class: "thread-bar" },
      avatar(first.author),
      el("span", { class: "who" }, WHO[first.author]),
      ...(t.anchor ? [el("span", { class: "when" }, `in revision ${t.anchor.revision}`)] : []),
      el("span", { class: `status ${status.cls}` }, status.label),
      action,
      ...(collapsed ? [el("span", { class: "snippet" }, first.text)] : []),
      chevron,
    );
    bar.addEventListener("click", (e) => { if (e.target === bar || e.target.classList.contains("snippet")) toggle(); });
    box.append(bar);
    if (collapsed) return box;
    const body = el("div", { class: "thread-body" });
    if (t.anchor && t.outdated) {
      const link = el("a", { href: "#" }, `open revision ${t.anchor.revision}`);
      link.addEventListener("click", (e) => { e.preventDefault(); post({ type: "openRevision", revision: t.anchor.revision }); });
      body.append(el("div", { class: "quote outdated" }, t.anchor.quote), el("div", { class: "outdated-note" }, "The quoted text changed; ", link, "."));
    }
    body.append(el("div", { class: "text first" }, first.text));
    const replyLink = (host) => {
      const a = el("a", { href: "#", class: "action" }, "Reply");
      a.addEventListener("click", (e) => { e.preventDefault(); replyTo(t, host, a); });
      return el("div", { class: "msg-actions" }, a);
    };
    const repliesBox = el("div", { class: "replies" });
    for (const m of replies) repliesBox.append(message(m));
    body.append(replyLink(body), repliesBox);
    box.append(body);
    return box;
  }

  // The row under a text area: a plain button on the left, Cancel as a text link on the right.
  function formActions(label, submit, cancel) {
    const cancelLink = el("a", { href: "#", class: "action" }, "Cancel");
    cancelLink.addEventListener("click", (e) => { e.preventDefault(); cancel(); });
    return el("div", { class: "form-actions" }, el("button", { class: "secondary", onclick: submit }, label), cancelLink);
  }

  // Ctrl+Enter (Cmd+Enter on macOS) submits a text area, Escape cancels it.
  function keys(area, submit, cancel) {
    area.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        submit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    });
  }

  function replyTo(t, body, link) {
    if (body.querySelector("textarea")) return;
    const area = el("textarea", { placeholder: "Your reply (Ctrl+Enter to send, Esc to cancel)" });
    const submit = () => { if (area.value.trim()) post({ type: "reply", id: t.id, text: area.value.trim() }); };
    const form = el("div", { class: "reply-form" });
    const cancel = () => { form.remove(); link.parentElement.hidden = false; };
    form.append(area, formActions("Reply", submit, cancel));
    keys(area, submit, cancel);
    link.parentElement.hidden = true;
    link.parentElement.before(form);
    area.focus();
  }

  function startComment() {
    const sel = window.getSelection();
    const quote = sel ? sel.toString().trim() : "";
    const node = sel && sel.anchorNode ? (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement) : null;
    const block = node ? node.closest("[data-line]") : null;
    if (!quote || !block) {
      flash("Select some text in the document to comment on it.");
      return;
    }
    const card = block.closest("section.card");
    showComposer({ startLine: line(block), endLine: lineEnd(block), quote, section: card ? card.getAttribute("data-section") : "" });
  }

  // A short notice in the header that fades out by itself.
  function flash(text) {
    const old = document.getElementById("flash");
    if (old) old.remove();
    const note = el("div", { id: "flash" }, text);
    head.append(note);
    setTimeout(() => note.remove(), 3000);
  }

  // The form sits right under the block the text was selected in, like an inline review comment.
  // A draft survives re-renders: renderDoc() puts the form back with its text.
  let draft; // { anchor, note, text }

  function showComposer(anchor, text = "") {
    const old = document.getElementById("composer");
    if (old) old.remove();
    draft = { anchor, text };
    const area = el("textarea", { placeholder: "Comment on the selection (Ctrl+Enter to save, Esc to cancel)" });
    area.value = text;
    area.addEventListener("input", () => { draft.text = area.value; });
    const close = () => { box.remove(); draft = undefined; };
    const save = () => { if (area.value.trim()) { post({ type: "addThread", text: area.value.trim(), anchor }); close(); } };
    keys(area, save, close);
    const box = el(
      "div",
      { id: "composer", class: "thread draft" },
      el("div", { class: "quote" }, anchor.quote),
      area,
      formActions("Comment", save, close),
    );
    const host = blockFor(anchor.startLine, anchor.section);
    if (host === doc) return; // the block is gone after a re-render; the draft is dropped with it
    attach(host, box);
    box.scrollIntoView({ block: "nearest" });
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
  }

  function renderToc() {
    toc.replaceChildren();
    let current; // the ## section an h3 belongs to
    for (const h of doc.querySelectorAll("h2, h3")) {
      const s = h.tagName === "H2" ? model.sections.find((x) => x.title === h.textContent) : undefined;
      if (s) current = s;
      // An h3 inherits the viewed mark of its section, drawn smaller.
      const viewed = s ? s.viewed : Boolean(current && current.viewed);
      const a = el("a", { href: "#", class: `${h.tagName.toLowerCase()}${viewed ? " viewed" : ""}` }, el("span", { class: "title" }, h.textContent));
      if (s) {
        // Like the files tree of a pull request: a comment count on the right, a dot for a changed section.
        const open = model.threads.filter((t) => t.section === s.title && t.state !== "accepted").length;
        if (s.changed && !s.viewed) a.append(el("span", { class: "dot", title: "changed in this revision" }));
        if (open > 0) a.append(el("span", { class: "count", title: `${open} open thread${open === 1 ? "" : "s"}` }, bubbleIcon(), String(open)));
      }
      // Look the heading up at click time: the document is re-rendered on every model update
      // and on filter changes, so an element reference taken here would go stale.
      const tag = h.tagName;
      const headingLine = h.getAttribute("data-line");
      a.addEventListener("click", (e) => {
        e.preventDefault();
        scrollToHeading(tag, headingLine);
      });
      toc.append(a);
    }
  }

  function icon(d) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", "14");
    svg.setAttribute("height", "14");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("fill", "currentColor");
    path.setAttribute("d", d);
    svg.append(path);
    return svg;
  }
  // Octicons: thumbsup and paper-airplane.
  const thumbIcon = () => icon("M8.834.066c.763.087 1.5.295 2.01.884.505.581.656 1.378.656 2.3 0 .467-.087 1.119-.157 1.637L11.328 5h1.422c.603 0 1.174.085 1.668.333.508.254.911.679 1.137 1.2.453.998.438 2.447.188 4.316l-.04.306c-.105.79-.195 1.473-.313 2.033-.131.63-.315 1.209-.668 1.672C13.97 15.847 12.706 16 11 16c-1.848 0-3.234-.333-4.388-.653-.165-.045-.323-.09-.475-.133-.658-.186-1.2-.34-1.725-.415A1.75 1.75 0 0 1 2.75 16h-1A1.75 1.75 0 0 1 0 14.25v-7.5C0 5.784.784 5 1.75 5h1a1.75 1.75 0 0 1 1.514.872c.258-.105.59-.268.918-.508C5.853 4.874 6.5 4.079 6.5 2.75v-.5c0-1.202.994-2.337 2.334-2.184ZM4.5 13.3c.705.088 1.39.284 2.072.478l.441.125c1.096.305 2.334.598 3.987.598 1.794 0 2.28-.223 2.528-.549.147-.193.276-.505.394-1.07.105-.502.188-1.124.295-1.93l.04-.3c.25-1.882.189-2.933-.068-3.497a.921.921 0 0 0-.442-.48c-.208-.104-.52-.174-.997-.174H11c-.686 0-1.295-.577-1.206-1.336.023-.192.05-.39.076-.586.065-.488.13-.97.13-1.328 0-.809-.144-1.15-.288-1.316-.137-.158-.402-.304-1.048-.378C8.357 1.521 8 1.793 8 2.25v.5c0 1.922-.978 3.128-1.933 3.825a5.831 5.831 0 0 1-1.567.81ZM2.75 6.5h-1a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h1a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z");
  const sendIcon = () => icon("M.989 8 .064 2.68a1.342 1.342 0 0 1 1.85-1.462l13.402 5.744a1.13 1.13 0 0 1 0 2.076L1.913 14.782a1.343 1.343 0 0 1-1.85-1.463L.99 8Zm.603-5.288L2.38 7.25h4.87a.75.75 0 0 1 0 1.5H2.38l-.788 4.538L13.929 8Z");

  function bubbleIcon() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", "12");
    svg.setAttribute("height", "12");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("fill", "currentColor");
    path.setAttribute("d", "M1 2.75C1 1.78 1.78 1 2.75 1h10.5c.97 0 1.75.78 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.57 2.57A1.46 1.46 0 0 1 4 13.54V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .14.11.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.75.75 0 0 1 .53-.22h4.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z");
    svg.append(path);
    return svg;
  }

  // Scroll `main` so the heading sits just below the sticky header.
  function scrollToHeading(tag, headingLine) {
    const target = [...doc.querySelectorAll(tag)].find((h) => h.getAttribute("data-line") === headingLine);
    if (!target) return;
    const card = target.closest("section.card");
    const top = (tag === "H2" && card ? card : target).getBoundingClientRect().top - main.getBoundingClientRect().top;
    main.scrollTo({ top: main.scrollTop + top - head.offsetHeight - 8 });
  }

  post({ type: "ready" });
})();
