# Manual check of Spec Review

Before a release, go through this list in "Run Extension" on a document with several `##` sections, a table, a code block, a `{% cut %}` and a `{% note %}`. `docs/demo/toaster-firmware-design.md` has all of them.

## First open

- [ ] "Open in Spec Review" from the file's context menu and from the editor title opens the panel.
- [ ] Nothing appears under `.spec-review` on open; after the first comment `meta.json` and `revisions/0001.md` appear, and revision 1 equals the document.
- [ ] The table of contents lists `##` and `###`; a click scrolls to the heading, just below the sticky header.
- [ ] Table, code, cut and note are rendered; a relative image is visible.

## Comments

- [ ] Selecting text and `Ctrl+Shift+M`, or "Comment on Selection" in the context menu, opens the form with the quote right under the block; after "Comment" the thread appears there and `threads/<id>.json` is created.
- [ ] `Ctrl+Shift+M` without a selection shows a hint in the header and opens no form.
- [ ] `Ctrl+Enter` saves the form, `Esc` closes it.
- [ ] "Mark viewed" changes the card and the table of contents; the marks survive reopening the panel.

## Agent round

- [ ] `node skill/spec-review.mjs list <doc>` prints the open threads with `lines` and `quote`.
- [ ] `finish` before any reply exits with code 2 and lists the threads.
- [ ] After `reply` the answer appears in the thread without a restart; the thread shows the verdict pill in yellow.
- [ ] After an edit of the md and `finish` the panel shows a notification, "Changed" pills on sections, bars on changed blocks and a marker for removed text; the agent summary appears above the document.
- [ ] A section changed without a comment is labelled "Changed without a comment".
- [ ] Viewed marks of changed sections are reset, the others stay.
- [ ] "Diff" on a section opens the built-in diff editor scrolled to the section; choosing another revision in the header changes the base.
- [ ] A thread whose quote disappeared shows the quote struck through with a link to the old revision.
- [ ] "Reply" puts the thread back to open (red), "Resolve" closes it (green) and folds it, "Reopen" opens it again.

## Edits outside the skill

- [ ] Editing the md by hand shows "unsnapshotted edits" and change bars against the latest revision; "Snapshot revision" creates a new revision.

## Finish review

- [ ] The button is hidden on a freshly opened document; while a thread is unresolved or a section is not viewed it shows a warning mark, the hover names what is left, and the confirmation asks "Are you sure?".
- [ ] After confirmation the document's `.spec-review` directory and its empty parents are gone and the panel looks freshly opened.

## Errors

- [ ] A corrupt `meta.json` yields a message with the path in the panel; the file is not overwritten.
- [ ] Renaming the md yields "Document not found"; the data stays in place.

## Skill

- [ ] "Install Agent Skill" copies `SKILL.md` and `spec-review.mjs` into `~/.claude/skills/spec-review/` and `~/.codex/skills/spec-review/`.
- [ ] "Send to agent" copies a prompt with the absolute path; pasted into a Claude Code session it leads to `list`, `reply`, `finish` calls.
