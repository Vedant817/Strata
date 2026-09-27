import type { APIRoute } from 'astro';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { readyDb } from '../../lib/db';
import { newsletterSubscribers } from '../../lib/db/schema';
import { nanoid } from '../../lib/ids';
import { safeReturnTo } from '../../lib/note-actions';

/**
 * Newsletter signup. Single opt-in, deduplicated, no theatrics.
 *
 * What this is: a list of inboxes that asked for the weekly digest. What it
 * is not: a sender — delivery needs a scheduler that does not exist here yet,
 * and the footer says "one email a week" rather than promising a date. When
 * the digest sends, it sends to exactly this table.
 */
const schema = z.object({
  email: z.string().trim().toLowerCase().max(320).refine(
    (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v),
    'That does not look like an email address.',
  ),
  returnTo: z.string().optional(),
});

export const POST: APIRoute = async ({ request, redirect, url }) => {
  const form = await request.formData().catch(() => null);
  const back = safeReturnTo(form?.get('returnTo'), '/');
  const target = new URL(back, url);
  target.searchParams.delete('newsletter');

  const parsed = schema.safeParse(form ? Object.fromEntries(form) : null);
  if (!parsed.success) {
    target.searchParams.set('newsletter', 'error');
    return redirect(target.pathname + target.search, 303);
  }

  const database = await readyDb();
  const existing = await database
    .select({ id: newsletterSubscribers.id })
    .from(newsletterSubscribers)
    .where(eq(newsletterSubscribers.email, parsed.data.email))
    .limit(1);
  if (existing.length === 0) {
    await database.insert(newsletterSubscribers).values({ id: nanoid(), email: parsed.data.email });
  }
  // Already-subscribed is also success: confirming it would leak which emails
  // are on the list to anyone who tries them.
  target.searchParams.set('newsletter', 'done');
  return redirect(target.pathname + target.search, 303);
};

export const GET: APIRoute = () => Response.redirect('/', 303);
