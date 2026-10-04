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

import { and, asc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import { readyDb } from '../db';
import { annotations, annotationReactions, annotationReports, posts, users } from '../db/schema';
import { nanoid } from '../ids';
import { stripInline } from '../inline';
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

const reactionCounts = sql<Record<string, number> | string>`
  (select coalesce(json_group_object(kind, n), '{}') from (
     select kind, count(*) as n from annotation_reactions
     where annotation_id = ${annotations.id} group by kind
   ))`;

/**
 * `json_group_object` comes back from the libsql driver as a *string*, not an
 * object, so spreading it directly yielded `{"0":"{","1":"\"",...}` and every
 * reaction count silently rendered as zero. Types said `Record<string, number>`
 * and were satisfied; only asserting on the rendered value found it.
 */
function parseReactionCounts(
  raw: Record<string, number> | string | null,
): { useful: number; insightful: number; source: number } {
  const empty = { useful: 0, insightful: 0, source: 0 };
  if (raw == null) return empty;
  if (typeof raw === 'object') return { ...empty, ...raw };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed === null || typeof parsed !== 'object') return empty;
    // Only ever expose the three known kinds, each coerced to a number, so a
    // malformed row cannot inject a string into a rendered count.
    return {
      useful: Number(parsed.useful ?? 0) || 0,
      insightful: Number(parsed.insightful ?? 0) || 0,
      source: Number(parsed.source ?? 0) || 0,
    };
  } catch {
    return empty;
  }
}

const replyCounts = sql<number>`
  (select count(*) from annotations r
   where r.parent_id = ${annotations.id} and r.status = 'visible')`;

/** Columns every note listing needs. Shared by the article and publication
 *  scopes so the two views cannot drift apart in what they expose. */
const noteSelect = {
  note: annotations,
  authorHandle: users.handle,
  authorName: users.displayName,
  // The version the note is *pinned* to, which is not the current one once the
  // post has been revised. Getting this wrong tells a reader the note argues
  // with the version it is currently shown alongside.
  pinnedVersion: sql<number | null>`(
    select version_number from post_versions pv where pv.id = ${annotations.versionId}
  )`,
  reactions: reactionCounts,
  replies: replyCounts,
} as const;

type NoteRow = {
  note: typeof annotations.$inferSelect;
  authorHandle: string | null;
  authorName: string | null;
  pinnedVersion: number | null;
  reactions: Record<string, number> | string | null;
  replies: number | null;
};

interface Viewer {
  anonId?: string | null;
  authorId?: string | null;
}

/** Shared mapping from a note row to its public view.
 *
 *  `postId`/`blockId`/`anchor` are nullable in the schema because a note may be
 *  about the publication rather than an article, but an *article* note always
 *  has all three. Callers of this mapper are the two scope listings, which have
 *  already filtered; the narrowing below turns that SQL-level fact into a
 *  type-level one so no consumer has to handle a null it cannot encounter. */
function toView(row: NoteRow, viewer: Viewer): AnnotationView | null {
  const { note } = row;
  // Fails closed on scope. The WHERE clause already excludes these, so this is
  // belt-and-braces: it makes "a publication note never renders in a margin"
  // a property of the mapper, not a fact a future query has to remember.
  if (!note.postId || !note.blockId || !note.anchor) return null;

  const parsed = safeAnchor(note.anchor);
  const isAuthorOnly = AUTHOR_ONLY_KINDS.includes(note.kind as AnnotationKind);

  return {
    id: note.id,
    postId: note.postId,
    blockId: note.blockId,
    kind: note.kind as AnnotationKind,
    body: note.body,
    anchor: parsed ?? { blockId: note.blockId, start: 0, end: 0, quote: '', prefix: '', suffix: '' },
    // Resolution is filled in by the caller, which is the only side that knows
    // what the reader is currently looking at.
    resolved: { status: 'lost' as const, start: 0, end: 0 },
    onOlderRevision: false,
    isAccepted: note.isAccepted,
    isResolved: note.isResolved,
    isPrivate: note.isPrivate,
    createdAt: note.createdAt,
    editedAt: note.editedAt,
    parentId: note.parentId,
    authorId: note.authorId,
    // An author-only note is only ever shown when attributed to someone, so an
    // unattributed author_note is treated as a plain comment.
    authorName: isAuthorOnly && !note.authorId ? 'Anonymous' : (row.authorName ?? note.guestName ?? 'Anonymous'),
    authorHandle: row.authorHandle,
    isAuthor: Boolean(note.authorId && note.authorId === viewer.authorId),
    isMine: Boolean(
      (note.authorId && viewer.authorId && note.authorId === viewer.authorId) ||
        (note.anonId && viewer.anonId && note.anonId === viewer.anonId),
    ),
    versionNumber: Number(row.pinnedVersion ?? 1),
    reactions: parseReactionCounts(row.reactions),
    replies: Number(row.replies ?? 0),
  };
}

/**
 * All public notes on a post, oldest first, with anchors resolved against the
 * given block texts. Replies are attached to their parent in the caller.
 */
export async function listAnnotations(
  postId: string,
  blockTexts: Map<string, string>,
  opts: { anonId?: string | null; authorId?: string | null; currentVersionId: string } = { currentVersionId: '' },
): Promise<AnnotationView[]> {
  const database = await readyDb();
  const rows = await database
    .select(noteSelect)
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
      // Narrow the anchor group before anything parses it. `toView` repeats the
      // check so the guarantee does not depend on this call order, but doing it
      // here keeps the raw JSON in hand for `safeAnchor`, which takes the
      // serialised form, not the resolved object.
      if (!row.note.anchor) return null;
      const view = toView(row, opts);
      if (!view) return null;
      const parsed = safeAnchor(row.note.anchor);
      // Match against what the reader saw, not the stored markup. Anchors are
      // created from rendered selections, so resolving against raw text with
      // `*emphasis*` markers would mark every note on a formatted sentence as
      // lost. See the write path for the same normalization.
      const text = stripInline(blockTexts.get(view.blockId) ?? '');
      const resolved = parsed ? resolveAnchor(parsed, text) : { status: 'lost' as const, start: 0, end: 0 };
      return {
        ...view,
        resolved,
        onOlderRevision: row.note.versionId !== opts.currentVersionId && resolved.status !== 'lost',
      } satisfies AnnotationView;
    })
    .filter((n): n is AnnotationView => n !== null)
    .filter((n) => {
      // Author-only notes are not public; they belong to the author's channel.
      if (AUTHOR_ONLY_KINDS.includes(n.kind) && !n.isAuthor) return false;
      return true;
    });
}

/* -------------------------------------------------------------------------- */
/* Publication scope                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A note about the publication rather than an article.
 *
 * Same table as a marginal note, so threading, reactions, reporting and
 * author-delete all behave identically — that inheritance is the reason this is
 * a nullable column instead of a second table. What a publication note does not
 * have is an anchor: there is no sentence it argues with, so it has no block, no
 * text offset and no version to be pinned to. `versionNumber` is null for the
 * same reason.
 */
export interface PublicationNoteView {
  id: string;
  body: string;
  kind: AnnotationKind;
  createdAt: number;
  editedAt: number | null;
  parentId: string | null;
  authorId: string | null;
  authorName: string;
  authorHandle: string | null;
  isMine: boolean;
  reactions: { useful: number; insightful: number; source: number };
  replies: number;
}

/** Notes about the publication, oldest first. Replies come back as rows too;
 *  the caller groups them, exactly as it does for an article's margin. */
export async function listPublicationAnnotations(
  opts: { anonId?: string | null; authorId?: string | null } = {},
): Promise<PublicationNoteView[]> {
  const database = await readyDb();
  const rows = await database
    .select(noteSelect)
    .from(annotations)
    .leftJoin(users, eq(annotations.authorId, users.id))
    .where(and(isNull(annotations.postId), eq(annotations.status, 'visible'), eq(annotations.isPrivate, false)))
    .orderBy(asc(annotations.createdAt));

  return rows
    .map((row): PublicationNoteView | null => {
      const { note } = row;
      // Symmetric narrowing: an article note is never a publication note.
      if (note.postId !== null || note.blockId !== null || note.anchor !== null) return null;
      const isMine = Boolean(
        (note.authorId && opts.authorId && note.authorId === opts.authorId) ||
          (note.anonId && opts.anonId && note.anonId === opts.anonId),
      );
      return {
        id: note.id,
        body: note.body,
        kind: note.kind as AnnotationKind,
        createdAt: note.createdAt,
        editedAt: note.editedAt,
        parentId: note.parentId,
        authorId: note.authorId,
        authorName: row.authorName ?? note.guestName ?? 'Anonymous',
        authorHandle: row.authorHandle,
        isMine,
        reactions: parseReactionCounts(row.reactions),
        replies: Number(row.replies ?? 0),
      };
    })
    .filter((n): n is PublicationNoteView => n !== null);
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

/**
 * How long an identical submission counts as the same submission.
 *
 * Ten seconds is long enough to cover the ways one submission becomes two — a
 * double-click, a double-tap on a phone, a reader who did not see the redirect
 * and pressed the button again — and short enough that genuinely wanting to say
 * the same thing twice in a row still works. It is a heuristic about human
 * clicking speed, not a rate limit: nobody types a considered note and submits it
 * again inside ten seconds on purpose.
 */
const REPEAT_WINDOW_MS = 10_000;

/**
 * Insert a note, collapsing an accidental repeat into the one the reader meant.
 *
 * The problem this solves is not hypothetical and is not a security concern: it
 * is the ordinary behaviour of a person who clicks twice. Two identical replies
 * are stored, both render, and the reader is left looking at a duplicate of
 * their own words in someone else's margin with no obvious way to remove it. A
 * note is a public artifact pinned to a sentence, so a duplicate is visible and
 * lasting — worse than a double charge on a card, and much more embarrassing.
 *
 * Why this cannot live in the browser: the product's whole reading and writing
 * surface is ordinary form posts so it works with JavaScript off (§1.3), and a
 * `disabled` attribute on the button protects only the reader whose browser runs
 * the script. A server that cannot tell a repeated submission from two
 * deliberate ones will happily store both.
 *
 * The rule is deliberately narrow. Same author, same target, same words, seconds
 * apart. Anything else is two submissions, including the same words an hour later
 * or the same words under a different sentence.
 *
 * Concurrency: two simultaneous requests both insert, then both look, and both
 * keep the earliest row and delete the rest. That converges whichever order they
 * interleave in — the last one to finish sees the full set and removes the
 * extras, and a request whose own row was removed reports `duplicate` so the
 * caller can skip notifying the parent author twice.
 */
async function insertNoteOnce(
  database: Awaited<ReturnType<typeof readyDb>>,
  row: typeof annotations.$inferInsert,
): Promise<{ row: typeof annotations.$inferInsert; duplicate: boolean }> {
  const createdAt = row.createdAt ?? Date.now();
  const withStamp = { ...row, createdAt };

  await database.insert(annotations).values(withStamp);

  const author = withStamp.authorId
    ? eq(annotations.authorId, withStamp.authorId)
    : eq(annotations.anonId, withStamp.anonId ?? '');
  const target = withStamp.parentId
    ? eq(annotations.parentId, withStamp.parentId)
    : withStamp.blockId
      ? eq(annotations.blockId, withStamp.blockId)
      : eq(annotations.postId, withStamp.postId ?? '');

  const near = await database
    .select({ id: annotations.id })
    .from(annotations)
    .where(
      and(
        author,
        target,
        eq(annotations.body, withStamp.body),
        gte(annotations.createdAt, createdAt - REPEAT_WINDOW_MS),
      ),
    )
    // Earliest wins, with the id as a tiebreak so two rows written in the same
    // millisecond still agree on which one survives.
    .orderBy(asc(annotations.createdAt), asc(annotations.id));

  const keeper = near[0];
  if (keeper && near.length > 1) {
    await database
      .delete(annotations)
      .where(inArray(annotations.id, near.slice(1).map((r) => r.id)));
  }

  const duplicate = Boolean(keeper) && keeper!.id !== withStamp.id;
  return { row: duplicate ? { ...withStamp, id: keeper!.id } : withStamp, duplicate };
}

/** A note about the publication, rather than an article. No anchor, because
 *  there is no sentence for it to argue with. */
export interface CreatePublicationNoteInput {
  body: string;
  kind?: AnnotationKind;
  anonId?: string | null;
  authorId?: string | null;
  guestName?: string | null;
  parentId?: string | null;
}

export async function createAnnotation(
  input: CreateAnnotationInput,
): Promise<{ row: Annotation; duplicate: boolean }> {
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
  const { row: kept, duplicate } = await insertNoteOnce(database, row);
  return { row: kept as Annotation, duplicate };
}

export async function createPublicationNote(
  input: CreatePublicationNoteInput,
): Promise<{ ok: true; id: string; duplicate: boolean } | { ok: false; error: string }> {
  const body = input.body.trim();
  if (!body) return { ok: false, error: 'Say something first.' };
  const database = await readyDb();

  // A reply must land in its parent's scope, so validate before inserting.
  // Inserting a publication-scoped reply under an article parent (or the
  // reverse) is the one way a thread could straddle both surfaces.
  let parentId: string | null = null;
  if (input.parentId) {
    const parent = await getAnnotation(input.parentId);
    if (!parent || parent.status !== 'visible') {
      return { ok: false, error: 'The note you replied to is gone.' };
    }
    if (parent.postId !== null) {
      return { ok: false, error: 'That note belongs to an article, not the publication.' };
    }
    parentId = parent.id;
  }

  const id = nanoid();
  const { row, duplicate } = await insertNoteOnce(database, {
    id,
    postId: null,
    versionId: null,
    blockId: null,
    anchor: null,
    body,
    // An author-only kind is meaningless here: there is no post whose author
    // could be speaking. Force the ordinary kind rather than let a caller
    // invent a publication "author channel" nobody reads.
    kind: AUTHOR_ONLY_KINDS.includes(input.kind as AnnotationKind) ? 'comment' : (input.kind ?? 'comment'),
    parentId,
    authorId: input.authorId ?? null,
    anonId: input.anonId ?? null,
    guestName: input.guestName ?? null,
    isPrivate: false,
    createdAt: Date.now(),
  });
  return { ok: true, id: row.id ?? id, duplicate };
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
  // Acceptance folds a note into a post's history. A publication note has no
  // post and no revision, so there is nothing to fold it into — refusing beats
  // setting a flag that nothing reads.
  if (note.postId === null) return false;
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
}): Promise<{ ok: true; id: string; duplicate: boolean } | { ok: false; error: string }> {
  const parent = await getAnnotation(input.parentId);
  if (!parent || parent.status !== 'visible') {
    return { ok: false, error: 'The note you replied to is gone.' };
  }
  // A publication note has no parent post and therefore no anchor. Its replies
  // are publication notes too, so hand them to the publication write path
  // rather than reporting a missing anchor as a fault — the anchor is supposed
  // to be missing.
  if (parent.postId === null) {
    const created = await createPublicationNote({
      body: input.body,
      anonId: input.anonId,
      authorId: input.authorId,
      parentId: parent.id,
    });
    return created.ok
      ? { ok: true, id: created.id, duplicate: created.duplicate }
      : { ok: false, error: created.error };
  }
  const anchor = parent.anchor ? safeAnchor(parent.anchor) : null;
  if (!anchor) {
    return { ok: false, error: 'That note has lost its anchor, so it cannot be replied to.' };
  }
  const created = await createAnnotation({
    postId: parent.postId,
    versionId: parent.versionId as string,
    blockId: parent.blockId as string,
    anchor,
    body: input.body,
    kind: 'comment',
    anonId: input.anonId,
    authorId: input.authorId,
    parentId: input.parentId,
  });
  return { ok: true, id: created.row.id, duplicate: created.duplicate };
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

/** Which of the three reactions this reader has already given, per note. */export async function myReactions(
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

/** Distinct people arguing about the publication itself. */
export async function countPublicationParticipants() {
  const database = await readyDb();
  const [row] = await database
    .select({ n: sql<number>`count(distinct coalesce(annotations.author_id, annotations.anon_id))` })
    .from(annotations)
    .where(
      and(
        isNull(annotations.postId),
        eq(annotations.status, 'visible'),
        eq(annotations.isPrivate, false),
      ),
    );
  return Number(row?.n ?? 0);
}

/** Reported publication notes awaiting a human. See `getReportedNotes`. */
export async function countReportedPublicationNotes() {
  const database = await readyDb();
  const [row] = await database
    .select({ n: sql<number>`count(distinct ${annotationReports.annotationId})` })
    .from(annotationReports)
    .innerJoin(annotations, eq(annotationReports.annotationId, annotations.id))
    .where(isNull(annotations.postId));
  return Number(row?.n ?? 0);
}

export { or, inArray };

/* -------------------------------------------------------------------------- */
/* Reports                                                                     */
/* -------------------------------------------------------------------------- */

/** File a report. One per reporter per note — piling on is not moderation. */
export async function reportAnnotation(noteId: string, reporterKey: string, reason: string) {
  const clean = reason.trim().slice(0, 500);
  if (!clean) return { ok: false as const, error: 'Say why, in a few words.' };
  const database = await readyDb();
  const note = await getAnnotation(noteId);
  if (!note || note.status !== 'visible') return { ok: false as const, error: 'That note is gone.' };
  const existing = await database
    .select({ id: annotationReports.id })
    .from(annotationReports)
    .where(
      and(
        eq(annotationReports.annotationId, noteId),
        eq(annotationReports.reporterKey, reporterKey),
      ),
    )
    .limit(1);
  if (existing.length === 0) {
    await database.insert(annotationReports).values({ id: nanoid(), annotationId: noteId, reporterKey, reason: clean });
  }
  return { ok: true as const };
}

export interface ReportedNote {
  id: string;
  postId: string;
  postSlug: string;
  postTitle: string;
  body: string;
  kind: string;
  status: string;
  reports: number;
  latestReason: string;
}

/** Notes on this author's posts that readers flagged, most-reported first.
 *
 *  Deliberately article-scoped: the `innerJoin` drops publication notes, because
 *  this queue is "problems with your articles" and a publication note belongs
 *  to no author. Readers can still report those notes and the report is stored,
 *  so rather than let that gap be invisible,
 *  `countReportedPublicationNotes` makes it measurable. Routing those reports to
 *  a human needs an owner concept this codebase does not have yet; inventing
 *  one here would be a worse answer than a measurable hole. */
export async function getReportedNotes(authorId: string): Promise<ReportedNote[]> {
  const database = await readyDb();
  const rows = await database
    .select({
      id: annotations.id,
      postId: annotations.postId,
      postSlug: posts.slug,
      postTitle: posts.title,
      body: annotations.body,
      kind: annotations.kind,
      status: annotations.status,
      reports: sql<number>`count(${annotationReports.id})`,
      latestReason: sql<string>`max(${annotationReports.reason})`,
    })
    .from(annotations)
    .innerJoin(posts, eq(annotations.postId, posts.id))
    .innerJoin(annotationReports, eq(annotationReports.annotationId, annotations.id))
    .where(eq(posts.authorId, authorId))
    .groupBy(annotations.id)
    .orderBy(sql`count(${annotationReports.id}) DESC`);
  return rows
    // The innerJoin already guarantees a matching post, so a null here would
    // mean the join invariant broke. Dropping rather than asserting keeps the
    // return type honest: `ReportedNote.postId` is non-nullable by construction.
    .filter((r): r is typeof r & { postId: string } => r.postId !== null)
    .map((r) => ({
      ...r,
      reports: Number(r.reports),
    }));
}

/** Hide or restore a note. Only the post's author — checked here, not trusted. */
export async function setNoteStatus(
  noteId: string,
  authorId: string,
  status: 'visible' | 'hidden',
): Promise<boolean> {
  const database = await readyDb();
  const note = await getAnnotation(noteId);
  if (!note) return false;
  // Fails closed on a publication note. There is no post, so there is no post
  // author, so no caller of this function is the right owner. Returning false
  // is the safe answer; the alternative — letting the author check fall through
  // on a NULL join — would be a silent no-op that reads like success.
  if (note.postId === null) return false;
  const [post] = await database
    .select({ authorId: posts.authorId })
    .from(posts)
    .where(eq(posts.id, note.postId))
    .limit(1);
  if (!post || post.authorId !== authorId) return false;
  await database.update(annotations).set({ status }).where(eq(annotations.id, noteId));
  return true;
}
