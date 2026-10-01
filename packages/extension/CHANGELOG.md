# Changelog

## 0.1.0 - 2026-10-01

First release.

- Rendered review panel for Markdown documents: section cards with viewed
  marks, a table of contents with thread counts, reading progress, support
  for `{% cut %}` and `{% note %}`.
- Comment threads anchored to the selected text, laid out like a code review
  tool: replies, Resolve and Reopen, red for threads waiting for the agent,
  yellow for threads waiting for the reviewer, green for resolved ones.
- Revisions snapshotted by the agent's `finish`, change bars on blocks,
  Changed pills on sections, the built-in diff editor against any revision,
  and a summary of what the agent changed outside the comments.
- Send to agent copies a prompt for the next round; Finish review deletes
  the review data once everything is resolved and viewed.
- The `spec-review` skill with a dependency-free script (`list`, `reply`,
  `finish`, `status`) for Claude Code, Codex and other agents, installed
  with one command.
