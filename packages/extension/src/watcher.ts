import * as vscode from "vscode";
import { dirname } from "node:path";
import type { ReviewStore } from "@spec-review/core";

/** Fire once, a little after the last change to the document or its review data. Writes come in
 * bursts (the agent replies to several threads, then finishes), so the panel refreshes after the burst. */
export function watchReview(store: ReviewStore, onChange: () => void): vscode.Disposable {
  const docWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(dirname(store.docPath), "*.md"));
  const dataWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(store.dir, "**"));
  let timer: NodeJS.Timeout | undefined;
  const schedule = (uri: vscode.Uri) => {
    if (uri.fsPath.endsWith(".tmp")) return;
    if (uri.fsPath.endsWith(".md") && uri.fsPath !== store.docPath && !uri.fsPath.startsWith(store.dir)) return;
    clearTimeout(timer);
    timer = setTimeout(onChange, 300);
  };
  const subs = [docWatcher, dataWatcher].flatMap((w) => [w, w.onDidChange(schedule), w.onDidCreate(schedule), w.onDidDelete(schedule)]);
  return vscode.Disposable.from(...subs, { dispose: () => clearTimeout(timer) });
}
