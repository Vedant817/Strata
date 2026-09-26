import type { APIRoute } from 'astro';
import { and, eq } from 'drizzle-orm';
import { readyDb } from '../../lib/db';
import { blocks, postVersions, posts } from '../../lib/db/schema';
import { getIdentity } from '../../lib/repo/auth';
import {
  acceptAnnotation,
  createAnnotation,
  deleteAnnotation,
  editAnnotation,
  makeAnchor,
  resolveAnchor,
} from '../../lib/repo/annotations';
import { ANNOTATION_KINDS, type AnnotationKind } from '../../lib/db/schema';
import { ANON_COOKIE } from '../../lib/prefs';

const MAX_BODY = 4000;

/** The plain text of one block within one version, or null if it is not there. */
async function blockTextFor(
  postId: string,
  versionId: string,
  blockId: string,
): Promise<string | null> {
  const database = await readyDb();
  const rows = await database
    .select({ text: blocks.text })
    .from(blocks)
    .innerJoin(postVersions, eq(blocks.versionId, postVersions.id))
    .innerJoin(posts, eq(postVersions.postId, posts.id))
    .where(
      and(
        eq(posts.id, postId),
        eq(postVersions.id, versionId),
        eq(blocks.blockId, blockId),
      ),
    )
    .limit(1);
  return rows[0]?.text ?? null;
}

function bad(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function postOwns(authorId: string | null, postId: string): Promise<boolean> {
  if (!authorId) return false;
  const database = await readyDb();
  const rows = await database
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.id, postId), eq(posts.authorId, authorId)))
    .limit(1);
  return rows.length > 0;
}

/**
 * Create a note. No account required — this is the whole point.
 *
 * The client sends the *selected text*, not character offsets. The rendered DOM
 * has already consumed its inline markup, so DOM offsets and source offsets do
 * not correspond, and a client-computed offset would be wrong the moment a
 * paragraph contained a code span. The quote-plus-context anchor resolves the
 * position server-side against the real block text, which is both correct and
 * the reason the anchor stores context at all.
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return bad('Expected a JSON body.');
  }

  const postId = typeof payload.postId === 'string' ? payload.postId : '';
  const versionId = typeof payload.versionId === 'string' ? payload.versionId : '';
  const blockId = typeof payload.blockId === 'string' ? payload.blockId : '';
  const body = typeof payload.body === 'string' ? payload.body.trim() : '';
  const kind = (ANNOTATION_KINDS as readonly string[]).includes(payload.kind as string)
    ? (payload.kind as AnnotationKind)
    : 'comment';
  const quote = typeof payload.quote === 'string' ? payload.quote.trim() : '';
  const prefixHint = typeof payload.prefixHint === 'string' ? payload.prefixHint : '';
  const suffixHint = typeof payload.suffixHint === 'string' ? payload.suffixHint : '';
  const guestName =
    typeof payload.guestName === 'string' ? payload.guestName.trim().slice(0, 40) : null;

  if (!postId || !versionId || !blockId) return bad('Missing post, version or block.');
  if (!body) return bad('A note needs some text.');
  if (body.length > MAX_BODY) return bad(`Keep notes under ${MAX_BODY} characters.`);
  if (quote.length < 2) return bad('Select a sentence to attach the note to.');
  if (quote.length > 600) return bad('That selection is too long. Anchor a sentence, not a section.');

  const identity = await getIdentity(cookies);
  if (!identity.anonId) return bad('No reader session.', 409);

  // Resolve against this post's actual block text. This also proves the block
  // belongs to the post, so a note cannot be anchored into someone else's post.
  const blockText = await blockTextFor(postId, versionId, blockId);
  if (blockText === null) return bad('That block is not part of this version of the post.', 409);

  const resolved = resolveAnchor(
    { blockId, start: 0, end: 0, quote, prefix: prefixHint, suffix: suffixHint },
    blockText,
  );
  if (resolved.status === 'lost') {
    return bad(
      'That sentence is no longer in this paragraph — it was probably edited. Reload and try again.',
      409,
    );
  }

  const anchor = makeAnchor(blockId, blockText, resolved.start, resolved.end);

  // Only the post's author may write into the author-note channel.
  if (kind === 'author_note' && !(await postOwns(identity.userId, postId))) {
    return bad('Only the author of this post can leave an author note.', 403);
  }

  const created = await createAnnotation({
    postId,
    versionId,
    blockId,
    anchor,
    body,
    kind,
    anonId: identity.anonId,
    authorId: identity.userId,
    guestName: guestName || null,
    isPrivate: payload.isPrivate === true,
  });

  return new Response(
    JSON.stringify({
      id: created.id,
      createdAt: created.createdAt,
      anchor: { start: resolved.start, end: resolved.end },
    }),
    { status: 201, headers: { 'content-type': 'application/json' } },
  );
};

/** Edit, delete, or (for the post's author) accept a note. */
export const PATCH: APIRoute = async ({ request, cookies }) => {
  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return bad('Expected a JSON body.');
  }
  const id = typeof payload.id === 'string' ? payload.id : '';
  if (!id) return bad('Missing note id.');

  const identity = await getIdentity(cookies);
  const anonId = cookies.get(ANON_COOKIE)?.value ?? '';

  if (payload.action === 'accept') {
    const postId = typeof payload.postId === 'string' ? payload.postId : '';
    if (!(await postOwns(identity.userId, postId))) return bad('Only the author can accept.', 403);
    const ok = await acceptAnnotation(id, identity.userId!);
    return ok
      ? new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } })
      : bad('Could not accept that note.', 409);
  }

  if (payload.action === 'delete') {
    const ok = await deleteAnnotation(id, { authorId: identity.userId, anonId });
    return ok
      ? new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } })
      : bad('You can only delete your own notes.', 403);
  }

  const body = typeof payload.body === 'string' ? payload.body.trim() : '';
  if (!body) return bad('A note needs some text.');
  if (body.length > MAX_BODY) return bad(`Keep notes under ${MAX_BODY} characters.`);
  const ok = await editAnnotation(id, body, identity.userId, anonId);
  return ok
    ? new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } })
    : bad('You can only edit your own notes.', 403);
};

export const GET: APIRoute = () =>
  new Response(JSON.stringify({ error: 'POST to create a note, PATCH to edit one.' }), {
    status: 405,
    headers: { 'content-type': 'application/json', allow: 'POST, PATCH' },
  });
