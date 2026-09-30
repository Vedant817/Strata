import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getIdentity } from '../../lib/repo/auth';
import { removeKey, setKey, setModel } from '../../lib/repo/providerKeys';
import { getProvider } from '../../lib/ai/providers';
import { isByokEnabled } from '../../lib/ai/secrets';
import { safeReturnTo } from '../../lib/note-actions';

/**
 * Bring-your-own-key management.
 *
 * Four actions, all ordinary form posts so they work with JavaScript off. The
 * key is accepted, sealed immediately, and never echoed: the redirect carries
 * only a status, so a key cannot end up in a URL, a referrer header, or the
 * browser history.
 *
 * If KEY_ENCRYPTION_SECRET is absent, every write is refused rather than
 * silently storing plaintext. A settings page that quietly degrades to
 * plaintext when someone forgets an env var is the failure mode this whole
 * module exists to prevent.
 */

const keySchema = z.object({
  action: z.literal('add'),
  providerId: z.string().min(1).max(40),
  apiKey: z.string().min(12).max(400),
  model: z.string().max(120).optional(),
  returnTo: z.string().optional(),
});
const modelSchema = z.object({
  action: z.literal('model'),
  providerId: z.string().min(1).max(40),
  model: z.string().min(1).max(120),
  returnTo: z.string().optional(),
});
const removeSchema = z.object({
  action: z.literal('remove'),
  providerId: z.string().min(1).max(40),
  returnTo: z.string().optional(),
});

export const POST: APIRoute = async ({ request, cookies, redirect, url }) => {
  const identity = await getIdentity(cookies);
  const form = await request.formData().catch(() => null);
  const back = safeReturnTo(form?.get('returnTo'), '/settings');
  const target = new URL(back, url);
  target.searchParams.delete('keysError');
  target.searchParams.delete('keysDone');
  target.searchParams.delete('keys');

  if (!identity.userId) return redirect('/write#handle', 303);

  const fail = (message: string) => {
    target.searchParams.set('keysError', message);
    return redirect(target.pathname + target.search, 303);
  };
  const done = (message: string) => {
    target.searchParams.set('keysDone', message);
    return redirect(target.pathname + target.search, 303);
  };

  if (!isByokEnabled()) {
    return fail('Bring-your-own-key is disabled: the server has no KEY_ENCRYPTION_SECRET, so a key cannot be stored safely.');
  }

  const raw = form ? Object.fromEntries(form) : null;

  const asKey = keySchema.safeParse(raw);
  if (asKey.success) {
    if (!getProvider(asKey.data.providerId)) return fail('Unknown provider.');
    const result = await setKey(
      identity.userId,
      asKey.data.providerId,
      asKey.data.apiKey,
      asKey.data.model,
    );
    if (!result.ok) return fail(result.error);
    return done('Key saved. It is encrypted at rest and never shown again.');
  }

  const asModel = modelSchema.safeParse(raw);
  if (asModel.success) {
    const ok = await setModel(identity.userId, asModel.data.providerId, asModel.data.model);
    if (!ok) return fail('No key stored for that provider.');
    return done('Model chosen.');
  }

  const asRemove = removeSchema.safeParse(raw);
  if (asRemove.success) {
    const ok = await removeKey(identity.userId, asRemove.data.providerId);
    if (!ok) return fail('No key stored for that provider.');
    return done('Key deleted. It is gone from the system.');
  }

  return fail('That did not look like a valid request.');
};

export const GET: APIRoute = () => Response.redirect('/settings', 303);
