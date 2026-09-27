import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getIdentity } from '../../lib/repo/auth';
import { memoryKeyFor, toggleFollow, toggleSaved } from '../../lib/repo/reader';
import { safeReturnTo } from '../../lib/note-actions';
import { ANON_COOKIE } from '../../lib/prefs';

/**
 * Follows and saves. Same contract as the note endpoint: ordinary form posts,
 * one validated schema, redirect back. Anonymous-first — the key is the
 * browser until claimed, and claiming backfills both tables, so nothing is
 * lost at the moment an identity appears.
 */
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('follow'), authorId: z.string().min(1), returnTo: z.string().optional() }),
  z.object({ action: z.literal('save'), postId: z.string().min(1), returnTo: z.string().optional() }),
]);

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const identity = await getIdentity(cookies);
  const anonId = cookies.get(ANON_COOKIE)?.value ?? identity.anonId;
  if (!anonId) return redirect('/', 303);

  const form = await request.formData().catch(() => null);
  const back = safeReturnTo(form?.get('returnTo'), '/');
  const parsed = schema.safeParse(form ? Object.fromEntries(form) : null);
  if (!parsed.success) return redirect(back, 303);

  const key = memoryKeyFor(identity.userId, anonId);
  if (parsed.data.action === 'follow') {
    await toggleFollow(key, parsed.data.authorId);
  } else {
    await toggleSaved(key, parsed.data.postId);
  }
  return redirect(back, 303);
};

export const GET: APIRoute = () => Response.redirect('/', 303);
