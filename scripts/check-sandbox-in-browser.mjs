/**
 * The browser half of the sandbox check, over CDP.
 *
 * scripts/check-sandbox-invariants.ts can prove what the generated document
 * says. It cannot prove what the engine does with it, and the whole point of a
 * sandbox is the second thing. So this drives a real browser: it presses the
 * real Run button, asks the frame to describe its own boundary, tries to escape
 * through every channel a snippet has, and watches the browser's own network log
 * to find out whether those attempts ever left the machine.
 *
 * That last part is why this is not just an in-page script. An opaque origin
 * cannot read a cross-origin response anyway, so "the fetch failed" is
 * consistent with both a working CSP and no CSP at all. The only clean
 * discriminator is whether the request was *sent*, and that is observable only
 * from outside the page. Each attempt therefore uses a URL the page never
 * requests, and a control fetch from the page itself proves the observation is
 * live rather than silently empty.
 *
 * Requirements — deliberately not part of CI, which has no browser:
 *   1. A dev server with the flag on:
 *        STRATA_RUNNABLE_CODE=1 npm run dev
 *   2. A browser listening on CDP:
 *        msedge --remote-debugging-port=9222 --user-data-dir=%TEMP%/strata-cdp
 *
 * Run: node scripts/check-sandbox-in-browser.mjs
 * Env: CDP_PORT (9222), SANDBOX_URL (defaults to the seeded article on :4321)
 */

const PORT = process.env.CDP_PORT || '9222';
const URL_UNDER_TEST =
  process.env.SANDBOX_URL || 'http://127.0.0.1:4321/w/cache-invalidation-is-a-distributed-problem';

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
/* A CDP session                                                                */
/* -------------------------------------------------------------------------- */

let version;
try {
  version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
} catch (err) {
  console.error(
    `No browser on CDP port ${PORT}: ${err.message}\n` +
      'Start one with: msedge --remote-debugging-port=' + PORT + ' --user-data-dir=%TEMP%/strata-cdp',
  );
  process.exit(2);
}
console.log(`\nsandbox, in ${version.Browser}\n`);

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
let page = targets.find((t) => t.type === 'page');
if (!page) page = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let nextId = 0;
const pending = new Map();
/** Every request the browser's network layer saw, and every refusal. */
const requests = [];
const refused = [];
const consoleLines = [];

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    return;
  }
  if (msg.method === 'Network.requestWillBeSent') {
    requests.push(`${msg.params.request.method} ${msg.params.request.url}`);
  } else if (msg.method === 'Network.loadingFailed') {
    refused.push(`${msg.params.type}: ${msg.params.errorText}`);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    consoleLines.push('EXCEPTION ' + (msg.params.exceptionDetails?.exception?.description ?? ''));
  } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    consoleLines.push(msg.params.entry.text);
  }
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
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? 'evaluate threw');
  return res.result.value;
}

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Network.enable');
// Start from a clean network log, or the control check proves nothing.
await send('Network.clearBrowserCache');
requests.length = 0;
refused.length = 0;

await send('Page.navigate', { url: URL_UNDER_TEST });
await sleep(4000);

/* -------------------------------------------------------------------------- */
/* 1. The feature works, and pays nothing until it is asked for               */
/* -------------------------------------------------------------------------- */

const before = await evaluate(`(() => {
  const runner = document.querySelector('[data-runner]');
  if (!runner) return null;
  const frame = runner.querySelector('[data-runner-frame]');
  return {
    sandboxAttr: frame.getAttribute('sandbox'),
    frameHasSrcdoc: !!frame.srcdoc,
    dialect: runner.dataset.dialect,
    prefilledChars: runner.querySelector('[data-runner-src]').value.length,
  };
})()`);

if (!before) {
  console.error(
    'No [data-runner] on the page. The flag is off, the block is not marked runnable, or the URL is wrong.',
  );
  process.exit(2);
}
eq('the frame is sandboxed with allow-scripts only', before.sandboxAttr, 'allow-scripts');
ok('no frame document is loaded until Run is pressed', before.frameHasSrcdoc === false);
ok("the author's snippet is in the editor", before.prefilledChars > 50, `${before.prefilledChars} chars`);

/* -------------------------------------------------------------------------- */
/* 2. The author's snippet runs, and a busy loop does not take the page with it */
/* -------------------------------------------------------------------------- */

const ran = await evaluate(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const runner = document.querySelector('[data-runner]');
  const status = runner.querySelector('[data-runner-status]');
  const out = runner.querySelector('[data-runner-out]');
  const src = runner.querySelector('[data-runner-src]');
  const run = runner.querySelector('[data-runner-run]');
  const wait = async () => {
    for (let i = 0; i < 80; i++) {
      await sleep(100);
      if (['Done', 'Threw', 'Stopped'].includes(status.textContent)) return;
    }
  };
  run.click();
  for (let i = 0; i < 60 && runner.dataset.ready !== '1'; i++) await sleep(100);
  await wait();
  const author = { ready: runner.dataset.ready, status: status.textContent, out: out.textContent.trim() };

  src.value = 'while(true){}';
  out.textContent = '';
  status.textContent = 'Not run yet';
  const t0 = performance.now();
  run.click();
  let responsive = false;
  for (let i = 0; i < 120; i++) {
    await sleep(50);
    // Nothing below this line can run if the snippet is on this thread.
    if (status.textContent === 'Stopped') { responsive = true; break; }
  }
  const loop = { status: status.textContent, ms: Math.round(performance.now() - t0), responsive };

  src.value = "for (let i = 0; i < 200000; i++) console.log('line ' + i)";
  out.textContent = '';
  status.textContent = 'Not run yet';
  run.click();
  await wait();
  const cap = {
    status: status.textContent,
    chars: out.textContent.trim().length,
    notice: out.textContent.includes('output capped at'),
  };
  return { author, loop, cap };
})()`);

eq('the frame booted on first Run', ran.author.ready, '1');
eq("the author's own snippet completes", ran.author.status, 'Done');
ok('and prints something', ran.author.out.length > 0, `${ran.author.out.length} chars`);
eq('a busy loop is stopped by the deadline', ran.loop.status, 'Stopped');
ok('and the page never stops responding', ran.loop.responsive, `${ran.loop.ms}ms`);
eq('output past the cap still reports done', ran.cap.status, 'Done');
ok('output is capped', ran.cap.notice, `${ran.cap.chars} chars`);

/* -------------------------------------------------------------------------- */
/* 3. The boundary, as the frame itself sees it                                 */
/* -------------------------------------------------------------------------- */

const probe = await evaluate(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const runner = document.querySelector('[data-runner]');
  runner.dispatchEvent(new CustomEvent('runner:probe'));
  for (let i = 0; i < 60 && !runner.dataset.probe; i++) await sleep(100);
  return runner.dataset.probe ? JSON.parse(runner.dataset.probe) : null;
})()`);

ok('the frame answers a boundary probe', probe !== null);
eq('its origin is opaque', probe?.origin, 'null');
eq('it has no cookie jar', probe?.cookie, 'threw');
eq('it cannot read the parent document', probe?.parentDoc, 'blocked:SecurityError');
eq('it has no localStorage', probe?.storage, 'blocked:SecurityError');
ok(
  'the probe aimed at a real URL rather than an unparseable one',
  typeof probe?.netTarget === 'string' && probe.netTarget.startsWith('http'),
  String(probe?.netTarget),
);
ok('and that request was refused', String(probe?.net).startsWith('blocked'), String(probe?.net));

/* -------------------------------------------------------------------------- */
/* 4. Escape attempts, judged by whether the request left the browser          */
/* -------------------------------------------------------------------------- */

const CHANNELS = {
  fetch: "fetch('__URL__').then(r=>console.log('ALLOWED '+r.status)).catch(e=>console.log('REFUSED '+e.name));console.log('dispatched')",
  xhr: "try{var r=new XMLHttpRequest();r.open('GET','__URL__',false);r.send();console.log('ALLOWED '+r.status)}catch(e){console.log('REFUSED '+e.name)}",
  beacon: "try{navigator.sendBeacon('__URL__','x');console.log('BEACON-CALLED')}catch(e){console.log('REFUSED '+e.name)}",
  webSocket: "try{var w=new WebSocket('__URL__');console.log('CONSTRUCTED')}catch(e){console.log('REFUSED '+e.name)}",
  eventSource: "try{var s=new EventSource('__URL__');console.log('CONSTRUCTED')}catch(e){console.log('REFUSED '+e.name)}",
  importScripts: "try{importScripts('__URL__');console.log('IMPORTED')}catch(e){console.log('REFUSED '+e.name)}",
  // A worker the snippet builds itself. The CSP must be inherited, not sidestepped.
  nestedWorker:
    "var b=new Blob([\"onmessage=function(e){try{var r=new XMLHttpRequest();r.open('GET',e.data,false);r.send();postMessage('ALLOWED '+r.status)}catch(err){postMessage('REFUSED '+err.name)}}\"],{type:'text/javascript'});var w=new Worker(URL.createObjectURL(b));w.onmessage=function(ev){console.log('NESTED '+ev.data)};w.postMessage('__URL__');console.log('nested worker started')",
};

const sent = Object.keys(CHANNELS);
const script = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const runner = document.querySelector('[data-runner]');
  const status = runner.querySelector('[data-runner-status]');
  const out = runner.querySelector('[data-runner-out]');
  const src = runner.querySelector('[data-runner-src]');
  const run = runner.querySelector('[data-runner-run]');
  const origin = location.origin;
  const wsOrigin = origin.replace('http', 'ws');
  const results = {};
  for (const [name, code] of Object.entries(${JSON.stringify(CHANNELS)})) {
    const url = name === 'webSocket' || name === 'nestedWorkerWebSocket'
      ? wsOrigin + '/__escape_' + name + '__'
      : origin + '/__escape_' + name + '__';
    src.value = code.replaceAll('__URL__', url);
    out.textContent = '';
    status.textContent = 'Not run yet';
    run.click();
    for (let i = 0; i < 60; i++) {
      await sleep(100);
      if (['Done', 'Threw', 'Stopped'].includes(status.textContent)) break;
    }
    results[name] = out.textContent.trim().slice(0, 120);
    await sleep(400);
  }
  // Control: the page's own thread, same origin, same moment. If this does not
  // appear in the network log then the log is not working and the rows below
  // mean nothing.
  results.control = await fetch(origin + '/__escape_control__').then((r) => 'got ' + r.status, (e) => 'failed ' + e.name);
  return results;
})()`;

const attempts = await evaluate(script);

for (const name of sent) {
  const reached = requests.some((r) => r.includes(`/__escape_${name}__`));
  ok(`${name}: nothing left the browser`, !reached, attempts[name]);
}
ok(
  'the control request from the page did reach the browser',
  requests.some((r) => r.includes('/__escape_control__')),
  attempts.control,
);
ok(
  'and no request in the log came from the sandbox frame',
  requests.every((r) => !r.includes('__probe__')),
);

/* -------------------------------------------------------------------------- */
/* 5. What reader code can see at all                                          */
/* -------------------------------------------------------------------------- */

const globals = await evaluate(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const runner = document.querySelector('[data-runner]');
  const status = runner.querySelector('[data-runner-status]');
  const out = runner.querySelector('[data-runner-out]');
  const src = runner.querySelector('[data-runner-src]');
  const run = runner.querySelector('[data-runner-run]');
  src.value = "try{var r=indexedDB.open('x');console.log('IDB-OPENED')}catch(e){console.log('IDB-REFUSED '+e.name)};console.log(['SharedArrayBuffer','document','parent','localStorage','caches'].map(function(k){return k+'='+typeof self[k]}).join(' '))";
  out.textContent = '';
  status.textContent = 'Not run yet';
  run.click();
  for (let i = 0; i < 60; i++) {
    await sleep(100);
    if (['Done', 'Threw', 'Stopped'].includes(status.textContent)) break;
  }
  return out.textContent.trim();
})()`);

ok('reader code has no document, parent or storage to reach through', /document=undefined/.test(globals) && /parent=undefined/.test(globals) && /localStorage=undefined/.test(globals), globals);
ok('there is no Cache Storage in an opaque origin', /caches=undefined/.test(globals));
ok('SharedArrayBuffer is unreachable, so no shared memory', /SharedArrayBuffer=undefined/.test(globals));
ok("the reader's IndexedDB is refused", /IDB-REFUSED/.test(globals));

if (consoleLines.length) {
  console.log('\n--- page console ---');
  for (const line of consoleLines.slice(0, 20)) console.log('  ' + line);
}

ws.close();
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);