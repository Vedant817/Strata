import { chatGrounded } from './client';
import { houseKeyFor, listModels, chooseChatModel } from './catalog';
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

/**
 * Every transport worth trying, in order: the reader's own key first, then each
 * configured house key. A list rather than a single answer, because one
 * provider declining does not mean nobody can answer.
 */
async function candidates(userId: string | null): Promise<Resolved[]> {
  const out: Resolved[] = [];

  if (userId) {
    const key = await resolveKey(userId, 'anthropic').catch(() => null);
    if (key) {
      const model = (await chosenModel(userId, 'anthropic').catch(() => null)) ?? 'claude-sonnet-4-5';
      out.push({ providerId: 'anthropic', model, key, paidBy: 'reader' });
    }
  }

  for (const candidate of ['openrouter', 'groq', 'anthropic']) {
    const key = houseKeyFor(candidate);
    if (!key) continue;
    const provider = getProvider(candidate);
    if (!provider) continue;
    /* Ask the live catalogue which model to call rather than trusting the
       configured `fallbackModel`. That constant was a hardcoded id that quietly
       died — Groq stopped serving its Llama slug and OpenRouter withdrew the
       `:free` twin — so every request 404'd and Ask fell back to plain quotes
       without ever saying why. The catalogue is what is actually on offer now. */
    let model = provider.fallbackModel;
    try {
      const live = await listModels(candidate, key, { freeOnly: true });
      model = chooseChatModel(live, candidate) ?? model;
    } catch {
      // Catalogue unavailable: the configured fallback is better than nothing.
    }
    out.push({ providerId: candidate, model, key, paidBy: 'house' });
  }

  return out;
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

  let options: Resolved[];
  try {
    options = await candidates(userId);
  } catch (err) {
    console.error('[strata] model resolve failed:', err);
    return null;
  }

  const grounded = passages.map((p) => p.replace(/<\/?mark>/g, ''));

  /* Try each in turn and take the first real answer.
     Previously this resolved exactly one transport and returned null the moment
     it declined: OpenRouter's model would abstain, and because it was tried
     first, the one provider that would have answered never got asked. An
     abstention is an answer about *that model*, not about the question. */
  let lastFailure: string | null = null;
  for (const chosen of options) {
    const budget = await checkBudget(postId, chosen.providerId).catch(() => ({ ok: true }));
    if (!budget.ok) {
      lastFailure = `budget exhausted for ${chosen.providerId}`;
      continue;
    }

    const result = await chatGrounded({
      providerId: chosen.providerId,
      apiKey: chosen.key,
      model: chosen.model,
      passages: grounded,
      question,
    }).catch(() => null);

    await recordCall(postId, chosen.providerId, result?.ok ?? false).catch(() => {});

    if (result && result.ok && result.outcome === 'answered') {
      return {
        text: result.text,
        model: result.model,
        providerId: chosen.providerId,
        label: `${chosen.providerId} / ${result.model}`,
        latencyMs: result.latencyMs,
      };
    }
    lastFailure = result?.error ?? `${chosen.providerId} did not answer`;
  }

  if (lastFailure) console.log('[strata] no model answered this question:', lastFailure);
  return null;
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
