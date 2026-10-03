/**
 * Outbound mail. One function, one honest rule.
 *
 * If a provider key is configured, mail goes out over HTTPS and the response is
 * checked — a 4xx/5xx is a failure, not a silent drop. Otherwise the message is
 * logged and reported as unsent, and every caller must say so in its UI instead
 * of pretending an email is on its way. A fake "check your inbox" is worse
 * than an honest gap, because it sends people looking for mail that will never
 * arrive.
 *
 * One provider, and only one:
 *
 * - **Brevo** (`BREVO_API_KEY`). Its free tier needs no domain: verify one
 *   sender address by clicking a link and you can mail any recipient. That
 *   matters here because this publication has no domain of its own, and every
 *   mainstream provider otherwise refuses to send to real addresses until you
 *   can publish DNS records. Brevo is the only transport that works without one.
 *
 * Resend was the previous transport and has been removed rather than left as a
 * fallback. Two independent reasons, and the second is the one that matters:
 *
 *   1. It was dead weight. `BREVO_API_KEY` is configured, so `MAIL_PROVIDER` or
 *      the key alone always selected Brevo and the Resend branch was unreachable.
 *      Unreachable code that looks like a fallback is worse than no fallback:
 *      it reads as redundancy and provides none.
 *   2. Resend cannot send to arbitrary recipients without a verified sending
 *      domain. This publication has no domain. So the "fallback" would have
 *      delivered to @resend.dev and nowhere else — mail that reports success
 *      and reaches nobody. That is the exact failure this module exists to
 *      prevent, and it would have been the *fallback*, i.e. the path taken when
 *      the primary was in trouble.
 *
 * The transport is plain HTTPS on port 443, not an SMTP socket. That is not a
 * style choice: Vercel blocks outbound 25/465/587, so an SMTP-based provider
 * would fail in production while working perfectly on a laptop.
 *
 * No SMTP client is vendored. Raw-socket SMTP written by hand is how mail gets
 * silently lost.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
}

export type MailResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * Read a key from the process env, falling back to `.env`.
 *
 * Astro loads `.env` for SSR, but the *timing* of that load relative to module
 * evaluation is not something this module should depend on — and a mailer that
 * silently no-ops because a variable was read one tick too early is the worst
 * possible failure mode, because every send reports success locally while no
 * mail goes out. So it reads the file itself and only ever *adds* variables
 * that are genuinely absent. A real environment variable always wins, so
 * production configuration is never overridden by a stray file.
 */
function env(name: string): string | undefined {
  const existing = process.env[name];
  if (existing) return existing;
  try {
    const file = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
    for (const line of file.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const at = trimmed.indexOf('=');
      if (at < 0) continue;
      const key = trimmed.slice(0, at).trim();
      if (key !== name) continue;
      return trimmed
        .slice(at + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
    }
  } catch {
    // No .env is the normal case in production, not an error.
  }
  return undefined;
}

/**
 * The From address. Brevo refuses a send whose sender is not the address
 * verified in its dashboard, so there is no safe default here: an invented
 * default is a send that fails at the provider and looks like a bug here. The
 * caller gets a clear refusal instead.
 */
const fromRaw = () => env('MAIL_FROM');

/** `Strata <hello@example.com>` -> separate parts. Brevo wants them distinct. */
function parseFrom(raw: string): { name: string; email: string } {
  const m = /^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/.exec(raw);
  if (m) return { name: m[1] || 'Strata', email: m[2]!.trim() };
  return { name: 'Strata', email: raw.trim() };
}

/** True when a key is present, for the diagnostics callers surface. */
export function isMailConfigured(): boolean {
  return Boolean(env('BREVO_API_KEY') && fromRaw());
}

async function sendViaBrevo(key: string, from: { name: string; email: string }, mail: OutgoingMail): Promise<MailResult> {
  let res: Response;
  try {
    res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': key, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { name: from.name, email: from.email },
        to: [{ email: mail.to }],
        subject: mail.subject,
        textContent: mail.text,
      }),
    });
  } catch (err) {
    return { ok: false, error: `Mailer unreachable: ${(err as Error).message}` };
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { ok: false, error: `Mailer refused the message (${res.status}). ${detail}`.trim() };
  }
  const body = (await res.json().catch(() => ({}))) as { messageId?: string };
  return { ok: true, id: body.messageId ?? 'sent' };
}

export async function sendMail(mail: OutgoingMail): Promise<MailResult> {
  const key = env('BREVO_API_KEY');
  const from = fromRaw();

  if (!key || !from) {
    console.log('[strata] mail not configured — would have sent:', {
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
    });
    const missing = !key ? 'BREVO_API_KEY' : 'MAIL_FROM';
    return { ok: false, error: `Mail is not configured: set ${missing}.` };
  }

  return sendViaBrevo(key, parseFrom(from), mail);
}