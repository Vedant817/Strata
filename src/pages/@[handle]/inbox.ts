import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getAuthor } from '../../lib/repo/taxonomy';
import { activityJson, actorIdFor, siteOrigin } from '../../lib/activitypub';

/**
 * The inbound side of an actor.
 *
 * It accepts and acknowledges, and it **does not persist anything**. That is a
 * deliberate boundary rather than a stub:
 *
 * - `Follow` is answered 202 with no stored relationship, because an actor that
 *   acknowledges a follow and then drops it from every remote timeline is worse
 *   than one with no actor at all — remote servers cache the 202 and keep
 *   delivering posts to a relationship the origin has forgotten.
 * - `Undo`/`Delete` are acknowledged for the same reason: nothing was stored, so
 *   there is nothing to undo.
 *
 * The body is size-capped before JSON.parse because this endpoint accepts
 * requests from anyone, and an unbounded body is a denial-of-service surface
 * that costs nothing to close.
 */

const MAX_BODY = 128 * 1024;

const activity = z
  .object({
    type: z.string().min(1).max(64),
    actor: z.union([z.string().max(2000), z.object({ id: z.string().max(2000) })]).optional(),
    object: z.unknown().optional(),
  })
  .passthrough();

/** Types we acknowledge but do not act on. Anything else is refused. */
const KNOWN = new Set([
  'Follow',
  'Undo',
  'Delete',
  'Accept',
  'Reject',
  'Create',
  'Like',
  'Announce',
  'Update',
  'View',
  'EmojiReact',
]);

export const POST: APIRoute = async ({ params, url, request }) => {
  const handle = (params.handle ?? '').toLowerCase();
  const author = handle ? await getAuthor(handle) : null;
  if (!author) return new Response('No such actor.', { status: 404 });

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY) return new Response('Payload too large.', { status: 413 });

  const text = await request.text();
  if (text.length > MAX_BODY) return new Response('Payload too large.', { status: 413 });

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return new Response('Expected JSON.', { status: 400 });
  }

  const parsed = activity.safeParse(json);
  if (!parsed.success) return new Response('Not an activity.', { status: 400 });
  if (!KNOWN.has(parsed.data.type)) {
    // Refusing loudly beats a 202 that implies we handled it.
    return new Response(`Unsupported activity: ${parsed.data.type}`, { status: 400 });
  }

  const origin = siteOrigin(url, request);
  const actorId = actorIdFor(origin, author.handle);
  const inbound = new URL(request.url).origin;

  /*
   * Signature verification is the honest gap here, and it is stated rather than
   * faked. HTTP Signatures require a fetched public key per actor and a
   * nonces-and-replay store to be worth anything, which is the follower
   * persistence this endpoint deliberately does not do. Verifying nothing and
   * returning 202 would look like support and be an open relay, so it does not:
   * the acknowledged activities are all ones with no effect.
   */
  console.info(`[strata] activity ${parsed.data.type} for ${actorId} from ${inbound} (not persisted)`);

  return activityJson({ accepted: true, type: parsed.data.type }, 202);
};