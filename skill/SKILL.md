---
name: spec-review
description: Process reviewer comments on a Markdown document (spec, plan, report) left in VS Code Spec Review. Use when the user asks to handle, process or address review comments, remarks or feedback on a document ("process the review", "address the comments"), or mentions .spec-review.
---

# Spec Review

The reviewer reads the document in VS Code, marks sections viewed and leaves comments anchored to the text. This skill turns those comments into edits, replies and a new revision that the reviewer can diff against the previous one.

The script lives next to this file: `<skill dir>/spec-review.mjs`. Run it with `node`.

## Round

1. Find the document. The user usually names it; otherwise take the Markdown file they are discussing.
2. `node <skill dir>/spec-review.mjs list <doc.md>` prints the open threads as JSON: `id`, `section`, `lines` (zero-based, end exclusive, in the current text), `quote` (the text the reviewer selected), `messages` (the whole thread, newest last). `lines: null` with `outdated: true` means the quoted text no longer exists; find the place by `section` and `quote`.
3. For each thread, read the whole thread, edit the document, then reply once:
   `node <skill dir>/spec-review.mjs reply <doc.md> <id> --verdict fixed --message "What you changed, in one or two sentences"`.
   - `fixed`: the edit is done. Say what changed.
   - `declined`: you did not change the text. Explain why; an empty message is refused.
   - `question`: the comment cannot be acted on without an answer. Ask one precise question. Do not edit that place.
4. Do not change sections no thread points at unless a comment requires it (a rename, a moved definition). If you did, say so in the summary.
5. `node <skill dir>/spec-review.mjs finish <doc.md> --summary "One paragraph: what changed beyond the comments, or 'Only the commented places changed.'"` snapshots the new revision. It fails while any thread is open; reply to the listed threads and run it again.
6. Tell the user the round is done and how many comments got `fixed`, `declined` and `question`.

## Rules

- Keep the document's language, formatting and heading titles. Renaming a `##` heading breaks the reviewer's viewed marks and anchors.
- One reply per thread per round. Do not resolve threads: only the reviewer accepts them.
- Never edit files under `.spec-review/` by hand; the script owns them.
- `node <skill dir>/spec-review.mjs status <doc.md>` shows the revision number and counts when you need to orient yourself.
