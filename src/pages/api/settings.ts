import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getIdentity } from '../../lib/repo/auth';
import { saveProfile } from '../../lib/repo/readerProfile';
import { DEPTH_COOKIE, DENSITY_COOKIE } from '../../lib/prefs';
import { safeReturnTo } from '../../lib/note-actions';

/**
 * Save reading preferences.
 *
 * Two writes, on purpose. The cookie is what this device reads on every page,
 * so it must be updated immediately or the reader's next click is ignored. The
 * profile is what a *different* device inherits. Writing only one of them is
 * how a settings page ends up that appears to work until you switch laptops.
 */
const schema = z.object({
  depth: z.enum(['skim', 'understand', 'master']),
  density: z.enum(['comfortable', 'compact', 'roomy']),
  returnTo: z.string().optional(),
});

export const POST: APIRoute = async ({ request, cookies, redirect, url }) => {
  const identity = await getIdentity(cookies);

  // Read the body once. A request stream can only be consumed a single time,
  // so a second formData() would arrive empty and every save would fail
  // validation.
  const form = await request.formData().catch(() => null);
  const back = safeReturnTo(form?.get('returnTo'), '/settings');
  const target = new URL(back, url);
  target.searchParams.delete('settingsError');
  target.searchParams.delete('saved');

  if (!identity.userId) return redirect('/write#handle', 303);

  const parsed = schema.safeParse(form ? Object.fromEntries(form) : null);
  if (!parsed.success) {
    target.searchParams.set('settingsError', 'Those settings did not look right.');
    return redirect(target.pathname + target.search, 303);
  }

  const year = 60 * 60 * 24 * 365;
  cookies.set(DEPTH_COOKIE, parsed.data.depth, { path: '/', maxAge: year, sameSite: 'lax' });
  cookies.set(DENSITY_COOKIE, parsed.data.density, { path: '/', maxAge: year, sameSite: 'lax' });
  await saveProfile(identity.userId, { depth: parsed.data.depth, density: parsed.data.density });

  target.searchParams.set('saved', '1');
  return redirect(target.pathname + target.search, 303);
};

export const GET: APIRoute = () => Response.redirect('/settings', 303);
