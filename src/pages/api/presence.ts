import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getIdentity } from '../../lib/repo/auth';
import { heartbeat, prunePresence, readersNow } from '../../lib/repo/presence';
import { memoryKeyFor } from '../../lib/repo/reader';
import { ensureAnonId } from '../../lib/prefs';

/**
 * Presence: heartbeat in, count out.
 *
 * POST records that this browser has this post open; GET returns how many
 * browsers do right now. Both anonymous-first — the key is the browser until
 * claimed. Failures are silent by design: presence is ambient decoration, and
 * a beacon that errors loudly would be worse than one that quietly stops.
 */
const postSchema = z.object({ postId: z.string().min(1).max(100) });

export const POST: APIRoute = async ({ request, cookies }) => {
  const identity = await getIdentity(cookies);
  // ensureAnonId, not a bare cookie read: a heartbeat must work even if this
  // is the first request the browser ever makes to us. A transient id (cookie
  // deleted mid-session) is deliberately not persisted, so it counts once.
  const anonId = ensureAnonId(cookies) || identity.anonId;
  if (!anonId) return new Response(null, { status: 204 });

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 204 });
  }
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) return new Response(null, { status: 204 });

  try {
    await heartbeat(memoryKeyFor(identity.userId, anonId), parsed.data.postId);
    if (Math.random() < 0.05) void prunePresence().catch(() => {});
  } catch {
    // Ambient. Never break the page over it.
  }
  return new Response(null, { status: 204 });
};

export const GET: APIRoute = async ({ url }) => {
  const postId = url.searchParams.get('postId') ?? '';
  if (!postId) {
    return new Response(JSON.stringify({ error: 'postId required.' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }
  const count = await readersNow(postId).catch(() => 0);
  return new Response(JSON.stringify({ readers: count }), {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });
};
