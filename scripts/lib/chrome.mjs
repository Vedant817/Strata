/**
 * One place that knows where a browser is.
 *
 * Six gate scripts each had their own copy of this list, and three of them were
 * wrong in the same way: Windows paths only, no `CHROME_PATH`, no Linux paths.
 * That is invisible on the machine that wrote them and fatal on a runner.
 *
 * It cost three CI failures to notice, one per gate:
 *
 *   - check-viewports searched nothing but `%PROGRAMFILES%`, so it could not find
 *     a browser on `ubuntu-latest` even after CI installed one.
 *   - check-digest built its path by interpolation with no existence check, so on
 *     Linux it produced the literal string `undefined\Google\Chrome\Application\
 *     chrome.exe`, spawned it, and died on an unhandled `spawn` ENOENT. The gate
 *     did not report "no browser"; it threw a stack trace.
 *   - check-xss had two Linux paths but no `CHROME_PATH`, so it could not be
 *     pointed at the Chrome a runner had just installed.
 *
 * The fix is not a sixth copy with the right entries. It is one list, imported by
 * every gate that needs a browser, so the next platform cannot be missed by one
 * script and remembered by the other five.
 *
 * `.mjs` rather than `.ts` because field-metrics.mjs runs under plain `node`, not
 * under tsx, and must be able to import this.
 */

import fs from 'node:fs';

export { spawn } from 'node:child_process';

/**
 * Every location this repository has ever run a browser from, in order of
 * specificity. `CHROME_PATH` leads so a runner can name the binary it installed.
 *
 * The order matters more than the membership: on a Windows machine both the
 * Chrome and the Edge path may exist, and the gate has been measuring one browser
 * consistently, which is what makes a number comparable to the last one.
 */
const CANDIDATES = [
  process.env.CHROME_PATH,
  // Windows
  `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
  `${process.env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
  // Linux, including the names GitHub's setup-chrome and the distro packages use
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  // macOS
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];

/** The first browser on this machine that actually exists, or null. */
export function findChrome() {
  return CANDIDATES.find((p) => p && fs.existsSync(p)) ?? null;
}

/**
 * The same, but a gate that cannot measure without a browser should say so and
 * stop rather than carry on and report a number it did not measure.
 *
 * This is what check-digest should have called. Spawning a path that does not
 * exist raises an unhandled `error` event on the ChildProcess, which surfaces as
 * a bare `throw er` from node:events with no indication of which gate failed or
 * why — and it happens *after* the gate has already decided it is running.
 */
export function requireChrome(what = 'this check') {
  const chrome = findChrome();
  if (!chrome) {
    console.error(
      `No Chrome or Edge found. ${what} cannot run without one.\n` +
        'On Linux CI, install Chrome and set CHROME_PATH; on any platform, point\n' +
        'CHROME_PATH at the binary directly.',
    );
    process.exit(1);
  }
  return chrome;
}
