import { access } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

export const REVIEW_DIR = ".spec-review";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function ancestors(dir: string): string[] {
  const out: string[] = [];
  let current = resolve(dir);
  for (;;) {
    out.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return out;
}

/** The directory under which `.spec-review` lives for the document: the nearest
 * ancestor that already has one, else the repository root, else the document's
 * own directory. The CLI and the extension must agree on this, so it lives here. */
export async function findReviewRoot(docPath: string): Promise<string> {
  const dirs = ancestors(dirname(resolve(docPath)));
  for (const dir of dirs) if (await exists(join(dir, REVIEW_DIR))) return dir;
  for (const dir of dirs) if ((await exists(join(dir, ".git"))) || (await exists(join(dir, ".arc")))) return dir;
  return dirs[0];
}

/** Data directory of one document: `.spec-review/<path relative to root>`. */
export function reviewDir(root: string, docPath: string): string {
  return join(root, REVIEW_DIR, relative(root, resolve(docPath)));
}
