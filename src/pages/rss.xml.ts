import rss from '@astrojs/rss';
import { listAll } from '../lib/repo/taxonomy';
import { stripInline } from '../lib/inline';

/**
 * RSS, including the revision count as a namespaced element. A reader watching
 * for corrections is the whole thesis in feed form — the one thing a static
 * feed normally cannot express.
 */
export async function GET(context: { site?: URL }) {
  const posts = await listAll();

  return rss({
    title: 'Strata',
    description:
      'A publication for long-form that outlives its own publication date. Posts carry their revision history.',
    site: context.site ?? 'http://localhost:4321',
    trailingSlash: false,
    customData: '<language>en</language>',
    xmlns: { strata: 'https://strata.pub/ns' },
    items: posts.map((post) => ({
      title: post.title,
      description: post.dek || stripInline(post.title),
      pubDate: new Date(post.publishedAt ?? post.createdAt ?? Date.now()),
      link: `/w/${post.slug}`,
      categories: post.topicName ? [post.topicName] : undefined,
      author: post.authorName,
      customData: `<strata:revision>${post.versionCount}</strata:revision>`,
    })),
  });
}
