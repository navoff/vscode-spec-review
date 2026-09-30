import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { findReviewRoot, reviewDir } from "./paths.js";
import type { Meta, Thread, Viewed } from "./types.js";

export class CorruptFileError extends Error {
  constructor(
    readonly file: string,
    cause?: unknown,
  ) {
    super(`Review data file is not valid JSON: ${file}`, { cause });
    this.name = "CorruptFileError";
  }
}

function isEnoent(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "ENOENT";
}

async function readJson<T>(file: string): Promise<T | undefined> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (e) {
    if (isEnoent(e)) return undefined;
    throw e;
  }
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    throw new CorruptFileError(file, e);
  }
}

/** Write to a temporary file in the same directory and rename, so a reader never sees a partial file. */
async function atomicWrite(file: string, text: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, file);
}

/** Refuse to overwrite a file that exists but cannot be parsed: a human wrote it, a human should look. */
async function guardCorrupt(file: string): Promise<void> {
  await readJson(file);
}

export class ReviewStore {
  private constructor(
    readonly docPath: string,
    readonly dir: string,
  ) {}

  static async open(docPath: string): Promise<ReviewStore> {
    const abs = resolve(docPath);
    const root = await findReviewRoot(abs);
    return new ReviewStore(abs, reviewDir(root, abs));
  }

  get metaFile(): string {
    return join(this.dir, "meta.json");
  }
  get threadsDir(): string {
    return join(this.dir, "threads");
  }
  get viewedFile(): string {
    return join(this.dir, "viewed.json");
  }
  revisionFile(n: number): string {
    return join(this.dir, "revisions", `${String(n).padStart(4, "0")}.md`);
  }
  threadFile(id: string): string {
    return join(this.threadsDir, `${id}.json`);
  }

  readDocument(): Promise<string> {
    return readFile(this.docPath, "utf8");
  }

  readMeta(): Promise<Meta | undefined> {
    return readJson<Meta>(this.metaFile);
  }
  async writeMeta(meta: Meta): Promise<void> {
    await guardCorrupt(this.metaFile);
    await atomicWrite(this.metaFile, JSON.stringify(meta, null, 2) + "\n");
  }

  readThread(id: string): Promise<Thread | undefined> {
    return readJson<Thread>(this.threadFile(id));
  }
  async listThreads(): Promise<Thread[]> {
    let names: string[];
    try {
      names = await readdir(this.threadsDir);
    } catch (e) {
      if (isEnoent(e)) return [];
      throw e;
    }
    const threads: Thread[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const t = await readJson<Thread>(join(this.threadsDir, name));
      if (t) threads.push(t);
    }
    return threads.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }
  async writeThread(thread: Thread): Promise<void> {
    await guardCorrupt(this.threadFile(thread.id));
    await atomicWrite(this.threadFile(thread.id), JSON.stringify(thread, null, 2) + "\n");
  }

  readRevision(n: number): Promise<string> {
    return readFile(this.revisionFile(n), "utf8");
  }
  writeRevision(n: number, text: string): Promise<void> {
    return atomicWrite(this.revisionFile(n), text);
  }

  async readViewed(): Promise<Viewed> {
    return (await readJson<Viewed>(this.viewedFile)) ?? { revision: 0, sections: [] };
  }
  async writeViewed(viewed: Viewed): Promise<void> {
    await guardCorrupt(this.viewedFile);
    await atomicWrite(this.viewedFile, JSON.stringify(viewed, null, 2) + "\n");
  }
}
