import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getIdentity } from '../../lib/repo/auth';
import { setMuted } from '../../lib/repo/notifications';
import { safeReturnTo } from '../../lib/note-actions';

const KIND = z.enum(['mention', 'reply', 'correction-accepted', 'amendment']);

/** Per-kind silence. POST-only so a stray link cannot mute someone. */
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const form = await request.formData();
  const kind = KIND.safeParse(form.get('kind'));
  if (!kind.success) return new Response('Unknown kind of notification.', { status: 400 });

  const identity = await getIdentity(cookies);
  const muted = form.get('muted') === '1';
  const result = await setMuted(identity.userId, kind.data, muted);
  const back = safeReturnTo(form.get('returnTo'), '/notifications');

  if (!result.ok) return redirect(`${back}?err=${encodeURIComponent(result.message)}`, 303);
  return redirect(back, 303);
};