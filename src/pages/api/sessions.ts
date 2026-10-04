import type { APIRoute } from 'astro';
import { getIdentity } from '../../lib/repo/auth';
import { SESSION_COOKIE } from '../../lib/repo/auth';
import { revokeAllOtherSessions, revokeSession } from '../../lib/repo/device-sessions';

/**
 * End a session.
 *
 * Sign-out-all-others exists because the realistic compromise is a laptop left
 * signed in, and hunting for it in a list of four rows is a worse outcome than
 * ending everything that is not this browser.
 */
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const identity = await getIdentity(cookies);
  if (!identity.userId) return new Response('Not signed in.', { status: 401 });

  // Same reason as every other form endpoint: `formData()` throws on a
  // non-form content type. Without this a signed-in browser posting JSON gets an
  // uncaught TypeError and a 500 — invisible to an anonymous probe, because the
  // check above answers first.
  const form = await request.formData().catch(() => null);
  const action = form?.get('action');
  const back = '/settings';
  const token = cookies.get(SESSION_COOKIE)?.value ?? null;

  if (action === 'revoke-others') {
    if (!token) return redirect(back, 303);
    const n = await revokeAllOtherSessions(identity.userId, token);
    return redirect(`${back}?ended=${n}`, 303);
  }

  if (action === 'revoke') {
    const target = String(form?.get('token') ?? '');
    const result = await revokeSession(identity.userId, target);
    if (!result.ok) return redirect(`${back}?err=${encodeURIComponent(result.error ?? '')}`, 303);
    // Revoking the session you are using is a sign-out, not a no-op.
    if (target === token) {
      cookies.delete(SESSION_COOKIE, { path: '/' });
      return redirect('/', 303);
    }
    return redirect(back, 303);
  }

  return redirect(back, 303);
};