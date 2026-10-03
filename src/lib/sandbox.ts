/**
 * Runnable code blocks (PLAN.md §4.4, v1.1) — the server half.
 *
 * The browser half is a hard-sandboxed iframe; this module builds its document
 * and decides what is allowed to run at all. Read `docs/threat-model-sandbox.md`
 * first — that document is the gate PLAN.md puts on this feature, and the
 * controls below are its controls, not a summary of it.
 *
 * The short version: the iframe gets an opaque origin (`sandbox="allow-scripts"`
 * with no `allow-same-origin`) so it cannot reach this page's DOM, cookies or
 * storage, and a `default-src 'none'` CSP so it cannot reach the network. The
 * reader's code runs in a Worker inside that frame so a busy loop cannot wedge
 * the page, and the Worker is terminated at a hard deadline.
 */

import type { CodeBlock } from './blocks';
import { RUNNABLE_CODE } from './flags';

export type RunDialect = 'javascript' | 'wasm';

export const RUNNABLE_DIALECTS: readonly RunDialect[] = ['javascript', 'wasm'];

/**
 * Bounds. Every one of these is a decision, not a default: each is the point
 * where "bounded" stops being true.
 */
export const LIMITS = {
  /** Larger input is refused before it is ever handed to the engine. */
  maxInputChars: 20_000,
  /**
   * Characters of captured output. Counted in characters rather than lines, and
   * the run ends the moment it is exceeded - see the note on `p()` below.
   */
  maxOutputChars: 8_000,
  /** Wall-clock deadline for one run. */
  timeoutMs: 2_000,
} as const;

/**
 * Which dialect a block runs as, or `null` if it is not a dialect we execute.
 *
 * `run` is explicit and wins. Inference from the fence language exists so a
 * plain ```js block does not need a second attribute to be usable, but it is
 * deliberately narrow: a block tagged `ts`, `python` or `bash` resolves to null
 * rather than to JavaScript, because running a shell script as JavaScript would
 * produce a syntax error *and* imply a capability the snippet does not have.
 */
export function resolveDialect(lang: string, run?: RunDialect | undefined): RunDialect | null {
  if (run) return RUNNABLE_DIALECTS.includes(run) ? run : null;
  const l = lang.trim().toLowerCase();
  if (l === 'js' || l === 'javascript' || l === 'mjs' || l === 'node') return 'javascript';
  if (l === 'wasm' || l === 'wat' || l === 'wasm-base64') return 'wasm';
  return null;
}

/**
 * May this block run? Both opt-ins required: the server flag and the author's
 * per-block `runnable`. Neither alone is sufficient, which is the point.
 */
export function runnableFor(
  block: Pick<CodeBlock, 'runnable' | 'lang' | 'run' | 'code'>,
): { dialect: RunDialect } | null {
  if (!RUNNABLE_CODE) return null;
  if (!block.runnable) return null;
  const dialect = resolveDialect(block.lang, block.run);
  if (!dialect) return null;
  if (block.code.length > LIMITS.maxInputChars) return null;
  return { dialect };
}

/* -------------------------------------------------------------------------- */
/* The sandbox document                                                         */
/* -------------------------------------------------------------------------- */

/**
 * CSP for the frame. Read against the threat model's controls, not for taste.
 *
 * `default-src 'none'` is the load-bearing line: it denies connect, img, font,
 * style, media and frame-src in one move. `connect-src 'none'` and
 * `form-action 'none'` are repeated on purpose — they are the two the threat
 * model names for exfiltration, and a later edit that loosens `default-src`
 * should not quietly reopen them.
 *
 * `'unsafe-eval'` is required: running reader-supplied JavaScript is `eval` by
 * another name. It is scoped to an opaque-origin frame where there is nothing
 * of ours to reach, and the threat model says so out loud. `'unsafe-inline'`
 * is *not* granted — the harness runs under a nonce, so injected markup in a
 * block's code cannot become script.
 */
function csp(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' 'unsafe-eval' blob:`,
    'worker-src blob:',
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
}

/**
 * The in-frame harness. Written with single-quoted strings and no template
 * literals so it can be embedded in a TypeScript template literal below without
 * escaping games. It must not contain the sequence `</script>`.
 *
 * Responsibilities, in order of importance:
 *  - refuse to talk to anything but its embedder;
 *  - run the snippet in a Worker, never on the frame's own thread;
 *  - terminate that Worker at the deadline;
 *  - bound the output it forwards.
 */
const HARNESS = `
'use strict';
var LIMIT_OUT = __MAX_OUT__;
var LIMIT_MS = __MAX_MS__;
var worker = null;
var timer = null;

function post(msg) {
  try { parent.postMessage(msg, '*'); } catch (e) { /* embedder went away */ }
}

// Built inside the Worker, so the reader's snippet never runs on this frame's
// thread: a synchronous busy loop there would freeze the article the reader is
// trying to read. LIMIT_OUT is substituted in, not inherited — the Worker has
// its own global scope.
function workerSource() {
  return [
    'var OUT = ' + LIMIT_OUT + ';',
    'var buf = [];',
    'var chars = 0;',
    'var over = false;',
    'function fmt(v){',
      'if(typeof v==="string")return v;',
      'if(v===undefined)return "undefined";',
      'try{return JSON.stringify(v,null,2);}catch(e){return String(v);}',
    '}',
    /* The cap is counted in characters, not lines. Counting buf.length capped
       the number of lines, so one console.log of a 10MB string was captured
       whole and 8000 of them were too - which is the memory-bomb row the threat
       model claims to close. Overflow ends the run immediately rather than
       letting the worker keep going to the deadline: the output is already
       over budget, so nothing after it can be worth waiting for. */
    'function p(s){',
      'var t = String(s);',
      'if(chars + t.length > OUT){over=true;done("");return;}',
      'chars += t.length;',
      'buf.push(t);',
    '}',
    'var noop=function(){};',
    'var shim={log:function(){p([].slice.call(arguments).map(fmt).join(" "));}};',
    'shim.info=shim.warn=shim.error=shim.debug=shim.trace=shim.dir=shim.table=noop;',
    'console=shim;',
    'function done(err){',
      'self.postMessage({done:true,out:buf.join("\\\\n"),over:over,err:err||""});',
    '}',
    'onmessage=function(e){',
      'var m=e.data||{};',
      'try{',
        'if(m.dialect==="wasm"){',
          'var bytes=Uint8Array.from(atob(String(m.code).replace(/\\\\s+/g,"")),function(ch){return ch.charCodeAt(0);});',
          'WebAssembly.instantiate(bytes,{}).then(function(res){',
            'var inst=res.instance;',
            'if(typeof inst.exports.run==="function"){p(fmt(inst.exports.run()));done("");}',
            'else{done("This module exports no run(), so there is nothing to call.");}',
          '}).catch(function(err){done(String((err&&err.message)||err));});',
          'return;',
        '}',
        'var fn=new Function(m.code);',
        'fn();',
        'done("");',
      '}catch(err){',
        'done(String((err&&err.message)||err));',
      '}',
    '};'
  ].join('\\n');
}

function runInWorker(code, dialect) {
  if (worker) { worker.terminate(); worker = null; }
  if (timer) { clearTimeout(timer); timer = null; }

  var blob = new Blob([workerSource()], { type: 'text/javascript' });
  worker = new Worker(URL.createObjectURL(blob));
  worker.onmessage = function (e) {
    finish({ done: true, out: e.data.out || '', err: e.data.err || '', over: e.data.over === true });
  };
  worker.onerror = function (e) {
    finish({ done: true, out: '', err: String((e && e.message) || 'The snippet threw.') });
  };
  timer = setTimeout(function () {
    finish({ done: true, out: '', err: '', timeout: true });
  }, LIMIT_MS);
  worker.postMessage({ code: code, dialect: dialect });
}

function finish(res) {
  if (timer) { clearTimeout(timer); timer = null; }
  if (worker) { worker.terminate(); worker = null; }
  if (res.timeout) {
    post({ type: 'result', timeout: true });
    return;
  }
  post({ type: 'result', out: res.out || '', err: res.err || '', over: res.over === true });
}

// Only the embedder may drive this frame. An opaque origin arrives here as the
// literal string "null", so origin is not a usable discriminator; the window
// identity is.
window.addEventListener('message', function (e) {
  if (e.source !== window.parent) return;
  var m = e.data || {};
  if (m.type === 'ping') { post({ type: 'ready' }); return; }
  if (m.type === 'probe') { probe(m); return; }
  if (m.type !== 'run') return;
  runInWorker(String(m.code || ''), String(m.dialect || 'javascript'));
});

/* A boundary self-test. It exists so the claims in the threat model can be
   checked in a real browser rather than believed: an opaque origin is a
   property of this frame, and a paper assertion that the sandbox attribute
   lacks allow-same-origin does not prove the engine honoured it.

   Note for whoever edits this string: it lives inside a TS template literal, so
   no backticks and no dollar-brace sequences may appear in this comment or the
   code below. astro check will not catch it; the dev server parse error will.

   Only ever runs on an explicit request, so it costs nothing in production.

   The network half needs care to mean anything. This frame's own origin is the
   string "null", so an earlier version fetched "null/__probe__", failed to parse
   it, and reported blocked:TypeError - a pass that would have been identical
   with the connect-src directive deleted. The target is now built from the
   origin the embedder supplies and reported before the attempt, so
   no-target is visibly different from blocked. Even then, a refusal here cannot
   be attributed to the CSP rather than to the opaque origin refusing a
   cross-origin read; that is told apart from outside the browser, by watching
   for the request, and docs/threat-model-sandbox.md records how. */
function probe(m) {
  var out = { type: 'probe', origin: null, href: null, cookie: null, parentDoc: null, storage: null, net: null, frameParent: null, netTarget: null };
  try { out.origin = String(location.origin); } catch (err) { out.origin = 'threw'; }
  try { out.href = String(location.href); } catch (err) { out.href = 'threw'; }
  try { out.cookie = String(document.cookie); } catch (err) { out.cookie = 'threw'; }
  try {
    var t = parent.document.title;
    out.parentDoc = t ? 'READABLE:' + t : 'readable-but-empty';
  } catch (err) {
    out.parentDoc = 'blocked:' + (err && err.name);
  }
  try { out.storage = 'length=' + localStorage.length; } catch (err) { out.storage = 'blocked:' + (err && err.name); }
  // The parent global exists as an object here and that is expected - this frame has an
  // embedder. What matters is that reading through it throws SecurityError, which
  // parentDoc above shows. The worker's stronger isolation (no parent at all)
  // is asserted in scripts/check-sandbox-invariants.ts, where it can be observed
  // directly rather than inferred.
  try { out.frameParent = typeof parent; } catch (err) { out.frameParent = 'threw:' + (err && err.name); }
  var target;
  try {
    target = new URL('/__probe__', m && typeof m.origin === 'string' ? m.origin : '').href;
  } catch (err) {
    out.net = 'no-target';
    post(out);
    return;
  }
  out.netTarget = target;
  try {
    fetch(target, { mode: 'no-cors' }).then(
      function () { out.net = 'ALLOWED'; post(out); },
      function (err) { out.net = 'blocked:' + (err && err.name); post(out); }
    );
  } catch (err) {
    out.net = 'blocked:' + (err && err.name);
    post(out);
  }
}

post({ type: 'boot' });
`;

/**
 * Build the frame document. The nonce is fresh per render so a block's code can
 * never be promoted into harness script.
 */
export function buildSandboxDocument(nonce: string): string {
  const harness = HARNESS
    .replaceAll('__MAX_OUT__', String(LIMITS.maxOutputChars))
    .replaceAll('__MAX_MS__', String(LIMITS.timeoutMs));
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${csp(nonce)}">`,
    '<title>snippet</title>',
    '</head><body>',
    `<script nonce="${nonce}">${harness}</script>`,
    '</body></html>',
  ].join('');
}

export function newNonce(): string {
  // Node's global crypto is available without an import in this runtime.
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  let out = '';
  for (const byte of b) out += byte.toString(16).padStart(2, '0');
  return out;
}

/**
 * The `sandbox` token list, in one place so the invariant checker and the
 * component cannot disagree.
 *
 * `allow-scripts` without `allow-same-origin` is the entire security property:
 * scripts run, but in an opaque origin. Adding any other token is a security
 * change and must be argued for in docs/threat-model-sandbox.md first.
 */
export const SANDBOX_TOKENS = ['allow-scripts'] as const;