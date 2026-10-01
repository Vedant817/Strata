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
 * Two providers, one interface:
 *
 * - **Brevo** (`BREVO_API_KEY`) is preferred when present. Its free tier needs
 *   no domain: verify one sender address by clicking a link and you can mail any
 *   recipient. That matters here because this publication has no domain of its
 *   own, and every mainstream provider otherwise refuses to send to real
 *   addresses until you can publish DNS records.
 * - **Resend** (`RESEND_API_KEY`) stays as the fallback, and is still what runs
 *   when no Brevo key exists — nothing about the existing setup changes.
 *
 * Set `MAIL_PROVIDER=brevo|resend` to pin one explicitly; leave it unset to let
 * the first configured key win (Brevo before Resend).
 *
 * Both transports are plain HTTPS on port 443, not SMTP sockets. That is not a
 * style choice: Vercel blocks outbound 25/465/587, so an SMTP-based provider
 * would fail in production while working perfectly on a laptop.
 *
 * No SMTP client is vendored, and the `resend` CLI is deliberately not the
 * transport: its login is an OAuth grant held in the OS credential store,
 * which a web process cannot read and should not depend on. Raw-socket SMTP
 * written by hand is how mail gets silently lost.
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

const FROM_RAW = () => env('MAIL_FROM') ?? 'Strata <onboarding@resend.dev>';

/** `Strata <hello@example.com>` -> separate parts. Brevo wants the display name
 *  and the address as distinct fields; Resend accepts the combined form. */
function parseFrom(raw: string): { name: string; email: string } {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(raw);
  if (m) return { name: m[1] || 'Strata', email: m[2]!.trim() };
  return { name: 'Strata', email: raw.trim() };
}

type Provider = 'brevo' | 'resend';

const KEY_FOR: Record<Provider, string> = {
  brevo: 'BREVO_API_KEY',
  resend: 'RESEND_API_KEY',
};

/** Which transport to use, or null when nothing is configured. */
function activeProvider(): Provider | null {
  const forced = (env('MAIL_PROVIDER') ?? '').toLowerCase();
  if (forced === 'brevo' || forced === 'resend') {
    return env(KEY_FOR[forced]) ? forced : null;
  }
  if (env(KEY_FOR.brevo)) return 'brevo';
  if (env(KEY_FOR.resend)) return 'resend';
  return null;
}

export function isMailConfigured(): boolean {
  return activeProvider() !== null;
}

async function sendViaBrevo(key: string, mail: OutgoingMail): Promise<MailResult> {
  const from = parseFrom(FROM_RAW());
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

async function sendViaResend(key: string, mail: OutgoingMail): Promise<MailResult> {
  let res: Response;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM_RAW(), to: mail.to, subject: mail.subject, text: mail.text }),
    });
  } catch (err) {
    return { ok: false, error: `Mailer unreachable: ${(err as Error).message}` };
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { ok: false, error: `Mailer refused the message (${res.status}). ${detail}`.trim() };
  }
  const body = (await res.json().catch(() => ({}))) as { id?: string };
  return { ok: true, id: body.id ?? 'sent' };
}

export async function sendMail(mail: OutgoingMail): Promise<MailResult> {
  const provider = activeProvider();
  if (!provider) {
    console.log('[strata] mail not configured — would have sent:', {
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
    });
    return { ok: false, error: 'No mail provider configured (set BREVO_API_KEY or RESEND_API_KEY).' };
  }
  return provider === 'brevo'
    ? sendViaBrevo(env(KEY_FOR.brevo)!, mail)
    : sendViaResend(env(KEY_FOR.resend)!, mail);
}
