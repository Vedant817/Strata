/**
 * The reach beacon.
 *
 * Records which blocks a reader actually got to, in batches. This is the only
 * reader-instrumented signal the product collects, and it exists because the
 * alternative writers ask for is a scroll heatmap: creepy, usually wrong about
 * what the problem is, and it points at the wrong fix. "Which paragraph do
 * people stop at" is a better question and it is cheaper to answer honestly.
 *
 * Constraints, enforced here rather than in a policy document:
 *   - block ids only. No coordinates, no dwell times, no timing profile.
 *   - one row per block per page view, client-side deduped.
 *   - batched and sent on a timer or pagehide, never on scroll.
 *   - first-party, no third party, and the reader can erase it in one click.
 */
export default function installReachBeacon(
  host: HTMLElement,
  endpoint: string,
  flushMs = 5000,
) {
  if (typeof IntersectionObserver === 'undefined') return () => {};

  const blocks = Array.from(host.querySelectorAll<HTMLElement>('[data-block-id]'));
  if (blocks.length === 0) return () => {};

  const postId = host.getAttribute('data-post-id') || '';
  const seen = new Set<string>();
  const pending = new Set<string>();
  let timer: number | undefined;

  const flush = (useBeacon: boolean) => {
    if (pending.size === 0) return;
    const payload = JSON.stringify({ postId, blockIds: [...pending] });
    pending.clear();
    if (useBeacon && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(endpoint, new Blob([payload], { type: 'application/json' }));
    } else {
      void fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    }
  };

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const id = (entry.target as HTMLElement).getAttribute('data-block-id');
        if (!id || seen.has(id)) continue;
        seen.add(id);
        pending.add(id);
      }
      if (pending.size >= 12) flush(false);
    },
    // A block counts as reached once a meaningful slice of it is on screen,
    // which is not the same as "the top pixel crossed the viewport".
    { rootMargin: '0px 0px -35% 0px', threshold: 0.01 },
  );

  for (const block of blocks) observer.observe(block);

  timer = window.setInterval(() => flush(false), flushMs);
  const onHide = () => flush(true);
  window.addEventListener('pagehide', onHide);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(true);
  });

  return () => {
    observer.disconnect();
    if (timer) window.clearInterval(timer);
    window.removeEventListener('pagehide', onHide);
  };
}
