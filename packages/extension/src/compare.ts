import * as vscode from "vscode";
import { basename } from "node:path";
import type { ReviewStore } from "@spec-review/core";

/** The built-in diff editor: revision snapshot on the left, the live document on the right. */
export async function openCompare(store: ReviewStore, revision: number, line = 0): Promise<void> {
  const left = vscode.Uri.file(store.revisionFile(revision));
  const right = vscode.Uri.file(store.docPath);
  const title = `${basename(store.docPath)}: revision ${revision} ↔ current`;
  const selection = new vscode.Range(line, 0, line, 0);
  await vscode.commands.executeCommand("vscode.diff", left, right, title, { selection, preview: true });
}

export async function openSource(store: ReviewStore, line: number): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(store.docPath);
  const editor = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false });
  const pos = new vscode.Position(line, 0);
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
}

export async function openRevision(store: ReviewStore, revision: number, line = 0): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(store.revisionFile(revision));
  const editor = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: true });
  const pos = new vscode.Position(line, 0);
  editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
}
