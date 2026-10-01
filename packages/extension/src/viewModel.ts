import {
  ReviewStore,
  changedBlocks,
  changedSections,
  deletionsBetweenBlocks,
  diffRevisions,
  parseDocument,
  relocate,
  type Thread,
} from "@spec-review/core";
import { syncViewed } from "./viewed.js";

export interface ThreadView extends Thread {
  lines: [number, number] | null;
  outdated: boolean;
  section: string;
}

export interface SectionView {
  title: string;
  startLine: number;
  endLine: number;
  viewed: boolean;
  changed: boolean;
  changedWithoutThread: boolean;
}

export interface ViewModel {
  docPath: string;
  revision: number;
  baseRevision: number;
  approved: boolean;
  dirty: boolean;
  summary?: string;
  html: string;
  sections: SectionView[];
  threads: ThreadView[];
  changedBlocks: [number, number][];
  deletions: { beforeLine: number; text: string }[];
  counts: { open: number; answered: number; accepted: number };
}

/** Everything the panel shows, computed from the store and the live document. With no explicit base,
 * unsnapshotted edits are compared against the latest revision, otherwise the latest against the one before. */
export async function buildViewModel(store: ReviewStore, baseRevision?: number): Promise<ViewModel> {
  const text = await store.readDocument();
  // Before the first comment there is no data on disk; the document itself stands for revision 1.
  const meta = (await store.readMeta()) ?? { docPath: store.docPath, revision: 1, approved: false, revisions: {} };
  const latest = Object.keys(meta.revisions).length === 0 ? text : await store.readRevision(meta.revision);
  const dirty = text !== latest;
  const base = baseRevision ?? (dirty ? meta.revision : Math.max(1, meta.revision - 1));
  const baseText = base === meta.revision ? latest : await store.readRevision(base);
  const parsed = parseDocument(text);
  const changes = diffRevisions(baseText, text);
  const changed = new Set(changedSections(parsed.sections, changes));
  const viewed = new Set((await syncViewed(store)).sections);
  const threads: ThreadView[] = (await store.listThreads()).map((t) => {
    const where = t.anchor ? relocate(t.anchor, text) : undefined;
    return {
      ...t,
      lines: where ? [where.startLine, where.endLine] : null,
      outdated: Boolean(t.anchor) && !where,
      section: t.anchor?.section ?? "",
    };
  });
  // A section changed in this round without an agent reply in it is the "what else did the agent touch" signal.
  const roundStart = meta.revisions[String(base)]?.at ?? "";
  const answeredIn = new Set(threads.filter((t) => t.messages.some((m) => m.author === "agent" && m.at > roundStart)).map((t) => t.section));
  const count = (state: Thread["state"]) => threads.filter((t) => t.state === state).length;
  return {
    docPath: store.docPath,
    revision: meta.revision,
    baseRevision: base,
    approved: meta.approved,
    dirty,
    summary: meta.revisions[String(meta.revision)]?.summary,
    html: parsed.html,
    sections: parsed.sections.map((s) => ({
      ...s,
      viewed: viewed.has(s.title),
      changed: changed.has(s.title),
      changedWithoutThread: changed.has(s.title) && !answeredIn.has(s.title),
    })),
    threads,
    changedBlocks: changedBlocks(parsed.blocks, changes).map((i) => [parsed.blocks[i].startLine, parsed.blocks[i].endLine]),
    deletions: deletionsBetweenBlocks(parsed.blocks, changes),
    counts: { open: count("open"), answered: count("answered"), accepted: count("accepted") },
  };
}
