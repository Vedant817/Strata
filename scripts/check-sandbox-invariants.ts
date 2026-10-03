/**
 * Sandbox invariants.
 *
 * The sandbox is the one place in this product that executes code a reader can
 * change. Its security properties are therefore asserted rather than trusted:
 * every control in docs/threat-model-sandbox.md that can be stated about the
 * *generated document* is stated here, so a later edit that quietly loosens the
 * `sandbox` token list or the CSP fails this script instead of shipping.
 *
 * Runtime behaviour — that the network is really blocked and a busy loop is
 * really killed — cannot be asserted from Node. That is verified in a real
 * browser by scripts/check-sandbox-in-browser.mjs, which needs a browser on CDP
 * and a dev server with the flag on, so it is not part of CI.
 *
 * Run: npx tsx scripts/check-sandbox-invariants.ts
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** The embedder half, read as source: the boundary is the pair of them. */
const component = readFileSync(path.join(projectRoot, 'src/components/CodeRunner.astro'), 'utf8');

/* -------------------------------------------------------------------------- */
/* Assertions                                                                  */
/* -------------------------------------------------------------------------- */

let passed = 0;
let failed = 0;

function ok(label: string, condition: boolean, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ok   ${label}${detail ? `  ${detail}` : ''}`);
  } else {
    failed++;
    console.error(`  FAIL ${label}${detail ? `  ${detail}` : ''}`);
  }
}

/**
 * Deep equality, not `Object.is`. Two arrays with identical contents are not the
 * same object, and an identity check on them would fail while asserting nothing.
 */
function eq(label: string, actual: unknown, expected: unknown) {
  const same =
    Object.is(actual, expected) ||
    (typeof actual === 'object' &&
      actual !== null &&
      JSON.stringify(actual) === JSON.stringify(expected));
  ok(label, same, same ? '' : `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

console.log('\nsandbox invariants\n');

/* -------------------------------------------------------------------------- */
/* 1. The flag fails closed                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Probed in child processes. The flag is read at module load — deliberately, so
 * it is a property of the deployment rather than something that can change
 * mid-request — which means an in-process probe would keep seeing the first
 * value it happened to cache. Each case therefore gets its own process.
 */
function probeFlag(value: string | undefined): boolean {
  const env = { ...process.env };
  if (value === undefined) delete env.STRATA_RUNNABLE_CODE;
  else env.STRATA_RUNNABLE_CODE = value;
  const res = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      "import {RUNNABLE_CODE} from './src/lib/flags.ts'; process.stdout.write(String(RUNNABLE_CODE));",
    ],
    { env, encoding: 'utf8', cwd: process.cwd() },
  );
  if (res.status !== 0) throw new Error(`flag probe failed for ${JSON.stringify(value)}: ${res.stderr}`);
  return res.stdout.trim() === 'true';
}

for (const [value, expected] of [
  [undefined, false],
  ['1', true],
  ['0', false],
  ['', false],
  ['true', false],
  ['yes', false],
  ['on', false],
  [' 1 ', false],
] as const) {
  eq(
    `STRATA_RUNNABLE_CODE=${value === undefined ? '(unset)' : JSON.stringify(value)} -> ${expected}`,
    probeFlag(value),
    expected,
  );
}

/** Same isolation, for the two-opt-in gate that depends on the flag. */
function probeRunnable(
  value: string | undefined,
  runnable: boolean,
  opts: { lang?: string; code?: string } = {},
): [unknown, number] {
  const env = { ...process.env };
  if (value === undefined) delete env.STRATA_RUNNABLE_CODE;
  else env.STRATA_RUNNABLE_CODE = value;
  const lang = opts.lang ?? 'javascript';
  const code = opts.code ?? 'x';
  const res = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      `import {LIMITS,runnableFor} from './src/lib/sandbox.ts';
       process.stdout.write(JSON.stringify([
         runnableFor({runnable:${runnable},lang:${JSON.stringify(lang)},code:${JSON.stringify(code)},run:'javascript'}),
         LIMITS.maxInputChars,
       ]));`,
    ],
    { env, encoding: 'utf8', cwd: process.cwd() },
  );
  if (res.status !== 0) throw new Error(`runnable probe failed: ${res.stderr}`);
  const parsed = JSON.parse(res.stdout) as [unknown, number];
  return parsed;
}

/* -------------------------------------------------------------------------- */
/* 2. Both opt-ins are required                                                */
/* -------------------------------------------------------------------------- */

eq('flag on but block not marked runnable -> refused', probeRunnable('1', false)[0], null);
eq('block marked runnable but flag off -> refused', probeRunnable(undefined, true)[0], null);
eq('both opt-ins -> allowed', probeRunnable('1', true)[0], { dialect: 'javascript' });

const [, maxInputChars] = probeRunnable('1', true);
eq(
  'oversized input is refused before execution',
  probeRunnable('1', true, { code: 'x'.repeat(maxInputChars + 1) })[0],
  null,
);
eq('input at exactly the cap is still allowed', probeRunnable('1', true, { code: 'x'.repeat(maxInputChars) })[0], {
  dialect: 'javascript',
});

const { LIMITS, RUNNABLE_DIALECTS, SANDBOX_TOKENS, buildSandboxDocument, newNonce, resolveDialect } =
  await import('../src/lib/sandbox');

/** The tuple's literal type would otherwise reject every token we assert absent. */
const tokens: readonly string[] = SANDBOX_TOKENS;

/* -------------------------------------------------------------------------- */
/* 3. Dialect resolution is narrow                                             */
/* -------------------------------------------------------------------------- */

eq('js infers javascript', resolveDialect('js'), 'javascript');
eq('javascript infers javascript', resolveDialect('javascript'), 'javascript');
eq('wasm infers wasm', resolveDialect('wasm'), 'wasm');
for (const lang of ['ts', 'typescript', 'python', 'bash', 'sh', 'sql', 'json', 'yaml', '', 'rust']) {
  eq(`${JSON.stringify(lang)} is not executable`, resolveDialect(lang), null);
}
// Explicit `run` wins, but still only to a dialect we support.
eq('explicit run overrides lang', resolveDialect('ts', 'javascript'), 'javascript');
eq('explicit wasm overrides lang', resolveDialect('javascript', 'wasm'), 'wasm');
eq('every advertised dialect is one we know', [...RUNNABLE_DIALECTS].sort(), ['javascript', 'wasm']);

/* -------------------------------------------------------------------------- */
/* 4. The sandbox attribute is the whole security property                    */
/* -------------------------------------------------------------------------- */

eq('sandbox tokens are exactly [allow-scripts]', [...tokens], ['allow-scripts']);
for (const forbidden of [
  'allow-same-origin',
  'allow-top-navigation',
  'allow-top-navigation-by-user-activation',
  'allow-popups',
  'allow-forms',
  'allow-modals',
  'allow-pointer-lock',
  'allow-downloads',
  'allow-presentation',
]) {
  ok(`sandbox omits ${forbidden}`, !tokens.includes(forbidden));
}
// The dangerous combination in the other direction: scripts without same-origin
// is safe, same-origin without scripts is inert, both together is not.
ok(
  'sandbox grants scripts but never same-origin',
  tokens.includes('allow-scripts') && !tokens.includes('allow-same-origin'),
);

/* -------------------------------------------------------------------------- */
/* 5. The CSP closes the network                                               */
/* -------------------------------------------------------------------------- */

const doc = buildSandboxDocument(newNonce());

ok('document declares a CSP', doc.includes('http-equiv="Content-Security-Policy"'));
ok("default-src is 'none'", /default-src 'none'/.test(doc));
ok("connect-src is 'none'", /connect-src 'none'/.test(doc));
ok("form-action is 'none'", /form-action 'none'/.test(doc));
ok("base-uri is 'none'", /base-uri 'none'/.test(doc));
ok('worker-src allows the blob worker', /worker-src blob:/.test(doc));
ok('frame is fed by srcdoc, never fetched', !/<iframe/i.test(doc));

// No directive may re-open the network.
for (const leaky of [
  "img-src *",
  "img-src 'self'",
  "script-src http:",
  'connect-src *',
  "default-src *",
  "default-src 'self'",
  "style-src 'unsafe-inline' http:",
]) {
  ok(`CSP does not contain ${leaky}`, !doc.includes(leaky));
}

// 'unsafe-eval' is required to run reader JS; 'unsafe-inline' is not granted,
// because the harness runs under a nonce.
ok("CSP grants 'unsafe-eval' (required to run reader JS)", doc.includes("'unsafe-eval'"));
ok("CSP does not grant 'unsafe-inline'", !doc.includes("'unsafe-inline'"));

/* -------------------------------------------------------------------------- */
/* 6. Nonces                                                                   */
/* -------------------------------------------------------------------------- */

const nonceA = newNonce();
const nonceB = newNonce();
ok('nonces are 32 hex chars', /^[0-9a-f]{32}$/.test(nonceA), nonceA);
ok('nonces differ per render', nonceA !== nonceB);
{
  const d = buildSandboxDocument('TESTNONCE');
  ok('the CSP carries the nonce', d.includes("'nonce-TESTNONCE'"));
  ok('the harness script carries the nonce', d.includes('<script nonce="TESTNONCE">'));
}

/* -------------------------------------------------------------------------- */
/* 7. The generated harness is internally consistent                           */
/* -------------------------------------------------------------------------- */

{
  // Every placeholder must have been substituted, or the frame would ship a
  // ReferenceError on load and the failure would look like "the Run button is
  // broken" rather than "the build is wrong".
  ok('no unsubstituted MAX_OUT placeholder', !doc.includes('__MAX_OUT__'));
  ok('no unsubstituted MAX_MS placeholder', !doc.includes('__MAX_MS__'));
  // The worker source is assembled by string concatenation *inside* the frame,
  // so the cap reaches it as the harness-scope constant rather than baked in.
  ok('the output cap is defined in harness scope', doc.includes(`var LIMIT_OUT = ${LIMITS.maxOutputChars};`));
  ok('the worker reads that constant', doc.includes("'var OUT = ' + LIMIT_OUT + ';'"));
  ok('the deadline is present in the harness', doc.includes(`var LIMIT_MS = ${LIMITS.timeoutMs};`));

  // A script element cannot contain its own close tag, or the harness is
  // truncated and the frame silently half-loads.
  const scriptBody = doc.slice(doc.indexOf('<script'), doc.indexOf('</script>'));
  ok('the harness contains no premature </script', !scriptBody.includes('</script'));

  ok('the harness terminates the worker on the deadline', doc.includes('worker.terminate()'));
  ok('the harness runs the snippet in a Worker', doc.includes('new Worker('));
  ok('the harness only accepts messages from its embedder', doc.includes('e.source !== window.parent'));
  // The *run* path must never touch the network. The deliberate boundary probe
  // does fetch, in order to prove the request is refused, so scoping matters:
  // asserting this over the whole harness would have flagged the test that
  // verifies the control.
  const probeStart = doc.indexOf('function probe(');
  ok('the harness has a boundary probe', probeStart > 0);
  const runPath = doc.slice(0, probeStart === -1 ? doc.length : probeStart);
  ok(
    'the run path does not fetch',
    !/\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource/.test(runPath),
  );
  const probePath = probeStart === -1 ? '' : doc.slice(probeStart);
  ok(
    'the probe attempts exactly one fetch, to prove it is refused',
    (probePath.match(/\bfetch\(/g) ?? []).length === 1,
  );
  /* The bug this catches: the probe used to fetch `location.origin + '/__probe__'`,
     and inside an opaque-origin frame that is the unparseable string "null", so
     the TypeError it reported was indistinguishable from a real refusal. The
     target must now come from the embedder, and a target that cannot be built
     must be reported as its own outcome rather than as a block. */
  ok(
    'the probe builds its target from the origin the embedder supplies',
    probePath.includes('m.origin') && probePath.includes('new URL('),
  );
  ok(
    'the probe never builds its target from this frame’s own origin',
    !/fetch\(\s*location\.origin/.test(probePath),
  );
  ok('an unbuildable target is reported as no-target, not as a block', probePath.includes("'no-target'"));
  ok('the probe reports the target it attempted', probePath.includes('netTarget'));
  // And the other side of it: the page has to supply that origin, or the probe
  // can only ever report that it had nothing to fetch.
  ok(
    'the embedder sends its origin with the probe request',
    component.includes('origin: window.location.origin'),
  );
  ok('the embedder keeps the answer where a test can read it', component.includes('data-probe'));
}

/* -------------------------------------------------------------------------- */
/* 8. Limits are real                                                          */
/* -------------------------------------------------------------------------- */

ok('input cap is positive', LIMITS.maxInputChars > 0);
ok('output cap is positive', LIMITS.maxOutputChars > 0);
ok('deadline is positive and bounded', LIMITS.timeoutMs > 0 && LIMITS.timeoutMs <= 10_000);
ok('output cap is smaller than the input cap', LIMITS.maxOutputChars < LIMITS.maxInputChars);

/* -------------------------------------------------------------------------- */
/* 9. The threat model exists and names the controls it claims                 */
/* -------------------------------------------------------------------------- */

{
  const fs = await import('node:fs');
  const path = await import('node:path');
  const url = await import('node:url');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const file = path.resolve(here, '../docs/threat-model-sandbox.md');
  ok('the threat model exists', fs.existsSync(file));
  const text = fs.readFileSync(file, 'utf8');
  for (const topic of ['allow-same-origin', 'connect-src', 'worker', 'Residual risk', 'sandbox']) {
    ok(`the threat model covers "${topic}"`, text.includes(topic));
  }
  ok('the threat model is not a stub', text.length > 2000, `${text.length} chars`);
}

/* -------------------------------------------------------------------------- */
/* 10. The generated worker source is real JavaScript, and it runs             */
/* -------------------------------------------------------------------------- */

/**
 * This section exists because of a bug that every check above missed.
 *
 * The worker source is assembled inside a template literal and then inside
 * string literals, so its escapes sit two levels of quoting away from the
 * worker that has to parse them. `buf.join("\n")` written at the wrong depth
 * produced a literal newline *inside* a string literal in the generated worker,
 * which is a SyntaxError — so every snippet, including the author's own, died
 * with "Invalid or unexpected token". `astro check` was green, the generated
 * document contained `worker.terminate()`, and the CSP was correct.
 *
 * Assertions about the document's text cannot see this. The only thing that
 * can is doing what the worker does: parse the generated source, then run it and
 * read what it posts back.
 */
{
  const vm = await import('node:vm');

  const body = doc.slice(
    doc.indexOf('<script nonce=') + '<script nonce="'.length,
    doc.indexOf('</script>'),
  ).replace(/^[^>]*>/, '');

  /* The harness only needs a window to attach a listener to in order to define
     its own functions, so a stub context is enough to recover workerSource(). */
  const host: Record<string, unknown> = {
    Blob: class {},
    Worker: class {},
    URL: { createObjectURL: () => 'blob:stub' },
    addEventListener: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    console,
  };
  host.window = host;
  vm.createContext(host);
  vm.runInContext(body, host, { filename: 'sandbox-harness.js' });

  const makeSource = host.workerSource as () => string;
  ok('the harness can produce its worker source', typeof makeSource === 'function');
  const workerSrc = typeof makeSource === 'function' ? makeSource() : '';

  try {
    new vm.Script(workerSrc, { filename: 'worker.js' });
    ok('the generated worker source parses', true);
  } catch (err) {
    ok('the generated worker source parses', false, String((err as Error).message));
  }

  /** Set by every runWorker call, asserted once below rather than per call. */
  let handlerInstalled = false;

  /** Run a snippet exactly as the Worker would, and return what it posted. */
  async function runWorker(code: string, dialect: string, out: number = LIMITS.maxOutputChars) {
    const posted: Array<Record<string, unknown>> = [];
    const self: Record<string, unknown> = {
      postMessage: (m: Record<string, unknown>) => posted.push(m),
    };
    self.self = self;
    const ctx: Record<string, unknown> = {
      Uint8Array,
      WebAssembly,
      atob,
      console,
      outLimit: out,
      self,
    };
    vm.createContext(ctx);
    vm.runInContext(workerSrc.replace('var OUT = ' + LIMITS.maxOutputChars + ';', 'var OUT = outLimit;'), ctx, {
      filename: 'worker.js',
    });
    const handler = ctx.onmessage as ((e: { data: unknown }) => void) | undefined;
    if (typeof handler === 'function') handlerInstalled = true;
    handler?.({ data: { code, dialect } });
    // The wasm path settles asynchronously; give it a turn.
    for (let i = 0; i < 20 && posted.length === 0; i++) await new Promise((r) => setTimeout(r, 0));
    return posted[0] as { done: boolean; out: string; over: boolean; err: string } | undefined;
  }
  {
    /* One real run proves both that a handler is installed and that it works. */
    const first = await runWorker("console.log('probe')", 'javascript');
    ok('the worker installs a message handler', handlerInstalled);
    ok('the worker is drivable end to end', first?.out === 'probe');
  }

  /* The assertion that would have caught the escaping bug: real snippets, real
     output, real newlines between lines. */
  {
    const r = await runWorker("console.log('alpha');console.log('beta')", 'javascript');
    ok('a snippet runs and reports completion', r?.done === true);
    ok('a snippet produces no error', r?.err === '', `err=${JSON.stringify(r?.err)}`);
    eq('output lines are joined by real newlines', r?.out, 'alpha\nbeta');
    ok('the output is not over the cap', r?.over === false);
  }

  {
    const r = await runWorker('console.log({a:1,b:[2,3]});console.log(undefined)', 'javascript');
    eq('values are formatted rather than stringified as objects', r?.out, '{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}\nundefined');
  }

  {
    const r = await runWorker('throw new Error("boom")', 'javascript');
    ok('a throwing snippet is reported, not swallowed', (r?.err ?? '').includes('boom'), `err=${r?.err}`);
  }

  {
    /* A character cap, not a line cap. Output up to the cap survives; the write
       that crosses it ends the run. A line-count cap would pass the first
       assertion and fail this one for any long line. */
    const r = await runWorker("console.log('abcdefghij');console.log('klm')", 'javascript', 10);
    ok('the character cap trips', r?.over === true);
    eq('output written before the cap survives', r?.out, 'abcdefghij');
    ok('nothing is captured past the cap', (r?.out.length ?? 0) <= 10);
  }

  {
    const r = await runWorker("console.log('x'.repeat(100000))", 'javascript', 10);
    ok('one very long line trips the cap on its own', r?.over === true);
    ok('the long line is not captured at all', (r?.out.length ?? 0) <= 10, `${r?.out.length} chars`);
  }

  {
    /* A worker has no `parent`, so reader code cannot reach the frame at all —
         one boundary further in than the sandbox attribute provides. */
    const r = await runWorker('console.log(typeof parent, typeof document, typeof location)', 'javascript');
    eq('the worker has no parent, document or location', r?.out, 'undefined undefined undefined');
  }

  /* The wasm path, including the base64 whitespace strip. Inserting newlines into
     the base64 is exactly what a formatter does, and the regex that removes them
     is itself a generated escape. */
  {
    /* Minimal module: one exported `run` of type () -> (). Assembled by hand so
       the fixture cannot rot when a wasm helper library changes. */
    const withRun = Uint8Array.from([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // magic, version 1
      0x01, 0x04, 0x01, 0x60, 0x00, 0x00, // type: () -> ()
      0x03, 0x02, 0x01, 0x00, // func 0 has type 0
      0x07, 0x07, 0x01, 0x03, 0x72, 0x75, 0x6e, 0x00, 0x00, // export "run" = func 0
      0x0a, 0x04, 0x01, 0x02, 0x00, 0x0b, // body: no locals, end
    ]);
    /* Same, but the export is named something else. */
    const withoutRun = Uint8Array.from([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x04, 0x01, 0x60, 0x00, 0x00, 0x03,
      0x02, 0x01, 0x00, 0x07, 0x07, 0x01, 0x03, 0x67, 0x65, 0x74, 0x00, 0x00, 0x0a, 0x04, 0x01, 0x02,
      0x00, 0x0b,
    ]);
    ok('the run-exporting wasm fixture is valid', WebAssembly.validate(withRun));
    ok('the non-run wasm fixture is valid', WebAssembly.validate(withoutRun));

    const b64 = Buffer.from(withRun).toString('base64');
    const wrapped = b64.replace(/(.{4})(?=.)/g, '$1\n');
    ok('the fixture base64 was wrapped across lines', wrapped.includes('\n'));

    const r = await runWorker(wrapped, 'wasm');
    ok('a wasm module with wrapped base64 instantiates and runs', r?.err === '', `err=${JSON.stringify(r?.err)}`);
    ok('the wasm path reports completion', r?.done === true);

    /* Not a module at all. The earlier fixture here was a bare magic+version
       header, which is a *valid* empty module - so it took the no-run() branch
       and the assertion passed without ever testing a compile failure. */
    const notWasm = Buffer.from('this is not a wasm module at all').toString('base64');
    const notWasmBytes = Uint8Array.from(Buffer.from(notWasm, 'base64'));
    ok('the malformed wasm fixture really is not a module', !WebAssembly.validate(notWasmBytes));
    const bad = await runWorker(notWasm, 'wasm');
    ok('a non-module is reported as an error, not a crash', (bad?.err ?? '').length > 0, `err=${bad?.err}`);
    ok('a non-module never reports success', bad?.done === true && (bad?.err ?? '') !== '');

    const missing = await runWorker(Buffer.from(withoutRun).toString('base64'), 'wasm');
    ok(
      'a module without run() explains itself',
      (missing?.err ?? '').includes('run()'),
      `err=${missing?.err}`,
    );
  }
}

/* -------------------------------------------------------------------------- */

process.exit(failed === 0 ? 0 : 1);