import type { APIRoute } from 'astro';
import { buildActor } from '../lib/activitypub';

/** The actor document. Served at /@handle with an activity+json content type. */
export const GET: APIRoute = async ({ params, url, request }) =>
  buildActor({ url, request, handle: params.handle ?? '' });