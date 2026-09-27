import type { APIRoute } from 'astro';
import { applyNoteAction, noteActionSchema, safeReturnTo } from '../../lib/note-actions';

/**
 * Note interactions arrive as ordinary form posts, so reacting, replying,
 * editing, deleting and accepting all work with JavaScript disabled. The
 * backend for every one of them already existed; this is what makes it
 * reachable.
 *
 * Failure is reported by redirecting back with the reason rather than by
 * rendering an error document, so the reader keeps their place in the margin
 * they were reading.
 *
 * This lives here rather than as a `POST` export on the article page because
 * Astro does not dispatch non-GET methods to `.astro` components in this
 * project — a `POST` there renders the page and never runs. That was verified
 * the expensive way: a probe log never fired across restarts, while this same
 * shape on a `.ts` endpoint 303-redirects correctly.
 */
export const POST: APIRoute = async ({ request, cookies, redirect, url }) => {
  const form = await request.formData().catch(() => null);
  const parsed = noteActionSchema.safeParse(form ? Object.fromEntries(form) : null);

  const fallback = typeof form?.get('returnTo') === 'string' ? '/' : '/';
  const back = safeReturnTo(form?.get('returnTo'), fallback);
  const target = new URL(back, url);
  target.searchParams.delete('noteError');
  target.searchParams.delete('note');

  if (!parsed.success) {
    const first = parsed.error.issues[0];
    target.searchParams.set('noteError', first?.message ?? 'That did not look right.');
    return redirect(target.pathname + target.search, 303);
  }

  const result = await applyNoteAction(parsed.data, cookies);
  if (!result.ok) {
    target.searchParams.set('noteError', result.message);
    const noteId = 'noteId' in parsed.data ? parsed.data.noteId : parsed.data.parentId;
    if (noteId) target.searchParams.set('note', noteId);
    return redirect(target.pathname + target.search, 303);
  }

  return redirect(back, 303);
};

export const GET: APIRoute = () => Response.redirect('/writing', 303);
