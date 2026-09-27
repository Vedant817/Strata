import type { APIRoute } from 'astro';
import { getRevisionView } from '../../lib/repo/posts';
import { renderShareCard } from '../../lib/og';
import { stripInline } from '../../lib/inline';
import { plural } from '../../lib/format';

/**
 * The diff share card: §10.6's "primary viral asset".
 *
 * A title card could belong to any blog. A card that says what changed in this
 * post since revision 2 is this publication's whole thesis, rendered at 1200
 * pixels. It is honest rather than clever — the counts come from a real
 * comparison against the previous version, so a card can never claim a change
 * that is not in the history.
 *
 * `?rev=N` shares that specific revision's comparison, which is how a writer
 * posts the fix they just made.
 */
export const GET: APIRoute = async ({ params, url }) => {
  const { slug } = params;
  if (!slug) return new Response(null, { status: 404, statusText: 'Not found' });

  const { listAll } = await import('../../lib/repo/taxonomy');
  const match = (await listAll()).find((p) => p.slug === slug);
  if (!match) return new Response(null, { status: 404, statusText: 'Not found' });

  const requested = Number(url.searchParams.get('rev') ?? '');
  const target = Number.isFinite(requested) && requested > 0 ? requested : undefined;
  const view = await getRevisionView(match.id, target);
  if (!view) return new Response(null, { status: 404, statusText: 'Not found' });

  const changed = view.diff.filter((d) => d.status !== 'unchanged');
  const isHead = !target;

  /* The actual change, not a count. A card saying "2 changes" is a statistic;
     a card quoting the sentence that moved is the argument. Truncated to one
     line per block, because a card is not a changelog.
     Inline markup is stripped with the same renderer the site uses, so a
     `*documented error budget*` does not reach a social card as asterisks. */
  const preview = changed
    .flatMap((d) =>
      d.segments
        .filter((s) => s.type !== 'same' && s.text.trim().length > 12)
        .map((s) => ({
          kind: (s.type === 'ins' ? 'added' : s.type === 'del' ? 'removed' : 'changed') as
            | 'added'
            | 'removed'
            | 'changed',
          text: stripInline(s.text).replace(/\s+/g, ' ').trim().slice(0, 170),
        })),
    )
    .slice(0, 3);

  const png = await renderShareCard({
    title: match.title,
    kicker: changed.length > 0 ? `${plural(changed.length, 'change')} in v${view.current.versionNumber}` : `v${view.current.versionNumber}`,
    kickerColor: changed.length > 0 ? '#a63a24' : '#837d72',
    changes: preview,
    footerLeft: changed.length > 0 ? `diffed against v${view.compared?.versionNumber ?? 1}` : 'no changes yet',
    footerRight: 'strata.pub',
  });

  return new Response(png as BodyInit, {
    headers: {
      'content-type': 'image/png',
      // Diff cards are tied to a version, so they must not outlive it in a
      // cache: a stale card would quote a count the history no longer supports.
      'cache-control': isHead ? 'public, max-age=3600' : 'public, max-age=86400, immutable',
    },
  });
};
