import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { readyDb } from '../db';
import { posts } from '../db/schema';
import { normaliseLang } from '../highlight';
import { nanoid } from '../ids';
import { parseBody, serializeBody, type Block } from '../blocks';
import {
  fieldsFromForm,
  formToProps,
  parseArtifactProps,
  type ArtifactKind,
} from '../artifact-props';
import { publishRevision } from './posts';

/**
 * Drafts: the editor's work-in-progress.
 *
 * Revisions are immutable history, so the editor needs somewhere that is
 * explicitly *not* history. `posts.draft_body` holds {title, dek, blocks},
 * written on every save and cleared on publish. One draft per post, owned by
 * the post's author, never rendered to readers — the only readers of a draft
 * are the editor page and publish, and both check ownership first.
 */

const draftSchema = z.object({
  title: z.string().trim().min(1, 'A post needs a title.').max(200),
  dek: z.string().trim().max(500).default(''),
  blocks: z.array(z.custom<Block>((b) => b !== null && typeof b === 'object')).min(1, 'A post needs at least one block.'),
});

export interface DraftDoc {
  title: string;
  dek: string;
  blocks: Block[];
}

export async function getDraft(postId: string, authorId: string): Promise<DraftDoc | null> {
  const database = await readyDb();
  const [row] = await database
    .select({ draftBody: posts.draftBody, authorId: posts.authorId })
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1);
  if (!row || row.authorId !== authorId) return null;
  if (!row.draftBody) return null;
  try {
    const parsed = draftSchema.parse(JSON.parse(row.draftBody));
    return { title: parsed.title, dek: parsed.dek, blocks: parseBody(serializeBody(parsed.blocks as Block[])) };
  } catch {
    return null;
  }
}

/** Seed a draft from the current published version, for a first edit. */
export async function draftFromPublished(postId: string, authorId: string): Promise<DraftDoc | null> {
  const database = await readyDb();
  const [row] = await database
    .select({ title: posts.title, dek: posts.dek, authorId: posts.authorId, currentVersionId: posts.currentVersionId })
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1);
  if (!row || row.authorId !== authorId || !row.currentVersionId) return null;
  const { getPostById } = await import('./posts');
  const post = await getPostById(postId);
  if (!post) return null;
  return { title: post.title, dek: post.dek, blocks: post.blocks };
}

export async function saveDraft(
  postId: string,
  authorId: string,
  doc: { title: string; dek: string; blocks: Block[] },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = draftSchema.safeParse(doc);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'That draft did not look right.' };
  }
  const database = await readyDb();
  const [own] = await database.select({ id: posts.id }).from(posts).where(and(eq(posts.id, postId), eq(posts.authorId, authorId))).limit(1);
  if (!own) return { ok: false, error: 'That post is not yours.' };
  await database
    .update(posts)
    .set({ draftBody: JSON.stringify({ title: parsed.data.title, dek: parsed.data.dek, blocks: parsed.data.blocks }), updatedAt: Date.now() })
    .where(eq(posts.id, postId));
  return { ok: true };
}

/** Publish the draft as a new revision. Requires a change summary — "fixed
 *  the benchmark" is the whole point of the history, and a revision without
 *  one is a gap in the record, not a convenience. */
export async function publishDraft(
  postId: string,
  authorId: string,
  changeSummary: string,
  isMajor: boolean,
): Promise<{ ok: true; versionNumber: number; slug: string } | { ok: false; error: string }> {
  const clean = changeSummary.trim();
  if (clean.length < 10) {
    return { ok: false, error: 'Say what changed, in at least a sentence. Future readers — and you — will thank you.' };
  }
  const database = await readyDb();
  const [row] = await database
    .select({ slug: posts.slug, title: posts.title, dek: posts.dek, authorId: posts.authorId, draftBody: posts.draftBody })
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1);
  if (!row || row.authorId !== authorId) return { ok: false, error: 'That post is not yours.' };
  if (!row.draftBody) return { ok: false, error: 'Nothing to publish — save the draft first.' };

  let doc: DraftDoc;
  try {
    doc = draftSchema.parse(JSON.parse(row.draftBody));
  } catch {
    return { ok: false, error: 'The draft is damaged. Re-save it from the editor.' };
  }

  const published = await publishRevision({
    postId,
    authorId,
    body: doc.blocks as Block[],
    changeSummary: clean,
    isMajor,
  });
  await database
    .update(posts)
    .set({ title: doc.title, dek: doc.dek, draftBody: null, updatedAt: Date.now() })
    .where(eq(posts.id, postId));
  return { ok: true, versionNumber: published.versionNumber, slug: row.slug };
}

/**
 * Fold one editor save over the base blocks.
 *
 * The form carries one row per block: id, order, layer, a delete flag, and
 * type-specific fields. Structural kinds the editor does not render (tables,
 * figures, interactives) ride through untouched from the base — preserved
 * verbatim, never re-parsed, so the editor cannot corrupt what it cannot show.
 * Unknown ids in the form are ignored rather than appended: the form describes
 * edits to known blocks, and anything else is either stale or forged.
 */export function applyEditorForm(
  base: { title: string; dek: string; blocks: Block[] },
  form: Record<string, string>,
): { title: string; dek: string; blocks: Block[] } {
  const count = Math.min(500, Math.max(0, Number.parseInt(form.count ?? '0', 10) || 0));
  const byId = new Map(base.blocks.map((b) => [b.id, b]));
  const out: Array<{ order: number; block: Block }> = [];

  for (let i = 0; i < count; i++) {
    const id = (form[`b_${i}_id`] ?? '').trim();
    if (!id) continue;
    const prev = byId.get(id);
    if (!prev) continue;
    if (form[`b_${i}_del`] === '1') continue;

    const order = Number.parseInt(form[`b_${i}_order`] ?? String(i), 10);
    const layerRaw = form[`b_${i}_layer`];
    const layer = layerRaw === 'core' || layerRaw === 'understand' || layerRaw === 'master'
      ? layerRaw
      : prev.layer;
    const num = Number.isFinite(order) ? order : i;

    let next: Block = prev;
    switch (prev.type) {
      case 'paragraph':
        next = { ...prev, text: (form[`b_${i}_text`] ?? '').slice(0, 20000), layer };
        break;
      case 'tldr':
        // TL;DR is core by schema; its layer is not editable.
        next = { ...prev, text: (form[`b_${i}_text`] ?? '').slice(0, 20000) };
        break;
      case 'heading': {
        const level = form[`b_${i}_level`] === '3' ? 3 : 2;
        next = { ...prev, level, text: (form[`b_${i}_text`] ?? '').slice(0, 500), layer };
        break;
      }
      case 'quote':
        next = {
          ...prev,
          text: (form[`b_${i}_text`] ?? '').slice(0, 20000),
          attribution: (form[`b_${i}_attr`] ?? '').slice(0, 200),
          layer,
        };
        break;
      case 'callout': {
        const tone = form[`b_${i}_tone`];
        next = {
          ...prev,
          title: (form[`b_${i}_ctitle`] ?? '').slice(0, 300),
          text: (form[`b_${i}_text`] ?? '').slice(0, 20000),
          tone: tone === 'warn' || tone === 'correction' ? tone : 'note',
          layer,
        };
        break;
      }
      case 'code':
        next = {
          ...prev,
          // Normalised on the way in, so the stored language is canonical:
          // 'ts', 'TS' and 'TypeScript' would otherwise all be the same
          // language with three spellings, and the highlighter's own
          // unknown-language fallback would hide a typo nobody could see.
          lang: normaliseLang((form[`b_${i}_lang`] ?? 'text').slice(0, 40)),
          code: (form[`b_${i}_code`] ?? '').slice(0, 60000),
          caption: (form[`b_${i}_caption`] ?? '').slice(0, 300),
          layer,
        };
        break;
      case 'list': {
        const items = (form[`b_${i}_items`] ?? '')
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 200);
        next = { ...prev, items: items.length > 0 ? items : prev.items, layer };
        break;
      }
      case 'primer':
        next = {
          ...prev,
          term: (form[`b_${i}_term`] ?? '').slice(0, 200),
          text: (form[`b_${i}_text`] ?? '').slice(0, 20000),
        };
        break;
      case 'interactive': {
        /* Read the builder's cells, not a JSON blob the browser assembled. The
           coercion lives on the server, once, so it cannot drift from the form
           that produces it; the client's only job is to keep the cells' names in
           step with their order on screen. */
        const chosen = (form[`b_${i}_component`] ?? 'curve') as string;
        const kind = (ARTIFACT_COMPONENTS as readonly string[]).includes(chosen)
          ? (chosen as ArtifactKind)
          : 'curve';
        next = {
          ...prev,
          component: kind,
          title: (form[`b_${i}_ctitle`] ?? '').slice(0, 300),
          props: formToProps(kind, fieldsFromForm(`b_${i}`, form)),
          layer,
        };
        break;
      }
      default:
        next = { ...prev, layer };
        break;
    }
    out.push({ order: num, block: next });
  }

  out.sort((a, b) => a.order - b.order);
  return {
    title: (form.title ?? base.title).trim().slice(0, 200) || base.title,
    dek: (form.dek ?? base.dek).trim().slice(0, 500),
    blocks: out.map((o) => o.block),
  };
}

const ARTIFACT_COMPONENTS = ['curve', 'breakdown', 'matrix', 'timeline'] as const;

/**
 * Artifact props are authored as JSON by the writer, so they are validated even
 * though the writer is the author of the post.
 *
 * The rules themselves moved to `lib/artifact-props.ts`, next to the per-component
 * field table the authoring form is generated from, because the validator and the
 * form have to describe the same shape — and they did not. The rule here used to
 * accept scalars and flat arrays of scalars only, on the reasoning that nothing
 * `Artifact.astro` reads is deeper. `matrixCases()` reads `cases` and
 * `timelineEvents()` reads `events`, both arrays of objects, so both were dropped
 * on save: opening a post with a matrix or timeline figure and pressing "Save
 * draft" emptied it. The payload cap stays; the nesting rule is now "one level,
 * values scalar", which is what the renderer actually reads.
 */
export function parseArtifactPropsForTest(raw: string | undefined, component: string): Record<string, unknown> {
  void component;
  return parseArtifactProps(raw);
}

export function blankBlock(type: 'paragraph' | 'heading' | 'quote' | 'code' | 'list' | 'callout' | 'interactive'): Block {
  const id = nanoid();
  switch (type) {
    case 'heading':
      return { id, type: 'heading', level: 2, text: '', layer: 'core' };
    case 'quote':
      return { id, type: 'quote', text: '', attribution: '', layer: 'understand' };
    case 'code':
      return { id, type: 'code', lang: 'text', code: '', caption: '', runnable: false, layer: 'master' };
    case 'list':
      return { id, type: 'list', ordered: false, items: [''], layer: 'understand' };
    case 'interactive':
      // Seeded with an example payload rather than `{}` because an artifact with
      // no data renders an empty box, and a writer who cannot tell that their
      // JSON failed has no way to learn the shape.
      return {
        id,
        type: 'interactive',
        component: 'curve',
        title: '',
        props: { label: 'p50', points: '1,2,3' },
        layer: 'master',
      };
    case 'callout':
      return { id, type: 'callout', tone: 'note', title: '', text: '', layer: 'understand' };
    default:
      return { id, type: 'paragraph', text: '', layer: 'understand' };
  }
}

type EditorInput =
  | { action: 'save-draft'; postId: string; count: number }
  | { action: 'add-block'; postId: string; blockType: 'paragraph' | 'heading' | 'quote' | 'code' | 'list' | 'callout' }
  | { action: 'publish'; postId: string; changeSummary: string; isMajor?: string };
/**
 * The three editor mutations, sharing one ownership check.
 *
 * Returns either an error to show, a redirect to the published diff, or
 * nothing — in which case the caller re-renders the editor with a saved flag.
 * Every path re-checks that the post belongs to the caller, because the form
 * is attacker-supplied and a postId in it proves nothing.
 */
export async function applyEditorAction(
  input: EditorInput,
  fields: Record<string, string>,
  authorId: string,
): Promise<{ ok: true; redirectTo?: string } | { ok: false; error: string }> {
  const database = await readyDb();
  const [own] = await database
    .select({ id: posts.id, slug: posts.slug })
    .from(posts)
    .where(and(eq(posts.id, input.postId), eq(posts.authorId, authorId)))
    .limit(1);
  if (!own) return { ok: false, error: 'That post is not yours.' };

  const base = (await getDraft(input.postId, authorId)) ?? (await draftFromPublished(input.postId, authorId));
  if (!base) return { ok: false, error: 'That post could not be loaded.' };

  if (input.action === 'add-block') {
    const saved = await saveDraft(input.postId, authorId, {
      title: base.title,
      dek: base.dek,
      blocks: [...base.blocks, blankBlock(input.blockType)],
    });
    return saved.ok ? { ok: true } : saved;
  }

  if (input.action === 'save-draft') {
    const next = applyEditorForm(base, fields);
    const saved = await saveDraft(input.postId, authorId, next);
    return saved.ok ? { ok: true } : saved;
  }

  const published = await publishDraft(input.postId, authorId, input.changeSummary, input.isMajor === '1');
  if (!published.ok) return published;
  return { ok: true, redirectTo: `/w/${published.slug}?rev=${published.versionNumber}` };
}
