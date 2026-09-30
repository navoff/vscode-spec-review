import * as vscode from "vscode";
import { cp, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

function expandHome(p: string): string {
  return p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;
}

/** Copy SKILL.md and the bundled script into every configured skills directory. */
export async function installSkill(context: vscode.ExtensionContext): Promise<void> {
  const targets = vscode.workspace.getConfiguration("specReview").get<string[]>("skillTargets", []);
  const source = join(context.extensionPath, "dist", "skill");
  const done: string[] = [];
  for (const target of targets) {
    const dir = join(expandHome(target), "spec-review");
    await mkdir(dir, { recursive: true });
    await cp(source, dir, { recursive: true, force: true });
    done.push(dir);
  }
  vscode.window.showInformationMessage(done.length ? `Spec Review skill installed to ${done.join(", ")}` : "Spec Review: no skill targets configured.");
}
