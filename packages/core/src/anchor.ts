import type { Anchor } from "./types.js";

export interface LineRange {
  startLine: number;
  endLine: number;
}

/** Inline Markdown punctuation that the rendered text (where quotes are selected) does not contain. */
const MARKUP = new Set(["`", "*"]);

function normalize(s: string): string {
  return [...s]
    .filter((ch) => !MARKUP.has(ch))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** Collapse whitespace and drop inline markup in the text while remembering which source line each kept character came from. */
function normalizeWithLines(text: string): { norm: string; lineOf: number[] } {
  let norm = "";
  const lineOf: number[] = [];
  let line = 0;
  let pendingSpace = false;
  for (const ch of text) {
    if (MARKUP.has(ch)) continue;
    if (/\s/.test(ch)) {
      if (ch === "\n") line++;
      pendingSpace = norm.length > 0;
      continue;
    }
    if (pendingSpace) {
      norm += " ";
      lineOf.push(line);
      pendingSpace = false;
    }
    norm += ch;
    lineOf.push(line);
  }
  return { norm, lineOf };
}

/** Where the quoted text lives now. Among several occurrences, the one nearest to the original line wins. */
export function relocate(anchor: Anchor, text: string): LineRange | undefined {
  const quote = normalize(anchor.quote);
  if (!quote) return undefined;
  const { norm, lineOf } = normalizeWithLines(text);
  let best: LineRange | undefined;
  let bestDistance = Infinity;
  for (let i = norm.indexOf(quote); i !== -1; i = norm.indexOf(quote, i + 1)) {
    const range = { startLine: lineOf[i], endLine: lineOf[i + quote.length - 1] + 1 };
    const distance = Math.abs(range.startLine - anchor.startLine);
    if (distance < bestDistance) {
      best = range;
      bestDistance = distance;
    }
  }
  return best;
}
