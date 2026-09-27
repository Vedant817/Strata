import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getIdentity } from '../../lib/repo/auth';
import { addCapture, promoteCapture, setCaptureState, type CaptureState } from '../../lib/repo/studio';
import { safeReturnTo } from '../../lib/note-actions';

/**
 * Studio mutations. Same shape as the note endpoint: ordinary form posts,
 * one validated schema, redirect back with the reason on failure. Studio is
 * for claimed writers — an anonymous browser has no inbox to capture into,
 * so without an account the honest response is to send them to claim one.
 */

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('capture'),
    body: z.string().trim().min(1, 'A capture needs some text.').max(4000),
    source: z.enum(['share', 'voice', 'screenshot', 'scratchpad', 'clip']).default('scratchpad'),
    returnTo: z.string().optional(),
  }),
  z.object({
    action: z.literal('state'),
    id: z.string().min(1),
    to: z.enum(['inbox', 'seed', 'draft', 'discarded']),
    returnTo: z.string().optional(),
  }),
  z.object({
    action: z.literal('promote'),
    id: z.string().min(1),
    returnTo: z.string().optional(),
  }),
]);

export const POST: APIRoute = async ({ request, cookies, redirect, url }) => {
  const identity = await getIdentity(cookies);
  if (!identity.userId) return redirect('/write#handle', 303);

  const form = await request.formData().catch(() => null);
  const back = safeReturnTo(form?.get('returnTo'), '/studio');
  const target = new URL(back, url);
  target.searchParams.delete('studioError');

  const parsed = schema.safeParse(form ? Object.fromEntries(form) : null);
  if (!parsed.success) {
    target.searchParams.set('studioError', parsed.error.issues[0]?.message ?? 'That did not look right.');
    return redirect(target.pathname + target.search, 303);
  }

  const input = parsed.data;
  if (input.action === 'capture') {
    const result = await addCapture(identity.userId, input.body, input.source);
    if (!result.ok) {
      target.searchParams.set('studioError', result.error);
      return redirect(target.pathname + target.search, 303);
    }
    return redirect(back, 303);
  }

  if (input.action === 'state') {
    const ok = await setCaptureState(input.id, identity.userId, input.to as CaptureState);
    if (!ok) target.searchParams.set('studioError', 'That capture is not yours.');
    return redirect(ok ? back : target.pathname + target.search, 303);
  }

  const promoted = await promoteCapture(input.id, identity.userId);
  if (!promoted.ok) {
    target.searchParams.set('studioError', promoted.error);
    return redirect(target.pathname + target.search, 303);
  }
  const post = await import('../../lib/repo/posts').then((m) =>
    m.getPostById(promoted.postId),
  );
  return redirect(post ? `/w/${post.slug}` : back, 303);
};

export const GET: APIRoute = () => Response.redirect('/studio', 303);
