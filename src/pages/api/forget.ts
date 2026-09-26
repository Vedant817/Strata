import type { APIRoute } from 'astro';
import { forgetReader } from '../../lib/repo/posts';

/**
 * Reader-initiated erasure. Issues a real DELETE rather than hiding records
 * behind a preference — privacy you cannot exercise is not privacy.
 *
 * Deliberately POST-only and CSRF-protected by Astro's origin check, and it
 * only ever deletes rows scoped to the supplied anon id.
 */
export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData().catch(() => null);
  const anon = form?.get('anon');

  if (typeof anon !== 'string' || !/^[a-z0-9-]{8,64}$/i.test(anon)) {
    return redirect('/privacy', 303);
  }

  try {
    await forgetReader(anon);
  } catch (err) {
    console.error('[strata] forget failed', err);
    return new Response('Could not complete the deletion.', { status: 500 });
  }

  return redirect('/privacy?forgotten=1', 303);
};

/** A GET here is a misclick; send them somewhere useful instead of leaking. */
export const GET: APIRoute = ({ redirect }) => redirect('/privacy#forget', 303);
