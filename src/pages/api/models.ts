import type { APIRoute } from 'astro';
import { getIdentity } from '../../lib/repo/auth';
import { modelsFor } from '../../lib/ai/ask';
import { getProvider } from '../../lib/ai/providers';

/**
 * The model catalogue for the picker.
 *
 * Two rules, both enforced here rather than in the browser:
 *   - The deployment's own keys only ever return free models. The owner's
 *     Groq and OpenRouter are a shared resource; a reader must not be able to
 *     spend the owner's money on a paid tier by editing a request.
 *   - A reader's own key gets the full catalogue, because it is their key.
 *
 * An unknown provider, or a provider with no usable key, returns an empty list
 * rather than an error — the picker simply shows the provider's default model.
 */
export const GET: APIRoute = async ({ url, cookies }) => {
  const providerId = url.searchParams.get('provider') ?? '';
  if (!getProvider(providerId)) {
    return new Response(JSON.stringify({ error: 'Unknown provider.' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }
  const identity = await getIdentity(cookies);
  const models = await modelsFor(providerId, identity.userId);
  return new Response(JSON.stringify({ models }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
};
