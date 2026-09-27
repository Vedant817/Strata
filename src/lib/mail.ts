/**
 * Outbound mail. One function, one honest rule.
 *
 * If `RESEND_API_KEY` is set, mail goes through Resend and the response is
 * checked — a 4xx/5xx is a failure, not a silent drop. Otherwise the message
 * is logged and reported as unsent, and every caller must say so in its UI
 * instead of pretending an email is on its way. A fake "check your inbox" is
 * worse than an honest gap, because it sends people looking for mail that
 * will never arrive.
 *
 * No SMTP client is vendored. Raw-socket SMTP written by hand is how mail
 * gets silently lost; when a second provider is needed it arrives as a real
 * dependency, not as fifty lines of socket code.
 */

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
}

export type MailResult = { ok: true; id: string } | { ok: false; error: string };

const FROM = process.env.MAIL_FROM ?? 'Strata <hello@strata.pub>';

export function isMailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export async function sendMail(mail: OutgoingMail): Promise<MailResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log('[strata] mail not configured — would have sent:', {
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
    });
    return { ok: false, error: 'No mailer configured.' };
  }

  let res: Response;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: mail.to, subject: mail.subject, text: mail.text }),
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
