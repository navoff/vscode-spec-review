import { diffLines } from "diff";
import type { Block, Section } from "./markdown.js";

export interface Change {
  /** Lines of the new text, zero-based, end exclusive. A pure deletion has start === end. */
  start: number;
  end: number;
  /** Old text that these lines replaced; empty for a pure insertion. */
  removed: string;
}

export interface Deletion {
  beforeLine: number;
  text: string;
}

/** Line diff folded into ranges of the new text. A removal directly followed by an
 * addition is one change, so the reader sees "this block was rewritten", not two events. */
export function diffRevisions(oldText: string, newText: string): Change[] {
  const changes: Change[] = [];
  let line = 0;
  let pendingRemoved = "";
  for (const part of diffLines(oldText, newText)) {
    const count = part.count ?? 0;
    if (part.removed) {
      pendingRemoved += part.value;
      continue;
    }
    if (part.added) {
      changes.push({ start: line, end: line + count, removed: pendingRemoved });
      pendingRemoved = "";
      line += count;
      continue;
    }
    if (pendingRemoved) {
      changes.push({ start: line, end: line, removed: pendingRemoved });
      pendingRemoved = "";
    }
    line += count;
  }
  if (pendingRemoved) changes.push({ start: line, end: line, removed: pendingRemoved });
  return changes;
}

function touches(startLine: number, endLine: number, c: Change): boolean {
  if (c.start === c.end) return c.start > startLine && c.start < endLine;
  return c.start < endLine && c.end > startLine;
}

export function changedBlocks(blocks: Block[], changes: Change[]): number[] {
  const out: number[] = [];
  blocks.forEach((b, i) => {
    if (changes.some((c) => touches(b.startLine, b.endLine, c))) out.push(i);
  });
  return out;
}

/** Pure deletions that fall between blocks; the reader needs a marker where text disappeared. */
export function deletionsBetweenBlocks(blocks: Block[], changes: Change[]): Deletion[] {
  return changes
    .filter((c) => c.start === c.end && !blocks.some((b) => touches(b.startLine, b.endLine, c)))
    .map((c) => ({ beforeLine: c.start, text: c.removed }));
}

export function changedSections(sections: Section[], changes: Change[]): string[] {
  const last = sections[sections.length - 1];
  return sections
    .filter((s) => changes.some((c) => touches(s.startLine, s.endLine, c) || (c.start === c.end && s === last && c.start === s.endLine)))
    .map((s) => s.title);
}
