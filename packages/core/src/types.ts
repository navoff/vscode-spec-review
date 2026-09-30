export type Verdict = "fixed" | "declined" | "question";
export type ThreadState = "open" | "answered" | "accepted";
export type Author = "user" | "agent";

export interface RevisionInfo {
  /** ISO time when the snapshot was taken. */
  at: string;
  /** What the agent said about the round on `finish`. */
  summary?: string;
}

export interface Meta {
  /** Absolute path of the reviewed document. */
  docPath: string;
  /** Number of the latest revision, starting at 1. */
  revision: number;
  approved: boolean;
  revisions: Record<string, RevisionInfo>;
}

export interface Message {
  author: Author;
  at: string;
  text: string;
  /** Present on agent messages only. */
  verdict?: Verdict;
}

export interface Anchor {
  /** Revision the lines and the quote were taken from. */
  revision: number;
  /** Zero-based, end exclusive, as in markdown-it token maps. */
  startLine: number;
  endLine: number;
  quote: string;
  /** Title of the enclosing `##` section, empty for the lead. */
  section: string;
}

export interface Thread {
  id: string;
  createdAt: string;
  state: ThreadState;
  /** Absent for a comment on the whole document. */
  anchor?: Anchor;
  messages: Message[];
}

export interface Viewed {
  /** Revision the marks refer to; marks of changed sections are dropped on migration. */
  revision: number;
  sections: string[];
}
