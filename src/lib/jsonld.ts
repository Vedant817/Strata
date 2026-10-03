/**
 * JSON-LD is emitted into a `<script type="application/ld+json">` with
 * `set:html`, so Astro does not escape it — and `JSON.stringify` does not
 * escape `<` either.
 *
 * That combination is an injection point, not a theoretical one. The article
 * page puts a reader-controlled URL parameter into the graph:
 * `/w/the-p99-is-a-lie?ask=</script><script>alert(1)</script>` produced two
 * script tags where the JSON-LD block should have been inert data, which runs
 * the reader's payload on every page that emits a graph. Verified before this
 * was written, by counting the `<script` occurrences in the rendered string.
 *
 * `\u003c` is the escape JSON already defines for `<` and is byte-identical once
 * parsed, so the structured data is unchanged and the tag can no longer be
 * closed. `<` is the only character that matters: `>` cannot end a script and
 * `/` only matters in the `</script>` sequence, which begins with `<`.
 */
export function safeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}