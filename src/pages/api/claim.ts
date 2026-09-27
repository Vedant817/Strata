import type { APIRoute } from 'astro';
import { requestHandleClaim } from '../../lib/repo/auth';
import { ANON_COOKIE } from '../../lib/prefs';

/**
 * Request a handle claim.
 *
 * There is no mailer wired up, so in development the claim link is handed back
 * to the page and shown on screen. That is stated plainly in the UI rather than
 * dressed up as a working confirmation email — a fake "check your inbox" is
 * worse than an honest gap, because it sends people looking for mail that will
 * never arrive.
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const form = await request.formData().catch(() => null);
  const handle = form?.get('handle');
  const email = form?.get('email');
  const anonId = (form?.get('anon') as string) || cookies.get(ANON_COOKIE)?.value || '';

  if (typeof handle !== 'string' || typeof email !== 'string') {
    return new Response('Missing handle or email.', { status: 400 });
  }

  const result = await requestHandleClaim({ handle, email, anonId });
  if (!result.ok) {
    return new Response(result.error, { status: 400 });
  }

  const site = new URL(request.url);
  const link = new URL(`/claim/${result.token}`, site).href;

  if (process.env.SMTP_HOST || process.env.RESEND_API_KEY) {
    // A real mailer drops the link here and the response below is all the UI needs.
    console.log('[strata] claim link (mailer not yet implemented):', link);
  } else {
    console.log('[strata] claim link issued (shown in the UI in development):', link);
  }

  const url = new URL('/write', site);
  url.searchParams.set('claim', result.token);
  return Response.redirect(url, 303);
};

export const GET: APIRoute = () => Response.redirect('/write#handle', 303);
