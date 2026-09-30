import { ReviewStore, changedSections, diffRevisions, parseDocument, type Viewed } from "@spec-review/core";

/** Bring viewed.json up to the latest revision. A section keeps its mark only if it did not
 * change in any revision since the mark was made, like GitHub's "viewed" checkbox resets on a new commit. */
export async function syncViewed(store: ReviewStore): Promise<Viewed> {
  const meta = await store.readMeta();
  if (!meta) return { revision: 0, sections: [] };
  let viewed = await store.readViewed();
  if (viewed.revision === 0) viewed = { revision: meta.revision, sections: [] };
  if (viewed.revision >= meta.revision) return viewed;
  let text = await store.readRevision(viewed.revision);
  for (let r = viewed.revision + 1; r <= meta.revision; r++) {
    const next = await store.readRevision(r);
    const changed = new Set(changedSections(parseDocument(next).sections, diffRevisions(text, next)));
    viewed = { revision: r, sections: viewed.sections.filter((s) => !changed.has(s)) };
    text = next;
  }
  await store.writeViewed(viewed);
  return viewed;
}
