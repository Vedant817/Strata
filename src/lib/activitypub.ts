import { getAuthor, listAll } from './repo/taxonomy';

/**
 * ActivityPub documents for an author.
 *
 * Scope, stated plainly: this is the **outbound** half. Strata can be
 * discovered over WebFinger, followed, and its posts federated as `Create`
 * activities pointing at the canonical article URL.
 *
 * The inbound half deliberately does not persist follows. Accepting a `Follow`
 * and then forgetting it produces an actor that appears to have followers it
 * silently drops from every remote timeline — worse than having no actor at all,
 * because remote servers cache the 202 and keep trying. Persisting them belongs
 * with the rest of the deferred infrastructure, not bolted on here.
 *
 * Every `id` is an absolute URL. That is not decoration: a relative id cannot be
 * dereferenced by a remote server, and dereferencing ids is the entire protocol.
 */

export const ACTIVITY_JSON = 'application/activity+json; charset=utf-8';

export function siteOrigin(url: URL, request?: Request): string {
  // Prefer the configured site so ids stay stable behind a preview hostname —
  // a moving actor id makes every remote server re-follow.
  const configured = import.meta.env.SITE_URL as string | undefined;
  if (configured) return new URL(configured).origin;
  if (request) {
    const host = request.headers.get('host');
    if (host) return `${new URL(url.origin).protocol}//${host}`;
  }
  return url.origin;
}

export function actorIdFor(origin: string, handle: string): string {
  return `${origin}/@${encodeURIComponent(handle.toLowerCase())}`;
}

export function activityJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': ACTIVITY_JSON,
      // Cheap, but a handle can change and a remote cache should notice within
      // an hour rather than pinning a deleted actor.
      'cache-control': 'public, max-age=300',
    },
  });
}

export async function buildActor(input: {
  url: URL;
  request?: Request;
  handle: string;
}): Promise<Response> {
  const author = await getAuthor(input.handle.toLowerCase());
  if (!author) return new Response('No such actor.', { status: 404 });

  const origin = siteOrigin(input.url, input.request);
  const actorId = actorIdFor(origin, author.handle);

  return activityJson({
    '@context': ['https://www.w3.org/ns/activitystreams', 'https://w3id.org/security/v1'],
    id: actorId,
    type: 'Person',
    preferredUsername: author.handle,
    name: author.displayName || author.handle,
    summary: author.bio || '',
    url: `${origin}/a/${author.handle}`,
    inbox: `${actorId}/inbox`,
    outbox: `${actorId}/outbox`,
    followers: `${actorId}/followers`,
    // Manual approval: Strata is a curated publication, and an open relay is
    // not the product.
    manuallyApprovesFollowers: true,
    discoverable: true,
  });
}

export async function buildFollowers(input: {
  url: URL;
  request?: Request;
  handle: string;
}): Promise<Response> {
  const origin = siteOrigin(input.url, input.request);
  const actorId = actorIdFor(origin, input.handle);
  // An empty ordered collection rather than an omitted property: a missing
  // `followers` is an error to most servers, whereas an empty one is understood.
  return activityJson({
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `${actorId}/followers`,
    type: 'OrderedCollection',
    totalItems: 0,
    orderedItems: [],
  });
}

export async function buildOutbox(input: {
  url: URL;
  request?: Request;
  handle: string;
}): Promise<Response> {
  const handle = input.handle.toLowerCase();
  const author = await getAuthor(handle);
  if (!author) return new Response('No such outbox.', { status: 404 });

  const origin = siteOrigin(input.url, input.request);
  const actorId = actorIdFor(origin, author.handle);

  const published = (await listAll())
    .filter((p) => p.authorHandle.toLowerCase() === handle)
    .sort((a, b) => timeOf(b) - timeOf(a))
    .slice(0, 20);

  const items = published.map((p) => {
    const articleUrl = `${origin}/w/${p.slug}`;
    const when = new Date(timeOf(p)).toISOString();
    return {
      id: `${articleUrl}/activity`,
      type: 'Create',
      actor: actorId,
      published: when,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [`${actorId}/followers`],
      object: {
        id: articleUrl,
        type: 'Note',
        attributedTo: actorId,
        // Several servers show only `name` in a timeline, so it carries the
        // title rather than being left blank.
        name: p.title,
        summary: p.dek || '',
        // Plain text on purpose. Federation is distribution; the argument
        // belongs at the canonical URL, which is this publication's premise.
        content: p.dek || p.title,
        url: articleUrl,
        published: when,
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        cc: [`${actorId}/followers`],
      },
    };
  });

  return activityJson({
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `${actorId}/outbox`,
    type: 'OrderedCollection',
    totalItems: items.length,
    orderedItems: items,
  });
}

function timeOf(p: { publishedAt?: number | Date | null; createdAt?: number | Date | null }): number {
  const raw = p.publishedAt ?? p.createdAt;
  if (raw === null || raw === undefined) return 0;
  return raw instanceof Date ? raw.getTime() : Number(raw);
}