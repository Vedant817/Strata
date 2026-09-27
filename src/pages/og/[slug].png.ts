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

  const png = await renderShareCard({
    title: post.title,
    dek: post.dek || undefined,
    kicker: post.status,
    kickerColor: '#a63a24',
    footerLeft: `by ${post.authorName} · revised ${post.versionCount}×`,
    footerRight: 'strata.pub',
  });

  return new Response(png as BodyInit, {
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=86400',
    },
  });
};
