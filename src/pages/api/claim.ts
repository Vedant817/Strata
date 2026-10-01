import type { APIRoute } from 'astro';
import { requestHandleClaim } from '../../lib/repo/auth';
import { isMailConfigured, sendMail } from '../../lib/mail';
import { ANON_COOKIE } from '../../lib/prefs';

/**
 * Request a handle claim.
 *
 * The link goes out by email when a mailer is configured. When none is, the
 * page shows the link on screen instead — stated plainly in the UI rather
 * than dressed up as a working confirmation email.
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const form = await request.formData().catch(() => null);
  const handle = form?.get('handle');
  const email = form?.get('email');
  /* The cookie is the identity, never the form field. A hidden field is
     attacker-supplied: honouring it would let one browser claim another's
     notes, and a stale field would orphan the very notes being claimed. The
     field stays only so the form works before the cookie is set. */
  const anonId = cookies.get(ANON_COOKIE)?.value || (form?.get('anon') as string) || '';

  if (typeof handle !== 'string' || typeof email !== 'string') {
    return new Response('Missing handle or email.', { status: 400 });
  }

  const result = await requestHandleClaim({ handle, email, anonId });
  if (!result.ok) {
    return new Response(result.error, { status: 400 });
  }

  const site = new URL(request.url);
  const link = new URL(`/claim/${result.token}`, site).href;
  const cleanHandle = handle.trim().toLowerCase();

  // If the mailer is configured, the link travels by email and the page must
  // not also print it — a claim link on screen is a claim link anyone reading
  // over a shoulder can use. If sending fails, say so; do not pretend.
  let mailed = false;
  if (isMailConfigured()) {
    const sent = await sendMail({
      to: email.trim().toLowerCase(),
      subject: `Claim @${cleanHandle} on Strata`,
      text: [
        `Someone — hopefully you — asked to claim the handle @${cleanHandle}.`,
        '',
        `Open this link within 20 minutes to attach it to your notes:`,
        link,
        '',
        'If that was not you, ignore this. The handle stays unclaimed.',
      ].join('\n'),
    });
    if (!sent.ok) {
      console.error('[strata] claim email failed:', sent.error);
      /* Distinguish the two failures that look identical to the reader, because
         only one of them is worth retrying.
           - "domain not verified" (403) means the *sender* is unconfigured. That
             is ours to fix; asking the writer to try again would send them round
             the loop forever.
           - anything else is usually the address, which the writer can fix. */
      const senderProblem = /not verified|domain/i.test(sent.error);
      return new Response(
        senderProblem
          ? 'Your claim is recorded, but this site cannot send email yet — the sending address is not verified. Nothing was lost: ask again once mail is working.'
          : 'The claim was recorded but the email could not be sent. Check the address, or ask for a new link and try again.',
        { status: 502 },
      );
    }
    mailed = true;
  } else {
    console.log('[strata] claim link issued (shown in the UI; no mailer configured):', link);
  }

  const url = new URL('/write', site);
  // Without mail the token is the only way back to the claim, so it travels
  // in the URL. With mail it never touches the page.
  if (!mailed) url.searchParams.set('claim', result.token);
  else url.searchParams.set('mailed', cleanHandle);
  return Response.redirect(url, 303);
};

export const GET: APIRoute = ({ redirect }) => redirect('/write#handle', 303);
