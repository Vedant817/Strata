import rss from '@astrojs/rss';
import type { RSSFeedItem } from '@astrojs/rss';
import { stripInline } from './inline';
import type { listAll } from './repo/taxonomy';

/**
 * One feed body, three scopes.
 *
 * The full feed, a per-author feed and a per-topic feed are the same document
 * with a different set of items. Writing that three times means the revision
 * count — the whole thesis, and the one element a static feed cannot express —
 * could silently drop out of two of them later. So the item mapping lives here
 * and every route borrows it.
 */

type Post = Awaited<ReturnType<typeof listAll>>[number];

export interface FeedScope {
  title: string;
  description: string;
  /** Route that renders as HTML, used for Atom's self-advertised alternate. */
  html: string;
  /** Absolute or root-relative origin the feed's own links are built from. */
  site: URL | string;
  posts: Post[];
}

export function feedFor(scope: FeedScope) {
  return rss({
    title: scope.title,
    description: scope.description,
    site: scope.site,
    trailingSlash: false,
    customData: '<language>en</language>',
    xmlns: { strata: 'https://strata.pub/ns' },
    items: scope.posts.map(feedItem),
  });
}

function feedItem(post: Post): RSSFeedItem {
  return {
    title: post.title,
    description: post.dek || stripInline(post.title),
    pubDate: new Date(post.publishedAt ?? post.createdAt ?? Date.now()),
    link: `/w/${post.slug}`,
    categories: post.topicName ? [post.topicName] : undefined,
    author: post.authorName,
    /* Not decoration. A reader subscribed to a single author needs to know
       which of their pieces were revised after the fact, without opening each
       one to compare. */
    customData: `<strata:revision>${post.versionCount}</strata:revision>`,
  };
}
