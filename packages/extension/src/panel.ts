import * as vscode from "vscode";
import { basename, dirname } from "node:path";
import {
  CorruptFileError,
  ReviewStore,
  acceptThread,
  addThread,
  ensureInitialized,
  finishRound,
  reopenThread,
  replyAsUser,
  resetReview,
  setApproved,
  type Anchor,
} from "@spec-review/core";
import { buildViewModel } from "./viewModel.js";
import { syncViewed } from "./viewed.js";
import { openCompare, openRevision, openSource } from "./compare.js";
import { watchReview } from "./watcher.js";

type Incoming =
  | { type: "ready" }
  | { type: "addThread"; text: string; anchor?: Omit<Anchor, "revision"> }
  | { type: "reply"; id: string; text: string }
  | { type: "accept"; id: string }
  | { type: "reopen"; id: string }
  | { type: "toggleViewed"; section: string; viewed: boolean }
  | { type: "openSource"; line: number }
  | { type: "compare"; line?: number }
  | { type: "setBase"; revision: number }
  | { type: "snapshot" }
  | { type: "approve"; approved: boolean }
  | { type: "openRevision"; revision: number }
  | { type: "copyPrompt" }
  | { type: "finishReview" };

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
    const panel = vscode.window.createWebviewPanel("specReview.panel", `Review: ${basename(docPath)}`, vscode.ViewColumn.Active, {
      enableScripts: true,
      // Ctrl+F inside the panel: VS Code's own find widget over the rendered text.
      enableFindWidget: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media"), vscode.Uri.file(dirname(docPath))],
    });
    panel.iconPath = {
      light: vscode.Uri.joinPath(context.extensionUri, "resources", "review-light.svg"),
      dark: vscode.Uri.joinPath(context.extensionUri, "resources", "review-dark.svg"),
    };
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

  private async refresh(reset = false): Promise<void> {
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
      await this.panel.webview.postMessage({ type: "model", model: { ...model, docBase }, focus: newRound ? "first-change" : undefined, reset });
    } catch (e) {
      await this.panel.webview.postMessage({ type: "error", message: describeError(e, this.store.docPath) });
    }
  }

  private async handle(m: Incoming): Promise<void> {
    try {
      await this.act(m);
    } catch (e) {
      vscode.window.showErrorMessage(`Spec Review: ${describeError(e, this.store.docPath)}`);
    }
  }

  /** Actions that write review data refresh the panel themselves: the file watcher may be
   * silent for a directory outside the workspace folders, and the user expects an immediate response. */
  private async act(m: Incoming): Promise<void> {
    switch (m.type) {
      case "ready":
        await this.refresh();
        return;
      case "addThread": {
        const meta = await this.store.readMeta();
        await addThread(this.store, m.text, m.anchor ? { ...m.anchor, revision: meta?.revision ?? 1 } : undefined);
        await this.refresh();
        return;
      }
      case "reply":
        await replyAsUser(this.store, m.id, m.text);
        await this.refresh();
        return;
      case "accept":
        await acceptThread(this.store, m.id);
        await this.refresh();
        return;
      case "reopen":
        await reopenThread(this.store, m.id);
        await this.refresh();
        return;
      case "toggleViewed": {
        // Through syncViewed, so the file carries the current revision number and the mark survives.
        await ensureInitialized(this.store);
        const viewed = await syncViewed(this.store);
        const sections = new Set(viewed.sections);
        if (m.viewed) sections.add(m.section);
        else sections.delete(m.section);
        await this.store.writeViewed({ ...viewed, sections: [...sections] });
        await this.refresh();
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
        await ensureInitialized(this.store);
        await finishRound(this.store);
        await this.refresh();
        return;
      case "approve":
        await ensureInitialized(this.store);
        await setApproved(this.store, m.approved);
        await this.refresh();
        return;
      case "openRevision":
        await openRevision(this.store, m.revision);
        return;
      case "finishReview": {
        const name = basename(this.store.docPath);
        const choice = await vscode.window.showWarningMessage(
          `Finish the review of ${name}? All revisions, comment threads and viewed marks will be deleted; the document itself is kept.`,
          { modal: true },
          "Finish review",
        );
        if (choice !== "Finish review") return;
        await resetReview(this.store);
        this.baseRevision = undefined;
        this.lastRevision = 0;
        await this.refresh(true);
        return;
      }
      case "copyPrompt":
        await vscode.env.clipboard.writeText(await this.agentPrompt());
        await this.panel.webview.postMessage({ type: "flash", text: "Prompt copied. Paste it into the agent's chat." });
        return;
    }
  }

  /** What the user pastes into the agent's chat to start the next round. */
  private async agentPrompt(): Promise<string> {
    const open = (await this.store.listThreads()).filter((t) => t.state === "open").length;
    const comments = open === 0 ? "no open comments" : `${open} open comment${open === 1 ? "" : "s"}`;
    // The absolute path: the agent's session may run from a different directory than the workspace folder.
    return `Review of ${this.store.docPath} is finished: ${comments}. Process them with the spec-review skill: list the threads, make the edits, reply to each thread, then finish the round.`;
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
