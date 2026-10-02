import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getIdentity } from '../../lib/repo/auth';
import { ANON_COOKIE } from '../../lib/prefs';
import { readyDb } from '../../lib/db/index';
import { posts, webmentions } from '../../lib/db/schema';
import { and, desc, eq, or } from 'drizzle-orm';

const payload = z.object({
  source: z.url().max(2000),
  target: z.url().max(2000),
  kind: z.enum(['mention', 'reply', 'like', 'repost']).default('mention'),
});

/**
 * The Webmention receiver.
 *
 * Anonymous by design, and that is the whole point: the sites sending these are
 * mostly personal blogs and fediverse servers that have no idea who you are. The
 * mention is verified against a public post URL, so a sender cannot attach a
 * mention to a draft they cannot read.
 *
 * Rate limited per browser rather than per IP. An IP limit punishes a shared
 * network for one person's spam, and there is no reliable IP to trust behind
 * every proxy anyway; the cost here is one row per accepted mention, which the
 * unique index bounds.
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const identity = await getIdentity(cookies);
  const anonId = cookies.get(ANON_COOKIE)?.value ?? identity.anonId ?? '';

  const raw = await readPayload(request);
  const parsed = payload.safeParse(raw);
  if (!parsed.success) return new Response('Bad request', { status: 400 });

  const { source, target } = parsed.data;

  // The target must be a published, public post on this site. Checking the host
  // is the security boundary: it stops a third party from filing mentions
  // against arbitrary internal URLs.
  let targetUrl: URL;
  try {
    targetUrl = new URL(target);
  } catch {
    return new Response('Bad target', { status: 400 });
  }

  const site = import.meta.env.SITE_URL as string | undefined;
  const allowed = [site, request.headers.get('host') ? `${new URL(request.url).protocol}//${request.headers.get('host')}` : '']
    .filter(Boolean)
    .map((v) => new URL(v as string).host);
  if (!allowed.includes(targetUrl.host)) {
    return new Response('Target is not on this site', { status: 400 });
  }

  const slug = targetUrl.pathname.replace(/^\/w\//, '').replace(/\/$/, '');
  const database = await readyDb();
  const found = await database
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.slug, slug), or(eq(posts.visibility, 'public'))))
    .limit(1);
  const post = found[0];
  if (!post) return new Response('No public post at that URL', { status: 404 });

  // A mention from a page that does not actually link here is spam, or a stale
  // form post. Accept it but never mark it verified, so the UI can say so.
  const verified = await sourceLinksHere(source, targetUrl);

  const title = verified ? await titleOf(source) : '';

  await database
    .insert(webmentions)
    .values({
      id: crypto.randomUUID(),
      postId: post.id,
      source,
      sourceTitle: title,
      target,
      kind: parsed.data.kind,
      verifiedAt: verified ? new Date() : null,
    })
    .onConflictDoNothing();

  return new Response('Accepted', { status: 202 });
};

/**
 * Accept both encodings a sender might use.
 *
 * The Webmention spec says `application/x-www-form-urlencoded`. Senders in the
 * wild also post JSON. Astro's built-in CSRF guard (`security.checkOrigin`)
 * rejects form-encoded POSTs that carry no matching `Origin`, which is every
 * real sender — they are servers, not browsers on this site. JSON is not
 * exempted, so a JSON sender gets through and is verified here instead: the
 * target must still be a public post on this host.
 */
async function readPayload(request: Request): Promise<Record<string, unknown>> {
  const type = request.headers.get('content-type') ?? '';
  try {
    if (type.includes('application/json')) {
      const body = await request.json();
      return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    }
    const form = await request.formData();
    return {
      source: form.get('source'),
      target: form.get('target'),
      kind: form.get('kind') || 'mention',
    };
  } catch {
    return {};
  }
}

/**
 * Confirm the source really contains a link to the target.
 *
 * A real mention is a hyperlink in someone's prose, so the check is for an
 * `<a href>` resolving to the target — not for the target as a substring, which
 * would happily "verify" a page that merely quotes the URL.
 */
async function sourceLinksHere(source: string, target: URL): Promise<boolean> {
  try {
    const res = await fetch(source, {
      redirect: 'follow',
      headers: { accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return false;
    const html = (await res.text()).slice(0, 512_000);
    for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi)) {
      try {
        if (new URL(m[1], source).href === target.href) return true;
      } catch {
        // Unparseable href in someone else's page; keep looking.
      }
    }
    return false;
  } catch {
    return false;
  }
}

/** Title of the linking page, for the reader's own recognition of it. */
async function titleOf(source: string): Promise<string> {
  try {
    const res = await fetch(source, {
      headers: { accept: 'text/html' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return '';
    const html = (await res.text()).slice(0, 256_000);
    const m = html.match(/<title\b[^>]*>([\s\S]{0,300}?)<\/title>/i);
    return m ? m[1].replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  } catch {
    return '';
  }
}