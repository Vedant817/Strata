import { feedFor } from '../../../lib/feed';
import { listAll, listTopics } from '../../../lib/repo/taxonomy';

type Ctx = { params: { slug: string }; site?: URL; url: URL };

/**
 * One topic's feed. Topics are the publication's second axis of sense-making,
 * so they need their own subscribe target — otherwise a reader who cares about
 * distributed systems has to subscribe to everything to hear about one thread.
 */
export async function GET({ params, site, url }: Ctx) {
  const slug = (params.slug ?? '').toLowerCase();
  const topics = await listTopics();
  const topic = topics.find((t) => t.slug.toLowerCase() === slug);

  /* Same rule as the author feed: unknown is a 404 so it is not cached as a live
     subscription, but a real topic with nothing filed under it yet is an empty
     200 — readers subscribe to a thread before it starts. */
  if (!topic) return new Response('Unknown topic', { status: 404 });

  const posts = (await listAll()).filter((p) => p.topicSlug === topic.slug);

  return feedFor({
    title: `${topic.name} on Strata`,
    description: `Posts filed under ${topic.name}.`,
    html: `/topics#${topic.slug}`,
    site: site ?? url.origin,
    posts,
  });
}
