import * as vscode from "vscode";
import { basename, dirname } from "node:path";
import {
  CorruptFileError,
  ReviewStore,
  acceptThread,
  addThread,
  ensureInitialized,
  finishRound,
  replyAsUser,
  setApproved,
  type Anchor,
} from "@spec-review/core";
import { buildViewModel } from "./viewModel.js";
import { openCompare, openRevision, openSource } from "./compare.js";
import { watchReview } from "./watcher.js";

type Incoming =
  | { type: "ready" }
  | { type: "addThread"; text: string; anchor?: Omit<Anchor, "revision"> }
  | { type: "reply"; id: string; text: string }
  | { type: "accept"; id: string }
  | { type: "toggleViewed"; section: string; viewed: boolean }
  | { type: "openSource"; line: number }
  | { type: "compare"; line?: number }
  | { type: "setBase"; revision: number }
  | { type: "snapshot" }
  | { type: "approve"; approved: boolean }
  | { type: "openRevision"; revision: number };

export class ReviewPanel {
  private static readonly panels = new Map<string, ReviewPanel>();
  static active: ReviewPanel | undefined;

  static async show(context: vscode.ExtensionContext, docPath: string): Promise<void> {
    const existing = ReviewPanel.panels.get(docPath);
    if (existing) {
      existing.panel.reveal();
      return;
    }
    const store = await ReviewStore.open(docPath);
    await ensureInitialized(store);
    const panel = vscode.window.createWebviewPanel("specReview.panel", `Review: ${basename(docPath)}`, vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media"), vscode.Uri.file(dirname(docPath))],
    });
    ReviewPanel.panels.set(docPath, new ReviewPanel(context, store, panel));
  }

  private baseRevision: number | undefined;
  private lastRevision = 0;
  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: ReviewStore,
    private readonly panel: vscode.WebviewPanel,
  ) {
    panel.webview.html = this.html();
    ReviewPanel.active = this;
    this.disposables.push(
      panel.webview.onDidReceiveMessage((m: Incoming) => void this.handle(m)),
      panel.onDidChangeViewState(() => {
        if (panel.active) ReviewPanel.active = this;
      }),
      watchReview(store, () => void this.refresh()),
      panel.onDidDispose(() => this.dispose()),
    );
  }

  requestComment(): void {
    void this.panel.webview.postMessage({ type: "comment" });
  }

  private dispose(): void {
    ReviewPanel.panels.delete(this.store.docPath);
    if (ReviewPanel.active === this) ReviewPanel.active = undefined;
    for (const d of this.disposables) d.dispose();
  }

  private async refresh(): Promise<void> {
    try {
      const model = await buildViewModel(this.store, this.baseRevision);
      const newRound = this.lastRevision > 0 && model.revision > this.lastRevision;
      this.lastRevision = model.revision;
      if (newRound) {
        // The base chosen for the previous round is stale now; fall back to "previous vs latest".
        this.baseRevision = undefined;
        void vscode.window.showInformationMessage(`Spec Review: revision ${model.revision} of ${basename(this.store.docPath)} is ready.`);
      }
      const docBase = this.panel.webview.asWebviewUri(vscode.Uri.file(dirname(this.store.docPath))).toString();
      await this.panel.webview.postMessage({ type: "model", model: { ...model, docBase }, focus: newRound ? "first-change" : undefined });
    } catch (e) {
      await this.panel.webview.postMessage({ type: "error", message: describeError(e, this.store.docPath) });
    }
  }

  private async handle(m: Incoming): Promise<void> {
    try {
      switch (m.type) {
        case "ready":
          await this.refresh();
          return;
        case "addThread": {
          const meta = await this.store.readMeta();
          await addThread(this.store, m.text, m.anchor ? { ...m.anchor, revision: meta?.revision ?? 1 } : undefined);
          return;
        }
        case "reply":
          await replyAsUser(this.store, m.id, m.text);
          return;
        case "accept":
          await acceptThread(this.store, m.id);
          return;
        case "toggleViewed": {
          const viewed = await this.store.readViewed();
          const sections = new Set(viewed.sections);
          if (m.viewed) sections.add(m.section);
          else sections.delete(m.section);
          await this.store.writeViewed({ ...viewed, sections: [...sections] });
          return;
        }
        case "openSource":
          await openSource(this.store, m.line);
          return;
        case "compare": {
          const model = await buildViewModel(this.store, this.baseRevision);
          await openCompare(this.store, model.baseRevision, m.line ?? 0);
          return;
        }
        case "setBase":
          this.baseRevision = m.revision;
          await this.refresh();
          return;
        case "snapshot":
          await finishRound(this.store);
          return;
        case "approve":
          await setApproved(this.store, m.approved);
          return;
        case "openRevision":
          await openRevision(this.store, m.revision);
          return;
      }
    } catch (e) {
      vscode.window.showErrorMessage(`Spec Review: ${describeError(e, this.store.docPath)}`);
    }
  }

  private html(): string {
    const w = this.panel.webview;
    const media = (f: string) => w.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", f));
    const nonce = Math.random().toString(36).slice(2);
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${w.cspSource} https: data:; style-src ${w.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${media("style.css")}">
<title>Spec Review</title>
</head>
<body>
<nav id="toc"></nav>
<main>
  <header id="head"></header>
  <article id="doc"></article>
</main>
<script nonce="${nonce}" src="${media("main.js")}"></script>
</body>
</html>`;
  }
}

function describeError(e: unknown, docPath: string): string {
  if (e instanceof CorruptFileError) return `${e.message}. Fix or remove the file by hand; nothing was written.`;
  if (e instanceof Error && (e as NodeJS.ErrnoException).code === "ENOENT" && (e as NodeJS.ErrnoException).path === docPath) {
    return `Document not found: ${docPath}. Restore it or open the new file in Spec Review; the review data is kept.`;
  }
  return e instanceof Error ? e.message : String(e);
}
