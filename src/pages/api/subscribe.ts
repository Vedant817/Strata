import type { APIRoute } from 'astro';
import { z } from 'zod';
import { isEmail, subscribe, unsubscribe } from '../../lib/repo/subscriptions';
import { safeReturnTo } from '../../lib/note-actions';

/**
 * Subscribe to a post's revisions. A plain form post, so it works with
 * JavaScript off — the whole point of a subscription is that it is a
 * considered act, not a one-tap gesture.
 *
 * Unsubscribe is the same endpoint with `?unsubscribe=1`, because the one
 * action that must never be hard is leaving. It needs no confirmation, and no
 * "are you sure" interstitial between a reader and the exit.
 */
const schema = z.object({
  postId: z.string().min(1),
  email: z.string().trim().toLowerCase().max(320),
  returnTo: z.string().optional(),
  unsubscribe: z.string().optional(),
});

export const POST: APIRoute = async ({ request, redirect, url }) => {
  const form = await request.formData().catch(() => null);
  const back = safeReturnTo(form?.get('returnTo'), '/');
  const target = new URL(back, url);
  target.searchParams.delete('subscribe');

  const parsed = schema.safeParse(form ? Object.fromEntries(form) : null);
  if (!parsed.success) {
    target.searchParams.set('subscribe', 'error');
    return redirect(target.pathname + target.search, 303);
  }

  if (!isEmail(parsed.data.email)) {
    target.searchParams.set('subscribe', 'bad-email');
    return redirect(target.pathname + target.search, 303);
  }

  if (parsed.data.unsubscribe) {
    await unsubscribe(parsed.data.postId, parsed.data.email);
    target.searchParams.set('subscribe', 'off');
  } else {
    await subscribe(parsed.data.postId, parsed.data.email);
    // Already-subscribed is success: confirming it would leak which addresses
    // are on a list to anyone who tries them.
    target.searchParams.set('subscribe', 'on');
  }
  return redirect(target.pathname + target.search, 303);
};

export const GET: APIRoute = ({ redirect }) => redirect('/', 303);
