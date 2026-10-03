# Threat model — runnable code blocks (PLAN.md §4.4, v1.1)

Written before the implementation, because PLAN.md gates this feature on it:
*"Security surface is real; it is feature-flagged and off until it has a
threat model."*

The feature is **"Run this against my inputs"**: a reader can edit a code block
and execute it in place, to see whether the author's example still holds.

## 1. What actually executes, and who supplies it

Two distinct sources, and they have different risk:

| Source | Trust | Note |
| --- | --- | --- |
| The **author's** snippet in the article | First-party, but not necessarily benign | The real attack. The reader clicks Run on something that *looks* like the author's worked example. |
| The **reader's** edit of it | Untrusted, self-supplied | Not an attack on the site. It is the reader's own browser and their own choice. |

A reader pasting hostile code into their own sandbox is not a threat to us. An
author publishing a hostile `runnable` block is. That distinction sets the
priority: the controls that matter are the ones that stop a *snippet the reader
did not write* from reaching the reader's account, the site's origin, or the
network.

## 2. Assets at risk

1. **The reader's session.** `httpOnly`, so script cannot read the cookie — but it
   could still issue authenticated requests as the reader if it could reach the
   network or our origin.
2. **The site's origin.** Any DOM, `localStorage`, or `IndexedDB` belonging to
   the reader's session on this site.
3. **The reader's privacy.** PLAN.md §1.3 makes privacy a product promise and
   the only non-negotiable is first-party data. A snippet that beacons home is a
   third-party data flow created by a first-party page.
4. **The reader's device.** CPU, memory, and a wedged tab.

## 3. Controls

The sandbox is an `<iframe>` with a hard `sandbox` attribute, fed by `srcdoc`
so the document itself is never fetched.

| # | Threat | Control |
| --- | --- | --- |
| 1 | Read the parent DOM, cookies, or storage | `sandbox="allow-scripts"` with **no** `allow-same-origin` → opaque origin. The frame cannot touch `parent.document`, and opaque origins carry no cookies and have no access to our storage. |
| 2 | Any network egress — `fetch`, `XHR`, `WebSocket`, `EventSource`, `sendBeacon`, DNS | CSP inside the frame: `default-src 'none'`, `connect-src 'none'`. Also `form-action 'none'`. |
| 3 | Load remote script, images, or fonts | `default-src 'none'` with no `img-src`/`font-src`/`style-src` exceptions beyond inline style needed for output. |
| 4 | Ride the reader's session against our own API | Opaque origin sends no credentials, and `connect-src 'none'` blocks the request even so. |
| 5 | Persist a payload for other readers | Reader edits are **never sent to the server**. They live in the browser only. The only code we ever store is the author's, which is already part of the article. |
| 6 | Infinite loop / tab hang | The snippet runs in a **Web Worker**, so a synchronous busy loop cannot block the page thread. The worker is `terminate()`d at a hard deadline (2s). |
| 7 | Unbounded output / memory bomb | Byte and line caps on captured output. Oversize output terminates the worker. Input is capped before compile. |
| 8 | Modal spam, popups, top-level navigation, form submission, pointer lock, clipboard | Absent from the `sandbox` token list: no `allow-modals`, `allow-popups`, `allow-top-navigation`, `allow-forms`, `allow-pointer-lock`. Opaque origin has no permissions. |
| 9 | Cross-origin isolation we would have to pay for | `SharedArrayBuffer` needs COOP/COEP, which we do not set, so threads and shared memory are unreachable. |

Nothing executes on the server. That is the single largest design decision: the
worst case is bounded by the reader's own browser and a 2-second deadline.

## 4. Verified in a real browser, not asserted here

Paper claims about a sandbox are worth very little, so the controls below were
checked in Edge (Chromium 154) by driving the page over CDP with the flag on.
`scripts/check-sandbox-in-browser.mjs` does that and asserts all of it in one
command, so this section is a record rather than a claim. The results, because
"the request failed" is not the same as "the request was blocked" — from an
opaque origin a *readable* cross-origin response is refused too, by CORS, with
a similar-looking error:

| Control | What was done | Observed |
| --- | --- | --- |
| 1 — opaque origin | Frame reports its own origin | `origin: "null"`, `href: about:srcdoc`, worker base `blob:null/…` |
| 1 — no page access | Read `parent.document.title`, `document.cookie`, `localStorage` from the frame | `SecurityError` on all three |
| 1 — no storage, from reader code | `indexedDB.open(...)` in the worker | `SecurityError` |
| 2 — no egress | `fetch`, sync `XHR`, `sendBeacon`, `new WebSocket`, `new EventSource`, `importScripts`, each to a unique URL | **None of the URLs appears in the browser's network log**, while a control `fetch` to the same origin from the page does |
| 2 — egress from a worker the snippet builds | A nested `Worker` doing its own `XHR` / `WebSocket` | No request either: the CSP is inherited, not bypassed by spawning |
| 6 — no tab hang | `while(true){}` | `Stopped` after ~2.4s, page stayed responsive |
| 7 — output cap | 200 000 `console.log` lines | 9 045 characters captured, `[output capped at 8000 characters]` appended |
| 9 — no cross-origin isolation | `typeof SharedArrayBuffer` in the worker | `undefined` |

Two things that look alarming and are not, recorded so nobody re-investigates
them:

- **`new WebSocket(...)` and `new EventSource(...)` do not throw.** The
  constructor returns; the connection simply never opens, which is why the
  network log — not the exception — is what decides the row above.
- **`document`, `parent` and `localStorage` are `undefined` (ReferenceError) in
  the worker's scope**, not merely inaccessible. Reader code does not run on the
  frame's thread at all, which is a stronger position than control 1 requires.

The frame's own self-test (`probe`, asked for via the `runner:probe` event and
answered on `data-probe`) reports `netTarget` and `net` so this can be repeated
in one command. An earlier version of that probe was worse than useless: it
fetched `location.origin + '/__probe__'`, which inside an opaque-origin frame is
the unparseable string `"null/__probe__"`, so it reported `blocked:TypeError`
whether or not `connect-src` existed. It now takes the origin from the embedder,
reports the target it attempted, and distinguishes `no-target` from `blocked`.

## 5. Residual risk, stated honestly

1. **`unsafe-eval` is required.** Running reader-supplied JavaScript is
   `eval` by another name. It is scoped to an opaque-origin frame where there is
   nothing of ours to read, but it is a real relaxation and is called out here
   rather than buried.
2. **Browser and engine vulnerabilities are out of our control.** A sandbox is
   not a defence against a renderer CVE.
3. **Bounded CPU abuse is possible.** A snippet can burn CPU for up to the
   deadline. The cap is 2s of a background worker; it is a bound, not a zero.
4. **WASM growth.** Input bytes are capped before `compile`. A module that
   grows past the output cap is terminated, but memory pressure inside the
   worker before the cap trips is not fully bounded.
5. **We do not claim the code is safe.** We claim it cannot reach the site's
   origin, cannot reach the network, and cannot persist.
6. **`new Worker` is still available to reader code.** It costs nothing here —
   the CSP is inherited, as §4 shows — but a future edit to the CSP that granted
   `worker-src` anything wider would need this retested.

## 6. Shipping decision

PLAN.md's condition for enabling this — a threat model — is now met. It stays
**off by default** anyway, and needs two independent opt-ins:

- the server-side flag `STRATA_RUNNABLE_CODE=1`, and
- a per-block `runnable: true` from the author.

A snippet is never runnable merely because it is a code block. A Kubernetes
manifest, a shell pipeline, or a server config should not grow a Run button
because of where it sits in the schema.

`scripts/check-sandbox-invariants.ts` asserts controls 1, 2 and 5 against the
rendered document and the generated harness, so a future edit cannot quietly
drop the `sandbox` token list, loosen the CSP, or turn the boundary probe back
into one that passes whether or not it is protected. It cannot assert what §4
asserts — that is a browser, and the table above is the record of the last run.