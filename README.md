# Spec Review

A VS Code extension for reviewing Markdown documents written by an AI agent the way a pull request is reviewed: a rendered document, comments anchored to the text, the agent's replies, revisions and a diff between them. The user-facing description lives in [packages/extension/README.md](packages/extension/README.md).

Packages:

- `packages/core` - the `.spec-review/` store, Markdown parsed into line-mapped blocks, revision diffs, relocating a comment by its quote. No VS Code dependency.
- `packages/cli` - the agent's script, bundled into a single dependency-free `spec-review.mjs`.
- `packages/extension` - the extension itself: the panel, commands, file watching.
- `skill/` - the `spec-review` skill for the agent; the build copies the script bundle here.

Build and check:

```bash
npm install
npm run build
npm test
npm run package -w vscode-spec-review   # vsix in packages/extension
```

The manual check list for the extension is in [docs/manual-check.md](docs/manual-check.md); a small document to try the panel on is in [docs/demo/toaster-firmware-design.md](docs/demo/toaster-firmware-design.md).
