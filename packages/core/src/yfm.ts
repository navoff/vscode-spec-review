import type MarkdownIt from "markdown-it";
import type StateBlock from "markdown-it/lib/rules_block/state_block.mjs";

const OPEN = /^\{%\s*(cut|note)(?:\s+([a-z]+))?(?:\s+"([^"]*)")?\s*%\}\s*$/;
const CLOSE = /^\{%\s*end(cut|note)\s*%\}\s*$/;
const NOTE_TYPES = new Set(["info", "tip", "important", "warning", "alert"]);

/** `{% cut "Title" %}` / `{% endcut %}` and `{% note type "Title" %}` / `{% endnote %}` on their own lines.
 * The marker line becomes a container token; the lines between are parsed as ordinary blocks. */
export function yfmPlugin(md: MarkdownIt): void {
  const rule = (state: StateBlock, startLine: number, _endLine: number, silent: boolean): boolean => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const line = state.src.slice(start, state.eMarks[startLine]);
    if (!line.startsWith("{%")) return false;
    const open = OPEN.exec(line);
    const close = CLOSE.exec(line);
    if (!open && !close) return false;
    if (silent) return true;
    if (open) {
      const kind = open[1];
      const token = state.push(`${kind}_open`, kind === "cut" ? "details" : "div", 1);
      token.map = [startLine, startLine + 1];
      token.block = true;
      const type = open[2] && NOTE_TYPES.has(open[2]) ? open[2] : "info";
      token.meta = { title: open[3] ?? "", type: type === "alert" ? "important" : type };
    } else {
      const kind = close![1];
      const token = state.push(`${kind}_close`, kind === "cut" ? "details" : "div", -1);
      token.block = true;
    }
    state.line = startLine + 1;
    return true;
  };
  // Listed as a terminator so that a marker line ends the paragraph before it.
  md.block.ruler.before("paragraph", "yfm", rule, { alt: ["paragraph", "reference", "blockquote", "list"] });

  const esc = md.utils.escapeHtml;
  md.renderer.rules.cut_open = (tokens, i, _o, _e, self) => {
    const t = tokens[i];
    t.attrSet("class", "cut");
    return `<details${self.renderAttrs(t)}><summary>${esc(t.meta.title || "Details")}</summary>\n`;
  };
  md.renderer.rules.cut_close = () => "</details>\n";
  md.renderer.rules.note_open = (tokens, i, _o, _e, self) => {
    const t = tokens[i];
    t.attrSet("class", `note note-${t.meta.type}`);
    const title = t.meta.title ? `<p class="note-title">${esc(t.meta.title)}</p>` : "";
    return `<div${self.renderAttrs(t)}>${title}\n`;
  };
  md.renderer.rules.note_close = () => "</div>\n";
}
