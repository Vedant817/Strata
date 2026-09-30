import { getProvider, type ProviderDef } from './providers';

/**
 * One chat call, two wire formats.
 *
 * The grounding contract is unchanged and still the most important thing in
 * this file: the model is shown retrieved passages and nothing else, and asked
 * to abstain when they do not answer. Adding a dozen providers must not
 * quietly relax that, so the system prompt is built in one place and is
 * identical across every provider, and the answer is still discarded if the
 * model says it is not covered.
 *
 * This replaces the Anthropic-only `src/lib/model.ts`; the caps and the circuit
 * breaker are now per (author, provider) because a Groq outage and an OpenAI
 * outage are different events, and one provider's breaker should not silence
 * another.
 */

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatResult {
  ok: boolean;
  text: string;
  /** 'not_covered' means the model abstained — a valid, expected answer. */
  outcome: 'answered' | 'not_covered' | 'abstained' | 'error';
  model: string;
  latencyMs: number;
  error?: string;
}

/**
 * Grounding prompt. Identical for every provider on purpose: the promise is a
 * property of the request, not of the vendor.
 */
export const GROUNDED_SYSTEM = [
  'You answer questions about a single article using ONLY the quoted passages provided.',
  'Never use outside knowledge. Never speculate. If the passages do not answer the question,',
  'reply with exactly: NOT COVERED',
  'Cite the passage number(s) you used like [1] or [2]. Keep it under 80 words. No preamble.',
].join(' ');

function numberedPassages(passages: string[]): string {
  return passages.map((p, i) => `[${i + 1}] ${p}`).join('\n\n');
}

async function callOpenAI(
  provider: ProviderDef,
  apiKey: string,
  model: string,
  passages: string[],
  question: string,
  timeoutMs: number,
): Promise<ChatResult> {
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(provider.id === 'openrouter'
          ? {
              // OpenRouter attributes traffic to a site for its dashboard; free
              // models are unavailable without this header.
              'HTTP-Referer': 'https://strata.pub',
              'X-Title': 'Strata',
            }
          : {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model,
        max_tokens: 300,
        temperature: 0.2,
        messages: [
          { role: 'system', content: GROUNDED_SYSTEM },
          { role: 'user', content: `Passages:\n\n${numberedPassages(passages)}\n\nQuestion: ${question}` },
        ],
      }),
    });
  } catch (err) {
    return {
      ok: false,
      text: '',
      outcome: 'error',
      model,
      latencyMs: Date.now() - started,
      error: `unreachable: ${(err as Error).message}`,
    };
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return {
      ok: false,
      text: '',
      outcome: 'error',
      model,
      latencyMs: Date.now() - started,
      error: `HTTP ${res.status} ${detail.slice(0, 160)}`,
    };
  }
  const body = (await res.json().catch(() => null)) as
    | { choices?: Array<{ message?: { content?: string } }> }
    | null;
  const text = body?.choices?.[0]?.message?.content?.trim() ?? '';
  return interpret(text, model, started);
}

async function callAnthropic(
  provider: ProviderDef,
  apiKey: string,
  model: string,
  passages: string[],
  question: string,
  timeoutMs: number,
): Promise<ChatResult> {
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(`${provider.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model,
        max_tokens: 300,
        system: GROUNDED_SYSTEM,
        messages: [{ role: 'user', content: `Passages:\n\n${numberedPassages(passages)}\n\nQuestion: ${question}` }],
      }),
    });
  } catch (err) {
    return {
      ok: false,
      text: '',
      outcome: 'error',
      model,
      latencyMs: Date.now() - started,
      error: `unreachable: ${(err as Error).message}`,
    };
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return {
      ok: false,
      text: '',
      outcome: 'error',
      model,
      latencyMs: Date.now() - started,
      error: `HTTP ${res.status} ${detail.slice(0, 160)}`,
    };
  }
  const body = (await res.json().catch(() => null)) as
    | { content?: Array<{ type?: string; text?: string }> }
    | null;
  const text = body?.content?.find((c) => c.type === 'text')?.text?.trim() ?? '';
  return interpret(text, model, started);
}

function interpret(text: string, model: string, started: number): ChatResult {
  const latencyMs = Date.now() - started;
  if (!text) return { ok: true, text: '', outcome: 'abstained', model, latencyMs };
  if (text === 'NOT COVERED' || /^\s*NOT COVERED\s*$/i.test(text)) {
    return { ok: true, text: '', outcome: 'not_covered', model, latencyMs };
  }
  return { ok: true, text, outcome: 'answered', model, latencyMs };
}

export async function chatGrounded(args: {
  providerId: string;
  apiKey: string;
  model: string;
  passages: string[];
  question: string;
  timeoutMs?: number;
}): Promise<ChatResult> {
  const provider = getProvider(args.providerId);
  if (!provider) {
    return {
      ok: false,
      text: '',
      outcome: 'error',
      model: args.model,
      latencyMs: 0,
      error: `unknown provider "${args.providerId}"`,
    };
  }
  if (args.passages.length === 0) {
    return { ok: false, text: '', outcome: 'error', model: args.model, latencyMs: 0, error: 'no passages' };
  }
  const timeout = args.timeoutMs ?? 8000;
  return provider.wire === 'anthropic'
    ? callAnthropic(provider, args.apiKey, args.model, args.passages, args.question, timeout)
    : callOpenAI(provider, args.apiKey, args.model, args.passages, args.question, timeout);
}
