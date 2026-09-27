/**
 * Marginalia.
 *
 * Two rules govern everything here:
 *
 *  1. A note stores the quoted text with its surrounding context, not a bare
 *     character offset. Offsets break silently on the first revision.
 *  2. A note is pinned to the version it was written against. If the sentence
 *     it argues with has changed, the note says so and links to the version it
 *     belongs to — it never silently re-attaches to different prose.
 */

import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { readyDb } from '../db';
import { annotations, annotationReactions, users } from '../db/schema';
import { nanoid } from '../ids';
import {
  AUTHOR_ONLY_KINDS,
  type Annotation,
  type AnnotationKind,
} from '../db/schema';

export type { Annotation, AnnotationKind };

/* -------------------------------------------------------------------------- */
/* Anchors                                                                     */
/* -------------------------------------------------------------------------- */

export interface Anchor {
  blockId: string;
  start: number;
  end: number;
  quote: string;
  prefix: string;
  suffix: string;
}

const CONTEXT = 64;

export function makeAnchor(blockId: string, text: string, start: number, end: number): Anchor {
  const quote = text.slice(start, end);
  return {
    blockId,
    start,
    end,
    quote,
    prefix: text.slice(Math.max(0, start - CONTEXT), start),
    suffix: text.slice(end, end + CONTEXT),
  };
}

export type AnchorStatus =
  /** Offsets still line up. Nothing happened to this sentence. */
  | 'exact'
  /** Found again at a different offset. The block was edited around it. */
  | 'moved'
  /** The sentence is gone from this block entirely. */
  | 'lost';

export interface ResolvedAnchor {
  status: AnchorStatus;
  start: number;
  end: number;
}

export function resolveAnchor(anchor: Anchor, text: string): ResolvedAnchor {
  const { quote, prefix, suffix, start, end } = anchor;
  if (!quote) return { status: 'lost', start: 0, end: 0 };

  // 1. Offsets still valid.
  if (start >= 0 && end <= text.length && text.slice(start, end) === quote) {
    return { status: 'exact', start, end };
  }

  // 2. Somewhere else in the block.
  const haystack = text;
  const hits: number[] = [];
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(quote, from);
    if (at === -1) break;
    hits.push(at);
    from = at + 1;
  }
  if (hits.length === 0) return { status: 'lost', start: 0, end: 0 };

  // 3. More than one copy of the quote — disambiguate with context. This is why
  //    prefix/suffix are stored at all.
  if (hits.length === 1) {
    return { status: 'moved', start: hits[0]!, end: hits[0]! + quote.length };
  }

  const scored = hits
    .map((at) => {
      const before = text.slice(Math.max(0, at - prefix.length), at);
      const after = text.slice(at + quote.length, at + quote.length + suffix.length);
      let score = 0;
      for (let i = 1; i <= Math.min(before.length, prefix.length); i++) {
        if (prefix[prefix.length - i] === before[before.length - i]) score++;
        else break;
      }
      for (let i = 0; i < Math.min(after.length, suffix.length); i++) {
        if (suffix[i] === after[i]) score++;
        else break;
      }
      return { at, score };
    })
    .sort((a, b) => b.score - a.score);

  return {
    status: 'moved',
    start: scored[0]!.at,
    end: scored[0]!.at + quote.length,
  };
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export interface AnnotationView {
  id: string;
  postId: string;
  blockId: string;
  kind: AnnotationKind;
  body: string;
  anchor: Anchor;
  /** Where the anchor currently resolves in the *current* version. */
  resolved: ResolvedAnchor;
  /** Pinned to an older revision and the sentence is still present. */
  onOlderRevision: boolean;
  isAccepted: boolean;
  isResolved: boolean;
  isPrivate: boolean;
  createdAt: number;
  editedAt: number | null;
  parentId: string | null;
  authorId: string | null;
  authorName: string;
  authorHandle: string | null;
  isAuthor: boolean;
  isMine: boolean;
  /** The revision this note was written against — not the current one. */
  versionNumber: number;
  reactions: { useful: number; insightful: number; source: number };
  replies: number;
}

const reactionCounts = sql<Record<string, number>>`
  (select coalesce(json_group_object(kind, n), '{}') from (
     select kind, count(*) as n from annotation_reactions
     where annotation_id = ${annotations.id} group by kind
   ))`;

const replyCounts = sql<number>`
  (select count(*) from annotations r
   where r.parent_id = ${annotations.id} and r.status = 'visible')`;

/**
 * All public notes on a post, newest first, with anchors resolved against the
 * given block texts. Replies are attached to their parent in the caller.
 */
export async function listAnnotations(
  postId: string,
  blockTexts: Map<string, string>,
  opts: { anonId?: string | null; authorId?: string | null; currentVersionId: string } = { currentVersionId: '' },
): Promise<AnnotationView[]> {
  const database = await readyDb();
  const rows = await database
    .select({
      note: annotations,
      authorHandle: users.handle,
      authorName: users.displayName,
      // The version the note is *pinned* to, which is not the current one once
      // the post has been revised. Getting this wrong tells a reader the note
      // argues with the version it is currently shown alongside.
      pinnedVersion: sql<number>`(
        select version_number from post_versions pv where pv.id = ${annotations.versionId}
      )`,
      reactions: reactionCounts,
      replies: replyCounts,
    })
    .from(annotations)
    .leftJoin(users, eq(annotations.authorId, users.id))
    .where(
      and(
        eq(annotations.postId, postId),
        eq(annotations.status, 'visible'),
        eq(annotations.isPrivate, false),
      ),
    )
    .orderBy(asc(annotations.createdAt));

  return rows
    .map((row) => {
      const parsed = safeAnchor(row.note.anchor);
      const text = blockTexts.get(row.note.blockId) ?? '';
      const resolved = parsed ? resolveAnchor(parsed, text) : { status: 'lost' as const, start: 0, end: 0 };
      const isAuthor = Boolean(row.note.authorId && row.note.authorId === opts.authorId);
      const isAuthorOnly = AUTHOR_ONLY_KINDS.includes(row.note.kind as AnnotationKind);

      return {
        id: row.note.id,
        postId: row.note.postId,
        blockId: row.note.blockId,
        kind: row.note.kind as AnnotationKind,
        body: row.note.body,
        anchor: parsed ?? { blockId: row.note.blockId, start: 0, end: 0, quote: '', prefix: '', suffix: '' },
        resolved,
        onOlderRevision:
          row.note.versionId !== opts.currentVersionId && resolved.status !== 'lost',
        isAccepted: row.note.isAccepted,
        isResolved: row.note.isResolved,
        isPrivate: row.note.isPrivate,
        createdAt: row.note.createdAt,
        editedAt: row.note.editedAt,
        parentId: row.note.parentId,
        authorId: row.note.authorId,
        // An author-only note is only ever shown when attributed to someone, so
        // an unattributed author_note is treated as a plain comment.
        authorName: isAuthorOnly && !row.note.authorId ? 'Anonymous' : (row.authorName ?? row.note.guestName ?? 'Anonymous'),
        authorHandle: row.authorHandle,
        isAuthor,
        isMine: Boolean(
          (row.note.authorId && opts.authorId && row.note.authorId === opts.authorId) ||
            (row.note.anonId && opts.anonId && row.note.anonId === opts.anonId),
        ),
        versionNumber: Number(row.pinnedVersion ?? 1),
        reactions: { useful: 0, insightful: 0, source: 0, ...(row.reactions ?? {}) },
        replies: Number(row.replies ?? 0),
      } satisfies AnnotationView;
    })
    .filter((n) => {
      // Author-only notes are not public; they belong to the author's channel.
      if (AUTHOR_ONLY_KINDS.includes(n.kind) && !n.isAuthor) return false;
      return true;
    });
}

function safeAnchor(json: string): Anchor | null {
  try {
    const parsed = JSON.parse(json) as Partial<Anchor>;
    if (typeof parsed.quote !== 'string' || typeof parsed.blockId !== 'string') return null;
    return {
      blockId: parsed.blockId,
      start: parsed.start ?? 0,
      end: parsed.end ?? 0,
      quote: parsed.quote,
      prefix: parsed.prefix ?? '',
      suffix: parsed.suffix ?? '',
    };
  } catch {
    return null;
  }
}

export async function getAnnotation(id: string) {
  const database = await readyDb();
  const rows = await database
    .select()
    .from(annotations)
    .where(eq(annotations.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export interface CreateAnnotationInput {
  postId: string;
  versionId: string;
  blockId: string;
  anchor: Anchor;
  body: string;
  kind: AnnotationKind;
  anonId?: string | null;
  authorId?: string | null;
  guestName?: string | null;
  parentId?: string | null;
  isPrivate?: boolean;
}

export async function createAnnotation(input: CreateAnnotationInput): Promise<Annotation> {
  const database = await readyDb();
  const row: typeof annotations.$inferInsert = {
    id: nanoid(),
    postId: input.postId,
    versionId: input.versionId,
    blockId: input.blockId,
    anchor: JSON.stringify(input.anchor),
    body: input.body,
    kind: input.kind,
    parentId: input.parentId ?? null,
    authorId: input.authorId ?? null,
    anonId: input.anonId ?? null,
    guestName: input.guestName ?? null,
    isPrivate: input.isPrivate ?? false,
    createdAt: Date.now(),
  };
  await database.insert(annotations).values(row);
  return row as Annotation;
}

export async function editAnnotation(id: string, body: string, authorId: string | null, anonId: string) {
  const database = await readyDb();
  const existing = await getAnnotation(id);
  if (!existing) return false;
  const mine =
    (authorId && existing.authorId === authorId) || (!authorId && existing.anonId === anonId);
  if (!mine) return false;
  await database
    .update(annotations)
    .set({ body, editedAt: Date.now() })
    .where(eq(annotations.id, id));
  return true;
}

export async function deleteAnnotation(id: string, opts: { authorId?: string | null; anonId?: string }) {
  const database = await readyDb();
  const existing = await getAnnotation(id);
  if (!existing) return false;
  const mine =
    (opts.authorId && existing.authorId === opts.authorId) ||
    (!opts.authorId && existing.anonId === opts.anonId);
  if (!mine) return false;
  // Soft delete: a thread someone else replied to should not vanish.
  await database
    .update(annotations)
    .set({ status: 'deleted' })
    .where(eq(annotations.id, id));
  return true;
}

/** Author accepts a note; it is folded into the post's history as an amendment.
 *
 *  Authorization is the caller's job, because only the caller knows which post
 *  the note belongs to. This used to re-check `note.authorId === postAuthorId`,
 *  which is the wrong question entirely: it asked whether the *note's* author is
 *  the *post's* author, so the only note an author could ever accept was one of
 *  their own — precisely the case acceptance exists to exclude. */
export async function acceptAnnotation(id: string) {
  const database = await readyDb();
  const note = await getAnnotation(id);
  if (!note) return false;
  await database.update(annotations).set({ isAccepted: true, isResolved: true }).where(eq(annotations.id, id));
  return true;
}

/** A reply to an existing note.
 *
 *  The reply inherits its parent's anchor rather than carrying one of its own.
 *  A reply is a response to that specific sentence, not a fresh claim about the
 *  post, and a second anchor would let a thread drift away from the prose it is
 *  arguing about — which is the one thing the margin rail exists to prevent. */
export async function replyToAnnotation(input: {
  parentId: string;
  body: string;
  anonId: string;
  authorId: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const parent = await getAnnotation(input.parentId);
  if (!parent || parent.status !== 'visible') {
    return { ok: false, error: 'The note you replied to is gone.' };
  }
  const anchor = safeAnchor(parent.anchor);
  if (!anchor) {
    return { ok: false, error: 'That note has lost its anchor, so it cannot be replied to.' };
  }
  const created = await createAnnotation({
    postId: parent.postId,
    versionId: parent.versionId,
    blockId: parent.blockId,
    anchor,
    body: input.body,
    kind: 'comment',
    anonId: input.anonId,
    authorId: input.authorId,
    parentId: input.parentId,
  });
  return { ok: true, id: created.id };
}

/** A stable key for whoever is reacting: the claimed account if there is one,
 *  otherwise this browser's anonymous id. */
export function voterKeyFor(authorId: string | null, anonId: string): string {
  return authorId ? `u:${authorId}` : `a:${anonId}`;
}

export async function toggleReaction(
  annotationId: string,
  voterKey: string,
  kind: 'useful' | 'insightful' | 'source',
) {
  const database = await readyDb();
  const existing = await database
    .select()
    .from(annotationReactions)
    .where(
      and(
        eq(annotationReactions.annotationId, annotationId),
        eq(annotationReactions.voterKey, voterKey),
        eq(annotationReactions.kind, kind),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    await database
      .delete(annotationReactions)
      .where(
        and(
          eq(annotationReactions.annotationId, annotationId),
          eq(annotationReactions.voterKey, voterKey),
          eq(annotationReactions.kind, kind),
        ),
      );
    return false;
  }
  await database
    .insert(annotationReactions)
    .values({ annotationId, voterKey, kind })
    .onConflictDoNothing();
  return true;
}

/** Which of the three reactions this reader has already given, per note. */
export async function myReactions(
  voterKey: string,
  noteIds: string[],
): Promise<Set<string>> {
  if (noteIds.length === 0) return new Set();
  const database = await readyDb();
  const rows = await database
    .select({
      annotationId: annotationReactions.annotationId,
      kind: annotationReactions.kind,
    })
    .from(annotationReactions)
    .where(and(eq(annotationReactions.voterKey, voterKey), inArray(annotationReactions.annotationId, noteIds)));
  return new Set(rows.map((r) => `${r.annotationId}:${r.kind}`));
}

/** Attach every anonymous note from this browser to a claimed account. */
export async function claimAnonNotes(anonId: string, authorId: string): Promise<number> {
  const database = await readyDb();
  const before = await database
    .select({ id: annotations.id })
    .from(annotations)
    .where(and(eq(annotations.anonId, anonId), isNull(annotations.authorId)));
  await database
    .update(annotations)
    .set({ authorId })
    .where(and(eq(annotations.anonId, anonId), isNull(annotations.authorId)));
  return before.length;
}

export async function countByPost(postId: string) {
  const database = await readyDb();
  const [row] = await database
    .select({ n: sql<number>`count(*)` })
    .from(annotations)
    .where(
      and(
        eq(annotations.postId, postId),
        eq(annotations.status, 'visible'),
        eq(annotations.isPrivate, false),
      ),
    );
  return Number(row?.n ?? 0);
}

/** Distinct note authors, for the "N people are arguing here" line. */
export async function countParticipants(postId: string) {
  const database = await readyDb();
  const [row] = await database
    .select({ n: sql<number>`count(distinct coalesce(annotations.author_id, annotations.anon_id))` })
    .from(annotations)
    .where(
      and(
        eq(annotations.postId, postId),
        eq(annotations.status, 'visible'),
        eq(annotations.isPrivate, false),
      ),
    );
  return Number(row?.n ?? 0);
}

export { or, inArray };
