import * as vscode from "vscode";
import { ReviewPanel } from "./panel.js";
import { installSkill } from "./skillInstall.js";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("specReview.open", async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target || !target.fsPath.endsWith(".md")) {
        vscode.window.showErrorMessage("Spec Review: open or select a Markdown file first.");
        return;
      }
      try {
        await ReviewPanel.show(context, target.fsPath);
      } catch (e) {
        vscode.window.showErrorMessage(`Spec Review: ${e instanceof Error ? e.message : String(e)}`);
      }
    }),
    vscode.commands.registerCommand("specReview.comment", () => ReviewPanel.active?.requestComment()),
    vscode.commands.registerCommand("specReview.installSkill", async () => {
      try {
        await installSkill(context);
      } catch (e) {
        vscode.window.showErrorMessage(`Spec Review: ${e instanceof Error ? e.message : String(e)}`);
      }
    }),
  );
}

export function deactivate(): void {}
