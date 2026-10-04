import type { APIRoute } from 'astro';
import { getPostBySlug } from '../../lib/repo/posts';
import { renderShareCard } from '../../lib/og';

/**
 * The share image for a post. Carries the revision count because the record
 * of revision is the credibility signal — a card that only shows the title
 * could belong to any blog. Cached for a day; a new revision is worth a new
 * card, but not a new card on every read.
 */
export const GET: APIRoute = async ({ params }) => {
  const post = params.slug ? await getPostBySlug(params.slug) : null;
  if (!post) return new Response(null, { status: 404, statusText: 'Not found' });

  /* A share card is an enhancement. It is fetched by someone else's crawler, in
     the background, on a reader's behalf — so a renderer failure must not become
     a 500 in a server log and a broken image in a timeline. Two fallbacks, in
     order of how much is still true: the same card without the dek, then a card
     with no post content at all. The last one is content-independent, so if even
     that throws the failure is in the renderer rather than in this post, and
     there is nothing truthful left to return but a 500. */
  const attempt = async (dek?: string) =>
    renderShareCard({
      title: post.title,
      dek,
      kicker: post.status,
      kickerColor: '#a63a24',
      footerLeft: `by ${post.authorName} · revised ${post.versionCount}×`,
      footerRight: 'strata.pub',
    });

  let png: Uint8Array;
  try {
    png = await attempt(post.dek || undefined);
  } catch (err) {
    console.error('[strata] share card failed, retrying without the dek', err);
    try {
      png = await attempt(undefined);
    } catch (err2) {
      console.error('[strata] share card failed again, falling back to a bare card', err2);
      try {
        png = await renderShareCard({
          title: 'Strata',
          kicker: 'writing',
          kickerColor: '#a63a24',
          footerLeft: 'posts that carry their revision history',
          footerRight: 'strata.pub',
        });
      } catch {
        return new Response(null, { status: 500, statusText: 'Card renderer unavailable' });
      }
    }
  }

  return new Response(png as BodyInit, {
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=86400',
    },
  });
};
