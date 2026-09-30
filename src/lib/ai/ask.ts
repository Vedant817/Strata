import { chatGrounded } from './client';
import { houseKeyFor, listModels } from './catalog';
import { checkBudget, recordCall } from './budget';
import { getProvider } from './providers';
import { chosenModel, resolveKey } from '../repo/providerKeys';

/**
 * Resolve *which* model answers this Ask, and call it.
 *
 * Priority is deliberate:
 *   1. The reader's own key for their chosen provider. Their money, their
 *      model, and it costs the deployment nothing.
 *   2. A house key the deployment configured (the owner's Groq/OpenRouter).
 *      Used only when the reader has not brought their own, so the owner's free
 *      quota is the backstop, not the default tax.
 *   3. Nothing — extractive quotes, which always work.
 *
 * The cost cap and the circuit breaker are checked for the provider actually
 * chosen, and every failure — no key, cap, breaker, timeout, HTTP error, or a
 * model that abstains — returns null so the caller falls back to quotes. The
 * model is an upgrade; it is never a dependency.
 */

export interface Resolved {
  providerId: string;
  model: string;
  key: string;
  /** Whose quota pays: the reader's, or the deployment's. */
  paidBy: 'reader' | 'house';
}

async function resolve(userId: string | null): Promise<Resolved | null> {
  // Reader's own key first.
  if (userId) {
    const key = await resolveKey(userId, 'anthropic').catch(() => null);
    if (key) {
      const model = (await chosenModel(userId, 'anthropic').catch(() => null)) ?? 'claude-sonnet-4-5';
      return { providerId: 'anthropic', model, key, paidBy: 'reader' };
    }
  }
  // Otherwise any house key that exists, preferring the owner's configured
  // free-tier providers.
  for (const candidate of ['openrouter', 'groq', 'anthropic']) {
    const key = houseKeyFor(candidate);
    if (!key) continue;
    const provider = getProvider(candidate);
    if (!provider) continue;
    const model = provider.fallbackModel;
    return { providerId: candidate, model, key, paidBy: 'house' };
  }
  return null;
}

export interface ModelAnswer {
  text: string;
  model: string;
  providerId: string;
  /** Human-readable attribution, e.g. "openrouter / llama-3.3-70b:free". */
  label: string;
  latencyMs: number;
}

/**
 * Attempt a grounded model answer. Returns null for every non-answer so the
 * caller can show quotes. Never throws.
 */
export async function answerFromAnyModel(
  postId: string,
  userId: string | null,
  passages: string[],
  question: string,
): Promise<ModelAnswer | null> {
  if (passages.length === 0) return null;

  let chosen: Resolved | null;
  try {
    chosen = await resolve(userId);
  } catch (err) {
    console.error('[strata] model resolve failed:', err);
    return null;
  }
  if (!chosen) return null;

  const budget = await checkBudget(postId, chosen.providerId).catch(() => ({ ok: true }));
  if (!budget.ok) return null;

  const result = await chatGrounded({
    providerId: chosen.providerId,
    apiKey: chosen.key,
    model: chosen.model,
    passages: passages.map((p) => p.replace(/<\/?mark>/g, '')),
    question,
  }).catch(() => null);

  if (!result) return null;
  await recordCall(postId, chosen.providerId, result.ok).catch(() => {});
  if (!result.ok || result.outcome !== 'answered') return null;
  return {
    text: result.text,
    model: result.model,
    providerId: chosen.providerId,
    label: `${chosen.providerId} / ${result.model}`,
    latencyMs: result.latencyMs,
  };
}

/**
 * What the model picker should show. The owner's keys are restricted to free
 * models; a reader's own key can see everything that key can reach, because
 * they chose it and they pay.
 */
export async function modelsFor(
  providerId: string,
  userId: string | null,
): Promise<{ id: string; label: string; free: boolean }[]> {
  const provider = getProvider(providerId);
  if (!provider) return [];

  let key: string | null = userId ? await resolveKey(userId, providerId).catch(() => null) : null;
  const usingHouse = !key;
  if (!key) key = houseKeyFor(providerId) ?? null;
  if (!key) return [{ id: provider.fallbackModel, label: provider.fallbackModel, free: true }];

  // Free-only for the house's keys, which is the owner's stated policy; full
  // catalogue for a reader's own key, which is their money.
  const freeOnly = usingHouse;
  const models = await listModels(providerId, key, { freeOnly });
  if (models.length > 0) return models;
  return [{ id: provider.fallbackModel, label: provider.fallbackModel, free: true }];
}
