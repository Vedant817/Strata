import type { APIRoute } from 'astro';
import { buildFollowers } from '../../lib/activitypub';

/**
 * Followers collection.
 *
 * Present and empty rather than absent: this build federates outbound only and
 * does not persist follows. See `src/lib/activitypub.ts` for why accepting one
 * and forgetting it would be worse than not accepting it.
 */
export const GET: APIRoute = async ({ params, url, request }) =>
  buildFollowers({ url, request, handle: params.handle ?? '' });