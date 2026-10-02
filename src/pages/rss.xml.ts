import { feedFor } from '../lib/feed';
import { listAll } from '../lib/repo/taxonomy';

export async function GET(context: { site?: URL; url?: URL }) {
  return feedFor({
    title: 'Strata',
    description:
      'A publication for long-form that outlives its own publication date. Posts carry their revision history.',
    html: '/',
    site: context.site ?? context.url?.origin ?? 'http://localhost:4321',
    posts: await listAll(),
  });
}
