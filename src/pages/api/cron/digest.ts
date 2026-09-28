import type { APIRoute } from 'astro';
import { buildDigest, getDigestSubscribers, renderDigestText } from '../../../lib/repo/digest';
import { isMailConfigured, sendMail } from '../../../lib/mail';

/**
 * Weekly digest sender. Called by the scheduled workflow, or by hand.
 *
 * Auth is a shared secret, not a session: cron has no browser and no handle.
 * Without CRON_SECRET set, everything 401s — including the preview below, so
 * a misconfigured scheduler fails loudly instead of silently never sending.
 * Empty weeks send nothing and say so; "you have 0 new posts" is exactly the
 * notification §1.1 bans.
 */
function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get('authorization') ?? '';
  const query = new URL(request.url).searchParams.get('secret') ?? '';
  return header === `Bearer ${secret}` || (query !== '' && query === secret);
}

export const POST: APIRoute = async ({ request }) => {
  if (!authorized(request)) {
    return new Response(JSON.stringify({ error: 'Unauthorized.' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const site = new URL(request.url).origin;
  const since = Date.now() - 7 * 86_400_000;
  const digest = await buildDigest(since);
  if (digest.items.length === 0) {
    return new Response(JSON.stringify({ sent: 0, reason: 'Quiet week — nothing new or revised.' }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  const subscribers = await getDigestSubscribers();
  if (subscribers.length === 0) {
    return new Response(JSON.stringify({ sent: 0, reason: 'Nobody subscribed yet.' }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  if (!isMailConfigured()) {
    return new Response(
      JSON.stringify({
        sent: 0,
        reason: 'No RESEND_API_KEY configured. Digest built but not sent.',
        items: digest.items.length,
        subscribers: subscribers.length,
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  }

  const { subject, text } = renderDigestText(digest, site);
  let sent = 0;
  const failed: string[] = [];
  for (const to of subscribers) {
    const result = await sendMail({ to, subject, text });
    if (result.ok) sent++;
    else failed.push(to);
  }
  return new Response(JSON.stringify({ sent, failed: failed.length, items: digest.items.length }), {
    headers: { 'content-type': 'application/json' },
  });
};

export const GET: APIRoute = () =>
  new Response(JSON.stringify({ error: 'POST with the cron secret.' }), {
    status: 405,
    headers: { 'content-type': 'application/json', allow: 'POST' },
  });
