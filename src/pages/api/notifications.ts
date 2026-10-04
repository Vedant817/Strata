import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getIdentity } from '../../lib/repo/auth';
import { setMuted } from '../../lib/repo/notifications';
import { safeReturnTo } from '../../lib/note-actions';

const KIND = z.enum(['mention', 'reply', 'correction-accepted', 'amendment']);

/** Per-kind silence. POST-only so a stray link cannot mute someone. */
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  // `.catch(() => null)` is the convention across the other form endpoints, and
  // it is not defensive padding: `formData()` *throws* on any content type that
  // is not form-encoded, so a JSON POST used to escape as an uncaught TypeError
  // and a 500. The kind check below already answers "not a valid request"; this
  // just makes sure we reach it.
  const form = await request.formData().catch(() => null);
  const kind = KIND.safeParse(form?.get('kind'));
  if (!form || !kind.success) return new Response('Unknown kind of notification.', { status: 400 });

  const identity = await getIdentity(cookies);
  const muted = form.get('muted') === '1';
  const result = await setMuted(identity.userId, kind.data, muted);
  const back = safeReturnTo(form.get('returnTo'), '/notifications');

  if (!result.ok) return redirect(`${back}?err=${encodeURIComponent(result.message)}`, 303);
  return redirect(back, 303);
};