import type { APIRoute } from 'astro';
import { getPostBySlug } from '../../lib/repo/posts';
import { retrievePassages } from '../../lib/repo/ask';
import { citationCard } from '../../lib/citation-card';
import { renderShareCard } from '../../lib/og';

/**
 * The citation share card: an Ask answer as a research object.
 *
 * The image is quotes from this post, retrieved without logging the question
 * and without calling a model. A crawler that unfurls `?ask=` must not appear
 * in the writer's confusion list, and must not spend the author's budget.
 */
export const GET: APIRoute = async ({ params, url }) => {
  const slug = params.slug;
  const question = (url.searchParams.get('q') ?? '').trim().slice(0, 500);
  if (!slug || question.length < 3) {
    return new Response(null, { status: 404, statusText: 'Not found' });
  }

  const post = await getPostBySlug(slug);
  if (!post) return new Response(null, { status: 404, statusText: 'Not found' });

  const passages = await retrievePassages(post.id, question);
  const card = citationCard({
    question,
    postTitle: post.title,
    authorName: post.authorName,
    passages,
  });

  const png = await renderShareCard({
    title: card.question,
    dek: card.dek,
    kicker: card.kicker,
    kickerColor: card.matched ? '#a63a24' : '#837d72',
    changes: card.quotes.map((q) => ({ kind: 'changed' as const, text: q.text })),
    footerLeft: card.footerLeft,
    footerRight: card.footerRight,
    // Citation cards hold the question on the frame and cap each quote to one
    // line; the default layout's three-line quotes push the title off the card.
    layout: 'citation',
  });

  return new Response(png as BodyInit, {
    headers: {
      'content-type': 'image/png',
      // Tied to the current revision's FTS index; a day-long cache would quote
      // a passage the writer had already rewritten.
      'cache-control': 'public, max-age=3600',
    },
  });
};
