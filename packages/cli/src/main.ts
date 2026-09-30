import { parseArgs } from "node:util";
import {
  CorruptFileError,
  OpenThreadsError,
  ReviewStore,
  finishRound,
  relocate,
  replyAsAgent,
  reviewStatus,
  type Thread,
  type Verdict,
} from "@spec-review/core";

const USAGE = `Usage:
  spec-review list   <doc.md> [--all]
  spec-review reply  <doc.md> <thread-id> --verdict fixed|declined|question --message "..."
  spec-review finish <doc.md> [--summary "..."]
  spec-review status <doc.md>`;

class UsageError extends Error {}

async function openStore(doc: string | undefined): Promise<ReviewStore> {
  if (!doc) throw new UsageError("Missing document path");
  const store = await ReviewStore.open(doc);
  if (!(await store.readMeta())) throw new Error(`No review data for ${store.docPath}; open the document in Spec Review first`);
  return store;
}

/** A thread as the agent needs to see it: where it is now, not where it was written. */
function describe(t: Thread, text: string) {
  const where = t.anchor ? relocate(t.anchor, text) : undefined;
  return {
    id: t.id,
    state: t.state,
    section: t.anchor?.section ?? "",
    lines: where ? [where.startLine, where.endLine] : null,
    outdated: Boolean(t.anchor) && !where,
    quote: t.anchor?.quote ?? "",
    messages: t.messages,
  };
}

async function list(doc: string | undefined, all: boolean): Promise<void> {
  const store = await openStore(doc);
  const meta = (await store.readMeta())!;
  const text = await store.readDocument();
  const threads = (await store.listThreads()).filter((t) => all || t.state === "open");
  console.log(JSON.stringify({ revision: meta.revision, threads: threads.map((t) => describe(t, text)) }, null, 2));
}

async function reply(doc: string | undefined, id: string | undefined, verdict: string | undefined, message: string | undefined): Promise<void> {
  if (!id) throw new UsageError("Missing thread id");
  if (verdict !== "fixed" && verdict !== "declined" && verdict !== "question") throw new UsageError("--verdict must be fixed, declined or question");
  const store = await openStore(doc);
  const t = await replyAsAgent(store, id, verdict as Verdict, message ?? "");
  console.log(`thread ${t.id} ${t.state} (${verdict})`);
}

async function finish(doc: string | undefined, summary: string | undefined): Promise<void> {
  const store = await openStore(doc);
  const r = await finishRound(store, summary);
  console.log(`revision ${r.revision} ${r.created ? "created" : "unchanged"}`);
}

async function status(doc: string | undefined): Promise<void> {
  console.log(JSON.stringify(await reviewStatus(await openStore(doc)), null, 2));
}

async function main(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      all: { type: "boolean" },
      verdict: { type: "string" },
      message: { type: "string" },
      summary: { type: "string" },
    },
  });
  const [command, doc, id] = positionals;
  switch (command) {
    case "list":
      return list(doc, Boolean(values.all));
    case "reply":
      return reply(doc, id, values.verdict, values.message);
    case "finish":
      return finish(doc, values.summary);
    case "status":
      return status(doc);
    default:
      throw new UsageError(`Unknown command: ${command ?? "(none)"}`);
  }
}

main(process.argv.slice(2)).then(
  () => process.exit(0),
  (e: unknown) => {
    if (e instanceof OpenThreadsError) {
      console.error(`Cannot finish: threads still open: ${e.ids.join(", ")}. Reply to each with spec-review reply.`);
      process.exit(2);
    }
    if (e instanceof UsageError) {
      console.error(`${e.message}\n${USAGE}`);
      process.exit(1);
    }
    if (e instanceof CorruptFileError) {
      console.error(`${e.message}. Fix or remove the file by hand; nothing was written.`);
      process.exit(1);
    }
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  },
);
