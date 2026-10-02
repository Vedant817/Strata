import type { APIRoute } from 'astro';
import { z } from 'zod';

/**
 * WebFinger: "who is @handle on this server?"
 *
 * Every fediverse server begins here. It answers with the actor URL and nothing
 * else — no email, no profile data, no confirmation that the account is anything
 * more than an actor. A discovery endpoint that leaks account existence and
 * metadata is a people-search API with extra steps.
 */

const QUERY = z.object({ resource: z.string().min(1).max(400) });

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/jrd+json; charset=utf-8' },
  });
}

/**
 * Prefer the configured site so actor ids stay stable behind a preview
 * hostname. A moving actor id makes every remote server re-follow.
 */
function siteOrigin(url: URL): string {
  const configured = import.meta.env.SITE_URL as string | undefined;
  if (configured) return new URL(configured).origin;
  return url.origin;
}

const NOT_OURS = { error: 'That host is not this server.' };
const MALFORMED = { error: 'Malformed acct: resource.' };

export const GET: APIRoute = async ({ url }) => {
  const parsed = QUERY.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return json({ error: 'A resource is required.' }, 400);

  const raw = parsed.data.resource.trim();
  // Only acct: is answered. Reflecting arbitrary https:// hosts back as links
  // would turn this into an open redirect with a JSON content type.
  if (raw.slice(0, 5).toLowerCase() !== 'acct:') {
    return json({ error: 'Only acct: resources are supported.' }, 400);
  }

  const rest = raw.slice(5);

  /*
   * Split on the last `@` with a slice, never `split(':')`. A local resource is
   * `acct:user@host:port`, so splitting on every colon detaches the port and the
   * host then never matches what was actually asked.
   */
  const at = rest.lastIndexOf('@');
  if (at <= 0) return json(MALFORMED, 400);

  const handle = rest.slice(0, at).toLowerCase();
  const asked = rest.slice(at + 1).toLowerCase();
  if (!/^[a-z0-9._-]{1,32}$/.test(handle) || asked.length === 0) {
    return json(MALFORMED, 400);
  }

  const origin = siteOrigin(url);

  /*
   * Answer for the host actually being asked as well as the configured site.
   * Comparing only against `SITE_URL` looks correct and is not: in dev and on
   * preview deploys the configured origin is production while the request host
   * is something else, so every lookup 404s and the feature is only testable on
   * the single host it deploys to. Same trap as the WebAuthn relying-party id.
   */
  const ours = [new URL(origin).host.toLowerCase(), url.host.toLowerCase()];
  if (!ours.includes(asked)) return json(NOT_OURS, 404);

  const actor = origin + '/@' + encodeURIComponent(handle);

  return json({
    subject: 'acct:' + handle + '@' + new URL(origin).host,
    aliases: [actor],
    links: [
      { rel: 'self', type: 'application/activity+json', href: actor },
      // Lets a personal site verify the link in the other direction without a
      // third party vouching for it.
      {
        rel: 'http://webfinger.net/rel/profile-page',
        type: 'text/html',
        href: origin + '/a/' + encodeURIComponent(handle),
      },
    ],
  });
};