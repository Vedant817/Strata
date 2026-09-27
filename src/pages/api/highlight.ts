import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getIdentity } from '../../lib/repo/auth';
import { ANON_COOKIE } from '../../lib/prefs';
import { highlightKeyFor, toggleHighlight } from '../../lib/repo/highlights';

/**
 * Toggle a highlight. A form post so it works without JavaScript; the island
 * upgrades it to a fetch when present.
 *
 * Deliberately silent and unanimated: a highlight belongs to the reader, so
 * nothing is announced, no count is shown, and the only trace left is a warm
 * underline on their own return visit. Making it visible to others would turn
 * a private act into applause, which §1.1 refuses.
 */
const schema = z.object({
  postId: z.string().min(1),
  blockId: z.string().min(1),
  text: z.string().max(600),
  returnTo: z.string().optional(),
});

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const form = await request.formData().catch(() => null);
  const back = typeof form?.get('returnTo') === 'string' ? (form.get('returnTo') as string) : '/';
  const parsed = schema.safeParse(form ? Object.fromEntries(form) : null);
  if (!parsed.success) return redirect(back, 303);

  const identity = await getIdentity(cookies);
  const anonId = cookies.get(ANON_COOKIE)?.value ?? identity.anonId;
  if (!anonId) return redirect(back, 303);

  const added = await toggleHighlight({
    postId: parsed.data.postId,
    blockId: parsed.data.blockId,
    text: parsed.data.text || '',
    key: highlightKeyFor(identity.userId, anonId),
    userId: identity.userId,
  });

  return redirect(`${back}${back.includes('?') ? '&' : '?'}hl=${added ? 'on' : 'off'}`, 303);
};

export const GET: APIRoute = () => Response.redirect('/', 303);
