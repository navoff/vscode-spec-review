import { readdir, rm, rmdir } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { newId } from "./id.js";
import { REVIEW_DIR } from "./paths.js";
import type { ReviewStore } from "./store.js";
import type { Anchor, Meta, Thread, Verdict } from "./types.js";

export interface Status {
  revision: number;
  approved: boolean;
  /** The document differs from the latest revision. */
  dirty: boolean;
  open: number;
  answered: number;
  accepted: number;
}

export class OpenThreadsError extends Error {
  constructor(readonly ids: string[]) {
    super(`Threads still open: ${ids.join(", ")}`);
    this.name = "OpenThreadsError";
  }
}

export function now(): string {
  return new Date().toISOString();
}

export async function ensureInitialized(store: ReviewStore): Promise<Meta> {
  const existing = await store.readMeta();
  if (existing) return existing;
  const text = await store.readDocument();
  await store.writeRevision(1, text);
  const meta: Meta = { docPath: store.docPath, revision: 1, approved: false, revisions: { "1": { at: now() } } };
  await store.writeMeta(meta);
  return meta;
}

async function requireMeta(store: ReviewStore): Promise<Meta> {
  const meta = await store.readMeta();
  if (!meta) throw new Error(`No review data for ${store.docPath}; open the document in Spec Review first`);
  return meta;
}

async function requireThread(store: ReviewStore, id: string): Promise<Thread> {
  const t = await store.readThread(id);
  if (!t) throw new Error(`No thread ${id}`);
  return t;
}

export async function addThread(store: ReviewStore, text: string, anchor?: Anchor): Promise<Thread> {
  // The first comment is what creates the review data; opening the panel alone writes nothing.
  await ensureInitialized(store);
  const at = now();
  const thread: Thread = { id: newId(), createdAt: at, state: "open", anchor, messages: [{ author: "user", at, text }] };
  await store.writeThread(thread);
  return thread;
}

export async function replyAsUser(store: ReviewStore, id: string, text: string): Promise<Thread> {
  const t = await requireThread(store, id);
  t.messages.push({ author: "user", at: now(), text });
  t.state = "open";
  await store.writeThread(t);
  return t;
}

export async function replyAsAgent(store: ReviewStore, id: string, verdict: Verdict, text: string): Promise<Thread> {
  if (verdict === "declined" && text.trim() === "") throw new Error("A declined comment needs an explanation");
  const t = await requireThread(store, id);
  t.messages.push({ author: "agent", at: now(), text, verdict });
  t.state = "answered";
  await store.writeThread(t);
  return t;
}

export async function acceptThread(store: ReviewStore, id: string): Promise<Thread> {
  const t = await requireThread(store, id);
  t.state = "accepted";
  await store.writeThread(t);
  return t;
}

/** The reviewer is not satisfied after all: the thread waits for the agent again. */
export async function reopenThread(store: ReviewStore, id: string): Promise<Thread> {
  const t = await requireThread(store, id);
  t.state = "open";
  await store.writeThread(t);
  return t;
}

/** Forget everything about the document: revisions, threads, viewed marks. Nothing is written until the next comment.
 * Parent directories that become empty are removed too, up to and including `.spec-review` itself. */
export async function resetReview(store: ReviewStore): Promise<void> {
  await rm(store.dir, { recursive: true, force: true });
  let dir = dirname(store.dir);
  for (;;) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    if (entries.length > 0) return;
    await rmdir(dir);
    if (basename(dir) === REVIEW_DIR) return;
    dir = dirname(dir);
  }
}

export async function setApproved(store: ReviewStore, approved: boolean): Promise<void> {
  const meta = await requireMeta(store);
  meta.approved = approved;
  await store.writeMeta(meta);
}

/** Snapshot the document as the next revision. Refuses while any thread is open, so the agent cannot skip a comment. */
export async function finishRound(store: ReviewStore, summary?: string): Promise<{ revision: number; created: boolean }> {
  const meta = await requireMeta(store);
  const open = (await store.listThreads()).filter((t) => t.state === "open").map((t) => t.id);
  if (open.length > 0) throw new OpenThreadsError(open);
  const text = await store.readDocument();
  if (text === (await store.readRevision(meta.revision))) return { revision: meta.revision, created: false };
  const revision = meta.revision + 1;
  await store.writeRevision(revision, text);
  meta.revision = revision;
  meta.revisions[String(revision)] = summary ? { at: now(), summary } : { at: now() };
  await store.writeMeta(meta);
  return { revision, created: true };
}

export async function reviewStatus(store: ReviewStore): Promise<Status> {
  const meta = await requireMeta(store);
  const threads = await store.listThreads();
  const count = (state: Thread["state"]) => threads.filter((t) => t.state === state).length;
  const dirty = (await store.readDocument()) !== (await store.readRevision(meta.revision));
  return { revision: meta.revision, approved: meta.approved, dirty, open: count("open"), answered: count("answered"), accepted: count("accepted") };
}
