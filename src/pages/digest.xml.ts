import rss from '@astrojs/rss';
import { buildDigest } from '../lib/repo/digest';

/**
 * Weekly constellation digest as RSS — PLAN.md §10.6.
 *
 * The email job already exists. This is the same three-to-ten items, same
 * honest reasons, for readers who will not give us an inbox. An empty week
 * is an empty feed, never a "you have 0 new posts" item.
 */
export async function GET(context: { site?: URL; url?: URL }) {
  const digest = await buildDigest(Date.now() - 7 * 86_400_000);
  const site = context.site ?? context.url?.origin ?? 'http://localhost:4321';
  return rss({
    title: 'Strata weekly digest',
    description:
      'What moved this week: new posts and revisions, each with an honest reason. Opt-in. No "you have 0 new posts."',
    site,
    trailingSlash: false,
    customData: '<language>en</language>',
    items: digest.items.map((item) => ({
      title: item.title,
      description: `${item.detail}${item.dek ? ` ${item.dek}` : ''}`,
      link: `/w/${item.slug}`,
      pubDate: new Date(item.at),
      author: item.authorName,
    })),
  });
}
