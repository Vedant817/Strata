import { feedFor } from '../../../lib/feed';
import { getAuthor, listAll } from '../../../lib/repo/taxonomy';

type Ctx = { params: { handle: string }; site?: URL; url: URL };

/**
 * One author's feed. A reader who follows a writer rather than the publication
 * wants their own column, and the only way to follow a column in a reader app
 * is to give it an endpoint.
 */
export async function GET({ params, site, url }: Ctx) {
  const handle = (params.handle ?? '').toLowerCase();
  const profile = handle ? await getAuthor(handle) : null;

  /* 404 for an author who does not exist, so a reader app caches a real failure
     instead of subscribing to an endpoint that will never fill. An author who
     exists but has not published yet correctly returns an empty feed — that is
     a live subscription, not a broken one. */
  if (!profile) return new Response('Unknown author', { status: 404 });

  const posts = (await listAll()).filter((p) => p.authorHandle.toLowerCase() === handle);
  const name = profile.displayName || profile.handle || handle;

  return feedFor({
    title: `${name} on Strata`,
    description: profile.bio || `Everything ${name} has published on Strata.`,
    html: `/a/${profile.handle}`,
    site: site ?? url.origin,
    posts,
  });
}
