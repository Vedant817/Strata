import type { APIRoute } from 'astro';
import { recordReach } from '../../lib/repo/posts';
import { getIdentity } from '../../lib/repo/auth';
import { ANON_COOKIE } from '../../lib/prefs';

/**
 * Reach beacon. The reader-instrumented comprehension signal behind the empathy
 * analytics — which blocks did this reader actually get to.
 *
 * Deliberately narrow: a post id, the browser's own anon id, and a list of block
 * ids. No scroll position, no dwell timing, no per-reader profile a writer could
 * browse, and no third party involved. Suppressed for cohorts under twenty
 * readers on the way out.
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return new Response(null, { status: 400 });
  }

  const postId = typeof payload.postId === 'string' ? payload.postId : '';
  const blockIds = Array.isArray(payload.blockIds)
    ? payload.blockIds.filter((b): b is string => typeof b === 'string').slice(0, 400)
    : [];

  if (!postId || blockIds.length === 0) return new Response(null, { status: 204 });

  const anonId = cookies.get(ANON_COOKIE)?.value ?? '';
  if (!anonId) return new Response(null, { status: 204 });

  const identity = await getIdentity(cookies);
  try {
    await recordReach({ postId, anonId, userId: identity.userId, blockIds });
  } catch (err) {
    // Telemetry must never surface as an error in the console of a reader who
    // is trying to read something.
    console.error('[strata] reach beacon failed', err);
  }
  return new Response(null, { status: 204 });
};

/** sendBeacon sends POST, but be explicit for anything that strays. */
export const GET: APIRoute = () => new Response(null, { status: 405 });
