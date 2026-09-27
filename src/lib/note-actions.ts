import { z } from 'zod';
import type { AstroCookies } from 'astro';
import { and, eq } from 'drizzle-orm';
import { readyDb } from './db';
import { posts } from './db/schema';
import { getIdentity } from './repo/auth';
import {
  acceptAnnotation,
  deleteAnnotation,
  editAnnotation,
  getAnnotation,
  replyToAnnotation,
  reportAnnotation,
  setNoteStatus,
  toggleReaction,
  voterKeyFor,
} from './repo/annotations';
import { ANON_COOKIE } from './prefs';

/**
 * Everything a reader can do to a note after posting it.
 *
 * This started as a JSON `PATCH` endpoint, which is why the margin rail was
 * read-only for so long: the backend for reactions, replies, edits, deletes and
 * acceptance all existed, and nothing could reach them. A JSON endpoint needs a
 * script; the rail is a document that has to work before any script arrives.
 *
 * So these are ordinary form posts handled by the article page, validated by one
 * discriminated schema instead of re-parsed by hand per branch. Astro refuses to
 * let an action return a redirect — it insists the caller performs it, which
 * needs JavaScript — so an action could not have done the no-JS half of this.
 */

const MAX_BODY = 4000;

const returnTo = z.string().max(2000).optional();

export const noteActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('react'),
    noteId: z.string().min(1),
    kind: z.enum(['useful', 'insightful', 'source']),
    returnTo,
  }),
  z.object({
    action: z.literal('reply'),
    parentId: z.string().min(1),
    body: z.string().trim().min(1, 'A reply needs some text.').max(MAX_BODY),
    returnTo,
  }),
  z.object({
    action: z.literal('edit'),
    noteId: z.string().min(1),
    body: z.string().trim().min(1, 'A note needs some text.').max(MAX_BODY),
    returnTo,
  }),
  z.object({
    action: z.literal('remove'),
    noteId: z.string().min(1),
    returnTo,
  }),
  z.object({
    action: z.literal('accept'),
    noteId: z.string().min(1),
    postId: z.string().min(1),
    returnTo,
  }),
  z.object({
    action: z.literal('report'),
    noteId: z.string().min(1),
    reason: z.string().trim().min(3, 'Say why, in a few words.').max(500),
    returnTo,
  }),
  z.object({
    action: z.literal('visibility'),
    noteId: z.string().min(1),
    status: z.enum(['visible', 'hidden']),
    returnTo,
  }),
]);

export type NoteAction = z.infer<typeof noteActionSchema>;

export type NoteActionResult = { ok: true } | { ok: false; message: string };

/** Only ever send a reader back inside this site. `//evil.example` is a
 *  protocol-relative URL, and redirecting to it would be an open redirect. */
export function safeReturnTo(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value) return fallback;
  if (!value.startsWith('/') || value.startsWith('//')) return fallback;
  return value;
}

async function ownsPost(userId: string | null, postId: string): Promise<boolean> {
  if (!userId) return false;
  const database = await readyDb();
  const rows = await database
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.id, postId), eq(posts.authorId, userId)))
    .limit(1);
  return rows.length > 0;
}

export async function applyNoteAction(
  input: NoteAction,
  cookies: AstroCookies,
): Promise<NoteActionResult> {
  const identity = await getIdentity(cookies);
  const anonId = cookies.get(ANON_COOKIE)?.value ?? identity.anonId;
  if (!anonId) return { ok: false, message: 'No reader session on this browser.' };

  switch (input.action) {
    case 'react': {
      const note = await getAnnotation(input.noteId);
      if (!note || note.status !== 'visible') {
        return { ok: false, message: 'That note is gone.' };
      }
      await toggleReaction(input.noteId, voterKeyFor(identity.userId, anonId), input.kind);
      return { ok: true };
    }

    case 'reply': {
      const result = await replyToAnnotation({
        parentId: input.parentId,
        body: input.body,
        anonId,
        authorId: identity.userId,
      });
      return result.ok ? { ok: true } : { ok: false, message: result.error };
    }

    case 'edit': {
      const ok = await editAnnotation(input.noteId, input.body, identity.userId, anonId);
      return ok ? { ok: true } : { ok: false, message: 'You can only edit your own notes.' };
    }

    case 'remove': {
      const ok = await deleteAnnotation(input.noteId, { authorId: identity.userId, anonId });
      return ok ? { ok: true } : { ok: false, message: 'You can only delete your own notes.' };
    }

    case 'accept': {
      if (!(await ownsPost(identity.userId, input.postId))) {
        return { ok: false, message: 'Only the author of this post can accept a note.' };
      }
      const note = await getAnnotation(input.noteId);
      if (note?.authorId && note.authorId === identity.userId) {
        return { ok: false, message: 'You cannot accept your own note.' };
      }
      const ok = await acceptAnnotation(input.noteId);
      return ok ? { ok: true } : { ok: false, message: 'That note is gone.' };
    }

    case 'report': {
      const result = await reportAnnotation(
        input.noteId,
        voterKeyFor(identity.userId, anonId),
        input.reason,
      );
      return result.ok ? { ok: true } : { ok: false, message: result.error };
    }

    case 'visibility': {
      if (!identity.userId) {
        return { ok: false, message: 'Only the author can do that.' };
      }
      const ok = await setNoteStatus(input.noteId, identity.userId, input.status);
      return ok ? { ok: true } : { ok: false, message: 'That note is not on your post.' };
    }
  }
}
