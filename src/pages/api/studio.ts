import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getIdentity } from '../../lib/repo/auth';
import { addCapture, promoteCapture, setCaptureState, type CaptureState } from '../../lib/repo/studio';
import { addLink, getPostById, getPostBySlug, markReviewed } from '../../lib/repo/posts';
import { safeReturnTo } from '../../lib/note-actions';

/**
 * Studio mutations. Same shape as the note endpoint: ordinary form posts,
 * one validated schema, redirect back with the reason on failure. Studio is
 * for claimed writers — an anonymous browser has no inbox to capture into,
 * so without an account the honest response is to send them to claim one.
 */

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('capture'),
    body: z.string().trim().min(1, 'A capture needs some text.').max(4000),
    source: z.enum(['share', 'voice', 'screenshot', 'scratchpad', 'clip']).default('scratchpad'),
    returnTo: z.string().optional(),
  }),
  z.object({
    action: z.literal('state'),
    id: z.string().min(1),
    to: z.enum(['inbox', 'seed', 'draft', 'discarded']),
    returnTo: z.string().optional(),
  }),
  z.object({
    action: z.literal('promote'),
    id: z.string().min(1),
    returnTo: z.string().optional(),
  }),
  z.object({
    action: z.literal('reviewed'),
    postId: z.string().min(1),
    status: z.enum(['seedling', 'budding', 'evergreen']).optional(),
    returnTo: z.string().optional(),
  }),
  z.object({
    action: z.literal('link'),
    fromPostId: z.string().min(1),
    toSlug: z.string().min(1).max(120),
    type: z.enum(['cites', 'extends', 'contradicts', 'mentions']),
    returnTo: z.string().optional(),
  }),
  z.object({
    action: z.literal('grow'),
    ids: z.string().min(1).max(2000),
    returnTo: z.string().optional(),
  }),
  z.object({
    action: z.literal('voice'),
    returnTo: z.string().optional(),
  }),
  z.object({
    action: z.literal('save-draft'),
    postId: z.string().min(1),
    count: z.coerce.number().int().min(0).max(500),
    returnTo: z.string().optional(),
  }),
  z.object({
    action: z.literal('add-block'),
    postId: z.string().min(1),
    blockType: z.enum(['paragraph', 'heading', 'quote', 'code', 'list', 'callout']),
    returnTo: z.string().optional(),
  }),
  z.object({
    action: z.literal('publish'),
    postId: z.string().min(1),
    changeSummary: z
      .string()
      .trim()
      .min(10, 'Say what changed, in at least a sentence. Future readers — and you — will thank you.')
      .max(500),
    isMajor: z.string().optional(),
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

  const input = parsed.data;
  if (input.action === 'capture') {
    const result = await addCapture(identity.userId, input.body, input.source);
    if (!result.ok) {
      target.searchParams.set('studioError', result.error);
      return redirect(target.pathname + target.search, 303);
    }
    return redirect(back, 303);
  }

  if (input.action === 'state') {
    const ok = await setCaptureState(input.id, identity.userId, input.to as CaptureState);
    if (!ok) target.searchParams.set('studioError', 'That capture is not yours.');
    return redirect(ok ? back : target.pathname + target.search, 303);
  }

  if (input.action === 'promote') {
    const promoted = await promoteCapture(input.id, identity.userId);
    if (!promoted.ok) {
      target.searchParams.set('studioError', promoted.error);
      return redirect(target.pathname + target.search, 303);
    }
    const post = await getPostById(promoted.postId);
    return redirect(post ? `/w/${post.slug}` : back, 303);
  }

  if (input.action === 'reviewed') {
    const ok = await markReviewed(input.postId, identity.userId, input.status);
    if (!ok) target.searchParams.set('studioError', 'That post is not yours.');
    return redirect(ok ? back : target.pathname + target.search, 303);
  }

  if (input.action === 'grow') {
    const { growGroup } = await import('../../lib/repo/studio');
    const grown = await growGroup(
      identity.userId,
      input.ids.split(',').map((s) => s.trim()).filter(Boolean),
    );
    if (!grown.ok) {
      target.searchParams.set('studioError', grown.error);
      return redirect(target.pathname + target.search, 303);
    }
    const post = await getPostById(grown.postId);
    return redirect(post ? `/w/${post.slug}` : back, 303);
  }

  if (input.action === 'voice') {
    const { refreshVoice } = await import('../../lib/repo/voice');
    const profile = await refreshVoice(identity.userId);
    if (!profile) target.searchParams.set('studioError', 'Nothing published to learn a voice from yet.');
    return redirect(profile ? back : target.pathname + target.search, 303);
  }

  if (input.action === 'save-draft' || input.action === 'add-block' || input.action === 'publish') {
    const { applyEditorAction } = await import('../../lib/repo/drafts');
    const fields: Record<string, string> = {};
    if (form) {
      for (const [k, v] of form.entries()) {
        if (typeof v === 'string') fields[k] = v;
      }
    }
    const result = await applyEditorAction(input, fields, identity.userId);
    if (!result.ok) {
      target.searchParams.set('studioError', result.error);
      return redirect(target.pathname + target.search, 303);
    }
    if (result.redirectTo) return redirect(result.redirectTo, 303);
    const done = new URL(back, url);
    done.searchParams.set('saved', '1');
    return redirect(done.pathname + done.search, 303);
  }

  // Link this post to another by slug. Resolved server-side so a mistyped
  // slug fails here with the reason, not as a dead edge in the graph.
  const target_post = await getPostBySlug(input.toSlug.trim().toLowerCase());
  if (!target_post) {
    target.searchParams.set('studioError', `No post at /w/${input.toSlug.trim().toLowerCase()}.`);
    return redirect(target.pathname + target.search, 303);
  }
  const own = await getPostById(input.fromPostId);
  if (!own || own.authorId !== identity.userId) {
    target.searchParams.set('studioError', 'That post is not yours.');
    return redirect(target.pathname + target.search, 303);
  }
  if (target_post.id === input.fromPostId) {
    target.searchParams.set('studioError', 'A post cannot link to itself.');
    return redirect(target.pathname + target.search, 303);
  }
  await addLink(input.fromPostId, target_post.id, input.type);
  return redirect(back, 303);
};

export const GET: APIRoute = () => Response.redirect('/studio', 303);
