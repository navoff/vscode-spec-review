import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import { yfmPlugin } from "./yfm.js";

export interface Block {
  type: string;
  /** Zero-based, end exclusive. */
  startLine: number;
  endLine: number;
  /** Title of the enclosing `##` section, empty before the first one. */
  section: string;
}

export interface Section {
  title: string;
  startLine: number;
  endLine: number;
}

export interface ParsedDocument {
  blocks: Block[];
  sections: Section[];
  html: string;
}

/** Containers whose children still count as blocks of their own. */
const TRANSPARENT = new Set(["cut_open", "note_open", "bullet_list_open", "ordered_list_open"]);
/** Tokens that carry a map but are never blocks themselves. */
const NOT_BLOCKS = new Set(["inline", "bullet_list_open", "ordered_list_open"]);

const TYPE_NAMES: Record<string, string> = {
  heading_open: "heading",
  paragraph_open: "paragraph",
  list_item_open: "list_item",
  blockquote_open: "blockquote",
  table_open: "table",
  cut_open: "cut",
  note_open: "note",
  fence: "fence",
  code_block: "code",
  hr: "hr",
  html_block: "html",
};

const md = new MarkdownIt({ html: false, linkify: true }).use(yfmPlugin);

function headingText(tokens: Token[], i: number): string {
  return tokens[i + 1]?.type === "inline" ? tokens[i + 1].content.trim() : "";
}

function countLines(source: string): number {
  const lines = source.split("\n");
  return source.endsWith("\n") ? lines.length - 1 : lines.length;
}

/** Walk the token stream once: pick the blocks a reader can point at, note the `##` sections,
 * and stamp both with source lines so the rendered HTML can be mapped back to the document. */
export function parseDocument(source: string): ParsedDocument {
  const tokens = md.parse(source, {});
  const lineCount = countLines(source);
  const blocks: Block[] = [];
  const sections: Section[] = [];
  const stack: string[] = [];
  let section = "";
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.nesting === -1) stack.pop();
    const isBlock = t.map !== null && !NOT_BLOCKS.has(t.type) && stack.every((s) => TRANSPARENT.has(s));
    if (isBlock && t.map) {
      t.attrSet("data-line", String(t.map[0]));
      t.attrSet("data-line-end", String(t.map[1]));
      if (t.type === "heading_open" && t.tag === "h2") {
        section = headingText(tokens, i);
        if (sections.length > 0) sections[sections.length - 1].endLine = t.map[0];
        sections.push({ title: section, startLine: t.map[0], endLine: lineCount });
        t.attrSet("data-section", section);
      }
      blocks.push({ type: TYPE_NAMES[t.type] ?? t.type, startLine: t.map[0], endLine: t.map[1], section });
    }
    if (t.nesting === 1) stack.push(t.type);
  }
  return { blocks, sections, html: md.renderer.render(tokens, md.options, {}) };
}
