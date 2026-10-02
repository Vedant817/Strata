import { readyDb } from '../../lib/db/index';
import { users } from '../../lib/db/schema';
import { eq } from 'drizzle-orm';
import { getIdentity } from '../../lib/repo/auth';
import {
  loginOptions,
  loginVerify,
  registrationOptions,
  registerVerify,
} from '../../lib/auth/webauthn';
import { z } from 'zod';
import type { APIRoute } from 'astro';

/**
 * Passkey registration and sign-in.
 *
 * One endpoint, discriminated by `action`, because the two ceremonies share a
 * request shape and splitting them would duplicate the identity check, the JSON
 * guard and the error contract for no gain.
 *
 * `register-options` requires a session. `authenticate-verify` deliberately does
 * not: proving you are you is the entire point, and a passkey login must work
 * from a cold browser with no cookie.
 */

const registerVerifyBody = z.object({
  action: z.literal('authenticate-verify'),
  credential: z.object({
    id: z.string().min(1).max(400),
    rawId: z.string().min(1).max(400),
    response: z.object({
      clientDataJSON: z.string().min(1).max(8000),
      authenticatorData: z.string().min(1).max(8000),
      signature: z.string().min(1).max(4000),
      userHandle: z.string().max(400).optional(),
    }),
  }),
});

const createBody = z.object({
  action: z.literal('register-verify'),
  label: z.string().max(60).optional(),
  credential: z.object({
    id: z.string().min(1).max(400),
    rawId: z.string().min(1).max(400),
    response: z.object({
      clientDataJSON: z.string().min(1).max(20000),
      attestationObject: z.string().min(1).max(40000),
      transports: z.array(z.string().max(40)).max(8).optional(),
    }),
  }),
});

function bad(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ request, url, cookies }) => {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return bad('Expected JSON.');
  }
  if (!raw || typeof raw !== 'object') return bad('Expected JSON.');

  const action = (raw as { action?: unknown }).action;

  /* ---- registration ---------------------------------------------------- */

  if (action === 'register-options') {
    const identity = await getIdentity(cookies);
    if (!identity.userId) return bad('Claim a handle before adding a passkey.', 401);
    const database = await readyDb();
    const rows = await database.select().from(users).where(eq(users.id, identity.userId)).limit(1);
    const user = rows[0];
    if (!user) return bad('No such account.', 401);
    const options = await registrationOptions({
      url,
      userId: user.id,
      username: user.handle,
      displayName: user.displayName || user.handle,
    });
    return new Response(JSON.stringify(options), {
      headers: { 'content-type': 'application/json' },
    });
  }

  if (action === 'register-verify') {
    const identity = await getIdentity(cookies);
    if (!identity.userId) return bad('Claim a handle before adding a passkey.', 401);
    const parsed = createBody.safeParse(raw);
    if (!parsed.success) return bad('Malformed credential.');
    const result = await registerVerify({
      url,
      userId: identity.userId,
      label: parsed.data.label ?? 'Passkey',
      credential: parsed.data.credential,
    });
    if (!result.ok) return bad(result.error);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  /* ---- sign-in ---------------------------------------------------------- */

  if (action === 'authenticate-options') {
    const options = await loginOptions(url);
    return new Response(JSON.stringify(options), {
      headers: { 'content-type': 'application/json' },
    });
  }

  if (action === 'authenticate-verify') {
    const parsed = registerVerifyBody.safeParse(raw);
    if (!parsed.success) return bad('Malformed credential.');
    const result = await loginVerify({
      url,
      cookies,
      credential: parsed.data.credential,
    });
    // Never say which credential or handle failed. A distinguishable error here
    // turns the endpoint into an oracle for probing for registered devices.
    if (!result.ok) return bad(result.error, 401);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  return bad('Unknown action.');
};
