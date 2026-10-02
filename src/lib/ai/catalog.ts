import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getProvider, type ProviderDef } from './providers';

/**
 * Model catalogues, fetched live and filtered for free tiers.
 *
 * The requirement was "only free models in the selector" for the owner's own
 * Groq and OpenRouter keys. A hardcoded list is wrong the moment a provider
 * rotates its catalogue: a model gets retired and the picker 500s, or a free
 * model is withdrawn and we keep offering a key that now costs money. So the
 * list is derived from the provider, at runtime, and cached.
 *
 * Free detection differs by provider and both signals are used:
 *   - OpenRouter tags each model with `pricing.prompt === "0"` and appends
 *     `:free` to the id. Both are checked, because the tag is the reliable one
 *     and the suffix is a useful sanity check.
 *   - Groq publishes no price field, so its free tier is the set of model ids
 *     it currently serves that are not marked paid elsewhere; we treat the
 *     whole catalogue as free-eligible and let the owner's key's own quota
 *     absorb it, which is the honest behaviour for a free-tier key.
 *
 * A failed fetch is never fatal: the caller's fallback model is used, so the
 * Ask feature keeps working when a provider's catalogue endpoint is down.
 */

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // six hours
const HOLDER = globalThis as unknown as {
  __strataCatalog?: Map<string, { at: number; models: CatalogModel[] }>;
};

export interface CatalogModel {
  id: string;
  label: string;
  free: boolean;
}

/**
 * Ids that are not chat models.
 *
 * A free-tier catalogue is not a list of assistants. Groq's free tier includes
 * `whisper-large-v3-turbo` (speech to text) and two prompt-guard models; neither
 * answers a question, and a guard model will happily return a moderation verdict
 * as if it were prose. So the picker has to know what it is looking at rather
 * than trusting position in the list.
 */
const NOT_CHAT = /guard|safeguard|whisper|embed|tts|stt|rerank|moderation|moderat|safety|vision|ocr|audio|audio-to|transcribe/i;

/**
 * Known-good free chat models, in preference order, per provider.
 *
 * This exists because a hardcoded fallback is a promise that decays: the
 * configured `llama-3.3-70b-versatile` 404s on Groq and its OpenRouter `:free`
 * twin was withdrawn, which left Ask answering nothing at all while every test
 * that only checked "is a key configured" still passed. The real catalogue is
 * the source of truth — this only decides which of the live models we would
 * rather talk to, and anything here that is no longer offered is skipped.
 */
const PREFERRED_CHAT: Record<string, string[]> = {
  groq: ['qwen/qwen3.8-27b', 'llama-3.1-8b-instant', 'llama-3.3-70b-versatile', 'openai/gpt-oss-120b'],
  openrouter: [
    'qwen/qwen3.8-27b:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'deepseek/deepseek-chat-v3-0324:free',
    'mistralai/mistral-small-3.1-24b-instruct:free',
  ],
};

/**
 * Drop everything that cannot hold a conversation.
 *
 * Shared by the picker and the resolver on purpose. The picker used to offer the
 * raw catalogue, which put `whisper-large-v3` at the top of Groq's list — a
 * speech-to-text model. Anyone who took the first suggestion got a failed Ask
 * and no explanation. A free-tier catalogue is a list of endpoints, not of
 * assistants, and it has to be filtered before a human sees it.
 */
export function chatOnly(models: CatalogModel[]): CatalogModel[] {
  return models.filter((m) => !NOT_CHAT.test(m.id));
}

/**
 * Groq publishes no price field, so "free" there can only mean "this key's quota
 * will absorb it" — not a guarantee we checked. This returns the wording the
 * picker should use, so the site never implies a promise the API cannot support.
 */
export function freeClaimCaveat(providerId: string): string | null {
  if (getProvider(providerId)?.pricingPublished !== false) return null;
  return 'This provider publishes no per-model pricing, so these are the models your key can reach — free depends on your quota, not on a guarantee we can check.';
}

/**
 * Order a catalogue so the models we would rather use appear first.
 * The provider lists whatever it feels like, so a reader picking from it gets
 * `apodex-1.1-mini` or an Arabic-only Orpheus as their first suggestion. Those
 * will answer, but nobody chose them on purpose. Promotion order comes from
 * PREFERRED_CHAT; everything else keeps its catalogue order underneath.
 */
export function orderByPreference(models: CatalogModel[], providerId: string): CatalogModel[] {
  const preferred = PREFERRED_CHAT[providerId] ?? [];
  const rank = new Map(preferred.map((id, i) => [id, i]));
  return [...models].sort((a, b) => {
    const ra = rank.get(a.id);
    const rb = rank.get(b.id);
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return 0;
  });
}

/**
 * Pick a model to actually call from a live catalogue.
 *
 * Preference order first, then anything that merely looks like a chat model.
 * Returns null when the catalogue offers nothing usable, which lets the caller
 * fall back to extractive quotes instead of burning a request on a 404.
 */
export function chooseChatModel(models: CatalogModel[], providerId: string): string | null {
  const free = chatOnly(models).filter((m) => m.free);
  const live = new Set(free.map((m) => m.id));
  if (live.size === 0) return null;
  for (const id of PREFERRED_CHAT[providerId] ?? []) {
    if (live.has(id)) return id;
  }
  return free[0]?.id ?? null;
}

function env(name: string): string | undefined {
  const existing = process.env[name];
  if (existing) return existing;
  try {
    const file = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
    for (const line of file.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const at = t.indexOf('=');
      if (at < 0) continue;
      if (t.slice(0, at).trim() !== name) continue;
      return t.slice(at + 1).trim().replace(/^["']|["']$/g, '');
    }
  } catch {
    // No .env in production is normal.
  }
  return undefined;
}

function titleCase(id: string): string {
  const tail = id.split('/').pop() ?? id;
  return tail
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .slice(0, 60);
}

function openRouterIsFree(m: Record<string, unknown>): boolean {
  const id = String(m.id ?? '');
  if (id.endsWith(':free')) return true;
  const pricing = m.pricing as Record<string, unknown> | undefined;
  if (!pricing || pricing.prompt === undefined) return false;
  // Both directions must be zero, not just the prompt. A model that is free to
  // read but paid to write is not free, and a prompt-only check would put it
  // in the owner's free-only picker — where using it costs real money out of
  // their key. (Several legitimately free models carry no `:free` suffix, so
  // the price check is doing real work, not duplicating the suffix.)
  return Number(pricing.prompt) === 0 && Number(pricing.completion ?? 0) === 0;
}

/**
 * Fetch a provider's model list. Returns [] on any failure — the caller falls
 * back to the provider's default model.
 */
async function fetchCatalog(provider: ProviderDef, apiKey: string): Promise<CatalogModel[]> {
  const url = provider.wire === 'anthropic'
    ? `${provider.baseUrl}/v1/models?limit=1000`
    : `${provider.baseUrl}/models`;
  const headers: Record<string, string> =
    provider.wire === 'anthropic'
      ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
      : { Authorization: `Bearer ${apiKey}` };

  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return [];
  const body = (await res.json().catch(() => null)) as
    | { data?: Array<Record<string, unknown>>; models?: Array<Record<string, unknown>> }
    | null;
  const rows = body?.data ?? body?.models ?? [];
  const out: CatalogModel[] = [];
  for (const m of rows) {
    const id = String(m.id ?? '');
    if (!id) continue;
    const free = provider.id === 'openrouter' ? openRouterIsFree(m) : true;
    out.push({ id, label: String(m.name ?? titleCase(id)), free });
  }
  return out;
}

/**
 * Models for a provider, from cache when fresh.
 *
 * `freeOnly` is the owner's rule for their own keys. When false (a user
 * brought their own key) everything the provider offers is fair game, because
 * that key is theirs and they chose it.
 */
export async function listModels(
  providerId: string,
  apiKey: string,
  opts: { freeOnly: boolean },
): Promise<CatalogModel[]> {
  const provider = getProvider(providerId);
  if (!provider) return [];

  HOLDER.__strataCatalog ??= new Map();
  const cache = HOLDER.__strataCatalog;
  const hit = cache.get(providerId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return opts.freeOnly ? hit.models.filter((m) => m.free) : hit.models;
  }

  let models: CatalogModel[] = [];
  try {
    models = await fetchCatalog(provider, apiKey);
  } catch {
    models = [];
  }
  if (models.length > 0) cache.set(providerId, { at: Date.now(), models });

  const usable = models.length > 0 ? models : [{ id: provider.fallbackModel, label: provider.fallbackModel, free: true }];
  return opts.freeOnly ? usable.filter((m) => m.free) : usable;
}

/** The deployment's own key for a provider, if it has one. */
export function houseKeyFor(providerId: string): string | undefined {
  const provider = getProvider(providerId);
  if (!provider?.envKey) return undefined;
  return env(provider.envKey);
}

export { env as readEnv };
