import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getIdentity } from '../../lib/repo/auth';
import {
  addListItem,
  createReadingList,
  removeListItem,
  revokeListShareToken,
  rotateListShareToken,
  setListVisibility,
} from '../../lib/repo/taxonomy';
import { safeReturnTo } from '../../lib/note-actions';
import { addCollaborator, removeCollaborator } from '../../lib/repo/collaborators';

/**
 * Reading-list management. Same contract as every other mutation here:
 * ordinary form posts, one validated schema, redirect back with the reason
 * on failure. Every action re-checks ownership server-side — a list id in a
 * form proves nothing, and a private list must stay private against forged
 * requests, not just hidden links.
 */
const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    title: z.string().trim().min(3).max(120),
    description: z.string().trim().max(500).default(''),
    isPublic: z.enum(['public', 'private']).default('public'),
    returnTo: z.string().optional(),
  }),
  z.object({
    action: z.literal('visibility'),
    listId: z.string().min(1),
    isPublic: z.enum(['public', 'private']),
    returnTo: z.string().optional(),
  }),
  z.object({
    action: z.literal('share'),
    listId: z.string().min(1),
    returnTo: z.string().optional(),
  }),
  z.object({
    action: z.literal('revoke'),
    listId: z.string().min(1),
    returnTo: z.string().optional(),
  }),
  z.object({
    action: z.literal('add'),
    listId: z.string().min(1),
    postId: z.string().min(1),
    note: z.string().trim().max(300).default(''),
    returnTo: z.string().optional(),
  }),
  z.object({
    action: z.literal('remove'),
    listId: z.string().min(1),
    postSlug: z.string().min(1).max(120),
    returnTo: z.string().optional(),
  }),
  z.object({
    action: z.literal('add-collaborator'),
    listId: z.string().min(1),
    handle: z.string().trim().min(1).max(60),
    role: z.enum(['editor', 'viewer']).default('viewer'),
    returnTo: z.string().optional(),
  }),
  z.object({
    action: z.literal('remove-collaborator'),
    listId: z.string().min(1),
    handle: z.string().trim().min(1).max(60),
    returnTo: z.string().optional(),
  }),
]);

export const POST: APIRoute = async ({ request, cookies, redirect, url }) => {
  const identity = await getIdentity(cookies);
  if (!identity.userId) return redirect('/write#handle', 303);

  const form = await request.formData().catch(() => null);
  const back = safeReturnTo(form?.get('returnTo'), '/studio');
  const target = new URL(back, url);
  target.searchParams.delete('studioError');

  const parsed = schema.safeParse(form ? Object.fromEntries(form) : null);
  if (!parsed.success) {
    target.searchParams.set('studioError', parsed.error.issues[0]?.message ?? 'That did not look right.');
    return redirect(target.pathname + target.search, 303);
  }

  const fail = (message: string) => {
    target.searchParams.set('studioError', message);
    return redirect(target.pathname + target.search, 303);
  };

  const input = parsed.data;
  switch (input.action) {
    case 'create': {
      const result = await createReadingList(
        identity.userId,
        input.title,
        input.description,
        input.isPublic === 'public',
      );
      if (!result.ok) return fail(result.error);
      return redirect(back, 303);
    }
    case 'visibility': {
      const ok = await setListVisibility(input.listId, identity.userId, input.isPublic === 'public');
      if (!ok) return fail('That list is not yours.');
      return redirect(back, 303);
    }
    case 'share': {
      const token = await rotateListShareToken(input.listId, identity.userId);
      if (!token) return fail('That list is not yours.');
      const link = new URL(back, url);
      link.searchParams.set('shared', input.listId);
      return redirect(link.pathname + link.search, 303);
    }
    case 'revoke': {
      const ok = await revokeListShareToken(input.listId, identity.userId);
      if (!ok) return fail('That list is not yours.');
      return redirect(back, 303);
    }
    case 'add': {
      const result = await addListItem(input.listId, identity.userId, input.postId, input.note);
      if (!result.ok) return fail(result.error);
      return redirect(back, 303);
    }
    case 'remove': {
      const ok = await removeListItem(input.listId, identity.userId, input.postSlug);
      if (!ok) return fail('You cannot edit that list.');
      return redirect(back, 303);
    }
    case 'add-collaborator': {
      const result = await addCollaborator(input.listId, identity.userId, input.handle, input.role);
      if (!result.ok) return fail(result.error);
      return redirect(back, 303);
    }
    case 'remove-collaborator': {
      const ok = await removeCollaborator(input.listId, identity.userId, input.handle);
      if (!ok) return fail('That list is not yours, or that is not a collaborator on it.');
      return redirect(back, 303);
    }
  }
};

export const GET: APIRoute = ({ redirect }) => redirect('/lists', 303);
