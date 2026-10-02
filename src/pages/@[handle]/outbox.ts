import type { APIRoute } from 'astro';
import { buildOutbox } from '../../lib/activitypub';

/** Published posts as Create activities. Newest first, capped at 20. */
export const GET: APIRoute = async ({ params, url, request }) =>
  buildOutbox({ url, request, handle: params.handle ?? '' });