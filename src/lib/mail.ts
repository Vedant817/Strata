/**
 * Outbound mail. One function, one honest rule.
 *
 * If a Resend API key is configured, mail goes through Resend and the response
 * is checked — a 4xx/5xx is a failure, not a silent drop. Otherwise the message
 * is logged and reported as unsent, and every caller must say so in its UI
 * instead of pretending an email is on its way. A fake "check your inbox" is
 * worse than an honest gap, because it sends people looking for mail that will
 * never arrive.
 *
 * No SMTP client is vendored, and the `resend` CLI is deliberately not the
 * transport: its login is an OAuth grant held in the OS credential store,
 * which a web process cannot read and should not depend on. Raw-socket SMTP
 * written by hand is how mail gets silently lost; a second provider arrives as
 * a real dependency, not as fifty lines of socket code.
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

const FROM = () => env('MAIL_FROM') ?? 'Strata <onboarding@resend.dev>';

export function isMailConfigured(): boolean {
  return Boolean(env('RESEND_API_KEY'));
}

export async function sendMail(mail: OutgoingMail): Promise<MailResult> {
  const key = env('RESEND_API_KEY');
  if (!key) {
    console.log('[strata] mail not configured — would have sent:', {
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
    });
    return { ok: false, error: 'No RESEND_API_KEY configured.' };
  }

  let res: Response;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM(), to: mail.to, subject: mail.subject, text: mail.text }),
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
