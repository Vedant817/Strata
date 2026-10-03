/**
 * The passkey round trip, against a real authenticator.
 *
 * The handoff note on this feature says enrolment "was never completed against
 * a real authenticator": the crypto, the authz boundaries and the client wiring
 * were all verified in pieces, but no end-to-end ceremony had ever run. That is
 * checkable without a phone in your hand — Chromium's CDP exposes
 * `WebAuthn.addVirtualAuthenticator`, which is a genuine CTAP2 authenticator
 * living in the browser process. It produces real attestation objects, real
 * attestation signatures and a real, incrementing signature counter, so the
 * parts that only fail against an authenticator actually get exercised.
 *
 * What this asserts, and why each one is not reachable by reading the code:
 *
 *   enrolment  /settings -> "Add a passkey" -> a row in `passkeys`, with a
 *              COSE key the server can decode and a counter it read out of
 *              authenticatorData (a 16-byte AAGUID and a missing counter offset
 *              both pass every type check and break every passkey);
 *   sign-in    the `authenticate-options` / `authenticate-verify` pair, driven
 *              through `navigator.credentials.get`, ending in a session cookie;
 *   counter    a forced signCount above 2^31, which must be accepted. The
 *              original implementation shifted it with `>> 24`, which is
 *              *signed* in JS, so any counter above 2^31 parsed as negative and
 *              clone detection locked out the legitimate owner. Acceptance here
 *              is the regression test; a refusal means that bug is back;
 *   replay     the same assertion twice — the challenge is single-use, so the
 *              second attempt must be refused even though the signature is
 *              perfectly valid;
 *   unknown    an assertion for a credential that was never enrolled, refused
 *              without saying anything about which handle or device exists.
 *
 * What this does NOT prove, stated plainly: a virtual authenticator is not a
 * phone. Platform attestation, hybrid/cross-device transports (caBLE), the
 * iCloud keychain and the "same passkey on two devices" cases are all
 * untouched. It does prove the ceremony, the storage and the counter logic.
 *
 * Requirements — deliberately not in CI, which has no browser:
 *   1. A dev server: npm run dev
 *   2. A seeded local database (npm run db:seed) — it writes rows and cleans up
 *      after itself, so it is the local file, never production.
 *   3. A browser on CDP:
 *        msedge --remote-debugging-port=9222 --user-data-dir=%TEMP%/strata-cdp
 *
 * Run: node scripts/check-passkey-roundtrip.mjs
 * Env: CDP_PORT (9222), BASE_URL (http://localhost:4321)
 *
 * Note the host. A WebAuthn relying-party ID must be a registrable domain, so
 * Chrome refuses an IP address with "This is an invalid domain" — passkeys
 * cannot work on `http://127.0.0.1:4321` at all, and this script exits rather
 * than reporting that as a product failure. Since `relyingPartyId()` is the
 * hostname, that limitation applies to any Strata reached by IP.
 */
import { createClient } from '@libsql/client';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.CDP_PORT || '9222';
const BASE = (process.env.BASE_URL || 'http://localhost:4321').replace(/\/$/, '');
const HOST = new URL(BASE).hostname;

let passed = 0;
let failed = 0;
function ok(label, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ok   ${label}${detail ? `  ${detail}` : ''}`);
  } else {
    failed++;
    console.error(`  FAIL ${label}${detail ? `  ${detail}` : ''}`);
  }
}
const eq = (label, actual, expected) =>
  ok(label, Object.is(actual, expected), `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* -------------------------------------------------------------------------- */
/* Preflight                                                                    */
/* -------------------------------------------------------------------------- */

const dbUrl = `file:${path.join(projectRoot, 'data', 'strata.db')}`;
const db = createClient({ url: dbUrl });

const users = await db.execute("select id, handle from users order by created_at limit 1;");
const user = users.rows[0];
if (!user) {
  console.error('No users in data/strata.db — run `npm run db:seed` first.');
  process.exit(2);
}
const USER_ID = String(user.id);
const HANDLE = String(user.handle);

// A passkey cannot be registered against an IP address, so testing there proves
// nothing about the code — it proves the browser said no. Say so and stop.
if (/^\d+\.\d+\.\d+\.\d+$/.test(HOST) || HOST.includes(':')) {
  console.error(
    `BASE_URL is ${BASE}, and "${HOST}" is an IP address.\n` +
      'WebAuthn refuses an IP as a relying-party ID, so no ceremony can run here.\n' +
      'Use a hostname: BASE_URL=http://localhost:4321',
  );
  await db.close();
  process.exit(2);
}

let cdp;
try {
  cdp = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
} catch (err) {
  console.error(
    `No browser on CDP port ${PORT}: ${err.message}\n` +
      'Start one with: msedge --remote-debugging-port=' + PORT + ' --user-data-dir=%TEMP%/strata-cdp',
  );
  await db.close();
  process.exit(2);
}

// The server is checked before anything else, because every assertion below it
// depends on one. Against a server that is not listening, a run produces twenty
// meaningless failures that look like twenty bugs.
try {
  const up = await fetch(`${BASE}/settings`, { redirect: 'manual' });
  if (!up.status && up.status !== 0) throw new Error(`status ${up.status}`);
} catch (err) {
  console.error(`No server at ${BASE}: ${err.message}\nStart one with: npm run dev`);
  await db.close();
  process.exit(2);
}
console.log(`\npasskey round trip, ${cdp.Browser}`);
console.log(`  database: ${dbUrl}`);
console.log(`  account:  @${HANDLE}\n`);

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
if (!page) {
  console.error('No page target in the browser.');
  await db.close();
  process.exit(2);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let nextId = 0;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (!msg.id || !pending.has(msg.id)) return;
  const { resolve, reject } = pending.get(msg.id);
  pending.delete(msg.id);
  msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
});
function send(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description ?? 'page threw');
  }
  return res.result.value;
}

/**
 * Evaluate, and turn a page-side exception into a reported failure instead of a
 * crashed run. A ceremony that throws inside the page is a finding, not a reason
 * to stop asserting — and the cleanup that follows still has to happen.
 */
async function evaluateOrReport(label, expression) {
  try {
    return await evaluate(expression);
  } catch (err) {
    ok(label, false, String(err.message).split('\n')[0]);
    return { error: String(err.message) };
  }
}

/* Everything this run creates, so the local database is left as it was found. */
const sessionToken = randomBytes(24).toString('base64url');
const cleanup = { passkeys: [], sessions: [sessionToken] };

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('WebAuthn.enable');
// `options` is a named parameter in the protocol, so it has to be nested. Sent
// flat, Chromium reports "mandatory field missing at position 125", which reads
// like a missing enum value rather than a missing wrapper.
const { authenticatorId } = await send('WebAuthn.addVirtualAuthenticator', {
  options: {
    protocol: 'ctap2',
    transport: 'internal',
    hasResidentKey: true,
    hasUserVerification: true,
    isUserVerified: true,
    automaticPresenceSimulation: true,
  },
});

const setCookie = (value) =>
  send('Network.setCookie', {
    name: 'strata_session',
    value,
    domain: HOST,
    path: '/',
    httpOnly: true,
  });
const cookieValue = async (name) => {
  const { cookies } = await send('Storage.getCookies');
  const found = cookies.find((c) => c.name === name && c.domain.includes(HOST));
  return found ? { value: found.value, httpOnly: found.httpOnly } : null;
};
const passkeyRows = async () =>
  (await db.execute({ sql: 'select * from passkeys where user_id = ?', args: [USER_ID] })).rows;

/* Shared in-page helpers: the two base64url conversions the real UI also has. */
const HELPERS = `
  const b64uToBytes = (v) => {
    const pad = v.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };
  const bytesToB64u = (bytes) => {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let s = '';
    for (const b of view) s += String.fromCharCode(b);
    return btoa(s).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
  };
`;

try {
  /* ---------------------------------------------------------------------- */
  /* 1. A session, so enrolment has an account to attach to                    */
  /* ---------------------------------------------------------------------- */

  await db.execute({
    sql: 'insert into sessions (token, user_id, expires_at, created_at) values (?, ?, ?, ?)',
    args: [sessionToken, USER_ID, Date.now() + 86_400_000, Date.now()],
  });
  await send('Network.clearBrowserCookies');
  await setCookie(sessionToken);
  eq('the account is signed in for enrolment', (await cookieValue('strata_session'))?.value, sessionToken);

  /* ---------------------------------------------------------------------- */
  /* 2. Enrolment, through the actual button                                  */
  /* ---------------------------------------------------------------------- */

  await send('Page.navigate', { url: `${BASE}/settings` });
  await sleep(3500);

  const before = (await passkeyRows()).length;
  const enrolled = await evaluateOrReport('the enrolment ceremony ran', `(async () => {
    ${HELPERS}
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const add = document.querySelector('[data-passkey-add]');
    const status = document.querySelector('[data-passkey-status]');
    if (!add) return { error: 'no [data-passkey-add] button: ' + (status ? status.textContent : 'no status element') };
    if (add.disabled) return { error: 'button present but disabled' };
    add.click();
    for (let i = 0; i < 100; i++) {
      await sleep(50);
      const text = status ? status.textContent.trim() : '';
      if (text && !text.startsWith('Waiting')) return { status: text };
    }
    return { error: 'the ceremony never resolved', status: status ? status.textContent.trim() : '' };
  })()`);

  ok('the Add a passkey button was there to press', !enrolled.error, enrolled.error ?? '');
  eq('the browser reports the enrolment as added', enrolled.status, 'Added. It works the next time you sign in.');

  const after = await passkeyRows();
  eq('exactly one passkey row was written', after.length - before, 1);
  const key = after[after.length - 1];
  if (key) {
    cleanup.passkeys.push(String(key.id));
    ok('it belongs to this account', String(key.user_id) === USER_ID);
    ok('a COSE public key was stored', typeof key.public_key === 'string' && key.public_key.length > 40, `${String(key.public_key).length} chars`);
    ok('the label was recorded', typeof key.label === 'string' && key.label.length > 0, String(key.label));
    // The transports the authenticator reported, if any. Absent is fine; wrong
    // is not, because it is what a later hybrid flow keys off.
    ok('transports are recorded or null', key.transports === null || typeof key.transports === 'string', String(key.transports));
    // The counter is read from byte 33 of authenticatorData. An AAGUID that is
    // 16 bytes short shifts every following field, including this one.
    ok('a signature counter was parsed out of authenticatorData', Number.isInteger(Number(key.counter)), `counter=${String(key.counter)}`);
  }

  const creds = await send('WebAuthn.getCredentials', { authenticatorId });
  eq('the authenticator holds exactly one credential', creds.credentials.length, 1);
  const credId = creds.credentials[0]?.credentialId;

  /* ---------------------------------------------------------------------- */
  /* 3. Sign-in. There is no UI for this yet, so the ceremony is driven here.  */
  /* ---------------------------------------------------------------------- */

  await send('Network.clearBrowserCookies');
  eq('the browser is signed out', (await cookieValue('strata_session'))?.value ?? null, null);

  const signIn = await evaluateOrReport('the sign-in ceremony ran', `(async () => {
    ${HELPERS}
    const options = await (await fetch('/api/passkey', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'authenticate-options' }),
    })).json();
    const assertion = await navigator.credentials.get({
      publicKey: {
        ...options,
        challenge: b64uToBytes(options.challenge),
      },
    });
    if (!assertion) return { error: 'no assertion' };
    const resp = assertion.response;
    const body = {
      action: 'authenticate-verify',
      credential: {
        id: assertion.id,
        rawId: bytesToB64u(assertion.rawId),
        response: {
          clientDataJSON: bytesToB64u(resp.clientDataJSON),
          authenticatorData: bytesToB64u(resp.authenticatorData),
          signature: bytesToB64u(resp.signature),
          userHandle: resp.userHandle ? bytesToB64u(resp.userHandle) : undefined,
        },
      },
    };
    const res = await fetch('/api/passkey', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json(), replay: body };
  })()`);

  ok('the sign-in ceremony produced an assertion', !signIn.error, signIn.error ?? '');
  eq('the server accepted it', signIn.status, 200);
  eq('and said so', signIn.body?.ok, true);

  const signedIn = await cookieValue('strata_session');
  ok('a session cookie was issued', typeof signedIn?.value === 'string' && signedIn.value.length > 20);
  eq('and it is httpOnly', signedIn?.httpOnly, true);
  if (signedIn) cleanup.sessions.push(signedIn.value);

  const rowsAfterSignIn = await passkeyRows();
  const updated = rowsAfterSignIn.find((r) => String(r.id) === String(key?.id));
  ok('the passkey recorded that it was used', Number(updated?.last_used_at) > 0);
  ok(
    'and the stored counter moved forward',
    Number(updated?.counter) >= Number(key?.counter),
    `${String(key?.counter)} -> ${String(updated?.counter)}`,
  );

  /* ---------------------------------------------------------------------- */
  /* 4. A counter above 2^31 must be accepted, not read as negative           */
  /* ---------------------------------------------------------------------- */

  if (credId) {
    const BIG = 2 ** 31 + 10; // 2147483658
    await send('WebAuthn.setCredentialProperties', { authenticatorId, credentialId: credId, signCount: BIG });
    await send('Network.clearBrowserCookies');

    const big = await evaluateOrReport('the large-counter ceremony ran', `(async () => {
      ${HELPERS}
      const options = await (await fetch('/api/passkey', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'authenticate-options' }),
      })).json();
      const assertion = await navigator.credentials.get({ publicKey: { ...options, challenge: b64uToBytes(options.challenge) } });
      const resp = assertion.response;
      const res = await fetch('/api/passkey', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'authenticate-verify',
          credential: {
            id: assertion.id, rawId: bytesToB64u(assertion.rawId),
            response: {
              clientDataJSON: bytesToB64u(resp.clientDataJSON),
              authenticatorData: bytesToB64u(resp.authenticatorData),
              signature: bytesToB64u(resp.signature),
            },
          },
        }),
      });
      return { status: res.status, body: await res.json() };
    })()`);

    eq('a signCount above 2^31 is accepted, not read as negative', big.status, 200);
    ok('the owner is not locked out by clone detection', big.body?.error === undefined, String(big.body?.error ?? ''));
    const bigRows = await passkeyRows();
    const bigKey = bigRows.find((r) => String(r.id) === String(key?.id));
    // The authenticator increments the counter it was given, so the stored value
    // is at least BIG. A signed 32-bit read would have stored a negative number.
    ok(
      'and the stored counter is the real value',
      Number(bigKey?.counter) >= BIG,
      `stored ${String(bigKey?.counter)}, set ${BIG}`,
    );
    const bigCookie = await cookieValue('strata_session');
    if (bigCookie?.value) cleanup.sessions.push(bigCookie.value);

    /* A regression downwards from that stored value is what clone detection is
       for, so check it still bites in the other direction. */
    await send('WebAuthn.setCredentialProperties', { authenticatorId, credentialId: credId, signCount: 5 });
    await send('Network.clearBrowserCookies');
    const cloned = await evaluateOrReport('the cloned-counter ceremony ran', `(async () => {
      ${HELPERS}
      const options = await (await fetch('/api/passkey', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'authenticate-options' }),
      })).json();
      const assertion = await navigator.credentials.get({ publicKey: { ...options, challenge: b64uToBytes(options.challenge) } });
      const resp = assertion.response;
      const res = await fetch('/api/passkey', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'authenticate-verify',
          credential: {
            id: assertion.id, rawId: bytesToB64u(assertion.rawId),
            response: {
              clientDataJSON: bytesToB64u(resp.clientDataJSON),
              authenticatorData: bytesToB64u(resp.authenticatorData),
              signature: bytesToB64u(resp.signature),
            },
          },
        }),
      });
      return { status: res.status, body: await res.json() };
    })()`);
    eq('a counter that goes backwards is refused', cloned.status, 401);
    eq('and issued no session', (await cookieValue('strata_session'))?.value ?? null, null);
  }

  /* ---------------------------------------------------------------------- */
  /* 5. Replay and unknown credentials                                        */
  /* ---------------------------------------------------------------------- */

  if (signIn.replay) {
    await send('Network.clearBrowserCookies');
    const replayed = await evaluateOrReport('the replay ran', `(async () => {
      const res = await fetch('/api/passkey', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(${JSON.stringify(signIn.replay)}),
      });
      return { status: res.status, body: await res.json() };
    })()`);
    eq('the same assertion cannot be replayed', replayed.status, 401);
    eq('and no session was issued by the replay', (await cookieValue('strata_session'))?.value ?? null, null);
  }

  {
    const forged = await evaluateOrReport('the forged assertion ran', `(async () => {
      const b64uToBytes = (v) => {
        const pad = v.replace(/-/g, '+').replace(/_/g, '/');
        const bin = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
      };
      const bytesToB64u = (bytes) => {
        const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        let s = '';
        for (const b of view) s += String.fromCharCode(b);
        return btoa(s).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
      };
      // A ceremony for this origin, signed by a key nobody has registered.
      const options = await (await fetch('/api/passkey', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'authenticate-options' }),
      })).json();
      const challenge = b64uToBytes(options.challenge);
      const keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
      const clientData = new TextEncoder().encode(JSON.stringify({
        type: 'webauthn.get', challenge: options.challenge, origin: location.origin,
      }));
      const rpIdHash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(location.hostname)));
      const authData = new Uint8Array(37);
      authData.set(rpIdHash, 0);
      authData[32] = 0x05; // UP + UV
      const clientHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientData));
      const signed = new Uint8Array([...authData, ...clientHash]);
      const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, signed));
      const res = await fetch('/api/passkey', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'authenticate-verify',
          credential: {
            id: bytesToB64u(new Uint8Array(32).fill(7)),
            rawId: bytesToB64u(new Uint8Array(32).fill(7)),
            response: {
              clientDataJSON: bytesToB64u(clientData),
              authenticatorData: bytesToB64u(authData),
              signature: bytesToB64u(signature),
            },
          },
        }),
      });
      return { status: res.status, body: await res.json() };
    })()`);
    eq('a self-signed assertion from an unregistered key is refused', forged.status, 401);
    eq('with no session issued', (await cookieValue('strata_session'))?.value ?? null, null);

    /* The non-enumeration property, tested as a pair rather than by pattern
       matching. Two refusals that differ in wording differ in *information*:
       "not registered here" against an unknown credential id, "signature did
       not verify" against a known one, and the difference answers the question
       "is this device enrolled on this site?" for any id a reader supplies. The
       route's own comment promises not to do that, so the two must be
       indistinguishable — identical status, identical body. */
    const probe = (mutate) =>
      evaluateOrReport('the enumeration probe ran', `(async () => {
      ${HELPERS}
      const options = await (await fetch('/api/passkey', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'authenticate-options' }),
      })).json();
      const assertion = await navigator.credentials.get({
        publicKey: { ...options, challenge: b64uToBytes(options.challenge) },
      });
      const resp = assertion.response;
      const credential = {
        id: assertion.id,
        rawId: bytesToB64u(assertion.rawId),
        response: {
          clientDataJSON: bytesToB64u(resp.clientDataJSON),
          authenticatorData: bytesToB64u(resp.authenticatorData),
          signature: bytesToB64u(resp.signature),
        },
      };
      (${mutate})(credential);
      const res = await fetch('/api/passkey', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'authenticate-verify', credential }),
      });
      return { status: res.status, body: await res.json() };
    })()`);

    // A credential that IS registered, carrying a signature that does not verify.
    await send('Network.clearBrowserCookies');
    const knownButBroken = await probe(`(c) => {
      const sig = b64uToBytes(c.response.signature);
      sig[sig.length - 1] ^= 0xff;
      c.response.signature = bytesToB64u(sig);
    }`);
    // A credential id that is not registered at all.
    await send('Network.clearBrowserCookies');
    const unknown = await probe(`(c) => {
      const unknownId = bytesToB64u(new Uint8Array(32).fill(7));
      c.id = unknownId;
      c.rawId = unknownId;
    }`);

    eq('a registered credential with a bad signature is refused', knownButBroken.status, 401);
    eq('an unregistered credential id is refused', unknown.status, 401);
    eq(
      'and the two refusals are word-for-word identical',
      String(unknown.body?.error),
      String(knownButBroken.body?.error),
    );
    ok(
      'so the endpoint is not an oracle for which devices are enrolled',
      String(unknown.body?.error) === String(knownButBroken.body?.error),
      String(unknown.body?.error),
    );
    eq('and neither issued a session', (await cookieValue('strata_session'))?.value ?? null, null);
  }
} finally {
  /* Leave no trace: this run wrote to the local database and the browser. */
  for (const token of new Set(cleanup.sessions)) {
    await db.execute({ sql: 'delete from sessions where token = ?', args: [token] }).catch(() => {});
  }
  for (const id of cleanup.passkeys) {
    await db.execute({ sql: 'delete from passkeys where id = ?', args: [id] }).catch(() => {});
  }
  await send('Network.clearBrowserCookies').catch(() => {});
  await send('WebAuthn.removeVirtualAuthenticator', { authenticatorId }).catch(() => {});
  ws.close();
  await db.close();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);