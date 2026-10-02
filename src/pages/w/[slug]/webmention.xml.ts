import rss from '@astrojs/rss';
import { feedFor } from '../../../lib/feed';
import { getPostBySlug } from '../../../lib/repo/posts';
import { listMentions } from '../../../lib/repo/webmentions';

/**
 * Endpoint discovery.
 *
 * This is the half people forget: a Webmention sender looks for
 * `<link rel="webmention">` on the target page, and without it every mention
 * silently never arrives. It also carries `rel="me"`, so a personal site can
 * claim this one and vice versa without a third party.
 *
 * `target` follows the spec, which requires the canonical article URL with any
 * fragment intact.
 */
type Ctx = { params: { slug: string }; site?: URL; url: URL };

export async function GET({ params, site, url }: Ctx) {
  const siteUrl = site ?? url.origin;
  const origin = new URL(siteUrl).origin;
  const target = `${origin}/w/${params.slug}`;

  const post = await getPostBySlug(params.slug);
  const mentions = post ? await listMentions(post.id) : [];

  return rss({
    title: post ? `Webmentions for ${post.title}` : 'Webmentions',
    description: 'Posts elsewhere on the web that link here.',
    site: siteUrl,
    trailingSlash: false,
    customData: '<language>en</language>',
    items: mentions.map((m) => ({
      title: m.sourceTitle || `A post on ${m.host}`,
      link: m.source,
      pubDate: new Date(m.createdAt),
      customData: `<strata:kind>${m.kind}</strata:kind><strata:verified>${
        m.verified ? 'true' : 'false'
      }</strata:verified><strata:webmention-target>${target}</strata:webmention-target>`,
    })),
  });
}

/** Count endpoint, so a sender can skip a post nobody links to. */
export async function HEAD({ params, site, url }: Ctx) {
  const post = await getPostBySlug(params.slug);
  const mentions = post ? await listMentions(post.id) : [];
  return new Response(null, {
    status: 200,
    headers: {
      'x-webmention-source-count': String(mentions.length),
      'x-webmention-receiver': `${new URL(site ?? url.origin).origin}/api/webmention`,
    },
  });
}
