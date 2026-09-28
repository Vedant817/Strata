import type { APIRoute } from 'astro';
import { isMailConfigured, sendMail } from '../../../lib/mail';
import { markNotified, pendingNotices, type RevisionNotice } from '../../../lib/repo/subscriptions';

/**
 * Send revision notices. The maintenance flywheel's delivery step.
 *
 * Same secret-gated shape as the digest: a scheduler has no browser and no
 * handle, so this is a POST with a bearer token, and without CRON_SECRET it
 * 401s rather than running open.
 *
 * Two rules, from the plan:
 *   - Only a *major* revision notifies (handled in the query). A typo fix is
 *     not news, and a subscriber who learns to ignore the mail stops reading.
 *   - The send is idempotent per (post, version), enforced in the data. If the
 *     mailer is down, `markNotified` is never reached, so the notice is
 *     retried next run instead of being silently consumed.
 */
function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get('authorization') ?? '';
  const query = new URL(request.url).searchParams.get('secret') ?? '';
  return header === `Bearer ${secret}` || (query !== '' && query === secret);
}

function render(n: RevisionNotice, site: string): { subject: string; text: string } {
  return {
    subject: `Revised: ${n.title}`,
    text: [
      `${n.authorName} revised "${n.title}" — ${n.changeSummary}`,
      '',
      `${site}/w/${n.slug}`,
      '',
      'You asked to hear when this post changed. This is that.',
      'To stop hearing about it, unsubscribe from the post page.',
    ].join('\n'),
  };
}

export const POST: APIRoute = async ({ request }) => {
  if (!authorized(request)) {
    return new Response(JSON.stringify({ error: 'Unauthorized.' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  // Look back a fortnight so a missed run is caught, not lost.
  const since = Date.now() - 14 * 86_400_000;
  const notices = await pendingNotices(since);
  if (notices.length === 0) {
    return new Response(JSON.stringify({ sent: 0, posts: 0, reason: 'No un-notified major revisions.' }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  if (!isMailConfigured()) {
    return new Response(
      JSON.stringify({
        sent: 0,
        posts: notices.length,
        reason: 'No RESEND_API_KEY configured. Notices built but not sent.',
        pending: notices.map((n) => n.slug),
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  }

  const site = new URL(request.url).origin;
  let sent = 0;
  const done: string[] = [];
  for (const n of notices) {
    const { subject, text } = render(n, site);
    let allOk = true;
    for (const to of n.emails) {
      const r = await sendMail({ to, subject, text });
      if (r.ok) sent++;
      else allOk = false;
    }
    // Only mark when every send succeeded, so a partial failure retries the
    // whole post next run rather than dropping the stragglers forever.
    if (allOk) {
      await markNotified(n.postId, n.versionId);
      done.push(n.slug);
    }
  }
  return new Response(JSON.stringify({ sent, posts: done.length, slugs: done }), {
    headers: { 'content-type': 'application/json' },
  });
};

export const GET: APIRoute = () =>
  new Response(JSON.stringify({ error: 'POST with the cron secret.' }), {
    status: 405,
    headers: { 'content-type': 'application/json', allow: 'POST' },
  });
