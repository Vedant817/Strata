/**
 * Ask answers as citation cards — PLAN.md §10.6.
 *
 * The share unit is the question plus the quotes that answered it, never the
 * model prose and never a reader id. A card that quoted a generated summary
 * would be spreading something that can go stale independently of the post;
 * the quotes are the post, so they stay true as long as the revision does.
 */

import { stripInline } from './inline';

export interface CitationPassage {
  blockId: string;
  quote: string;
}

export interface CitationCard {
  question: string;
  matched: boolean;
  kicker: string;
  dek?: string;
  quotes: Array<{ blockId: string; text: string }>;
  footerLeft: string;
  footerRight: string;
}

/** FTS snippets wrap hits in <mark>; social cards are plain text. */
export function stripAskMarkup(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    // Entities first. Decoding before stripping tags would let `&lt;mark&gt;`
    // become a tag on the next pass, and this function runs twice over the same
    // string in some paths.
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#0*39;|&#x0*27;/gi, "'")
    .replace(/&#0*60;/g, '<')
    .replace(/&#0*62;/g, '>')
    .replace(/<[^>]*>/g, '')
    // `&amp;` last, deliberately. Decoding it earlier re-introduces the literal
    // text `&amp;` after the entity pass has already run, so `A &amp; B` came out
    // as `A &amp; B` — the one assertion this file had before the injection work
    // caught it.
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cleanAskQuestion(raw: string): string {
  return stripInline(stripAskMarkup(raw)).trim().slice(0, 500);
}

/**
 * Link-preview fetchers that hit the HTML of `?ask=` must not be billed as
 * a reader asking the question. They have no cookie, so each unfurl would
 * otherwise spend a quota slot, call a model, and land in the writer's
 * confusion list.
 */
export function isUnfurlCrawler(ua: string | null | undefined): boolean {
  if (!ua) return false;
  return /twitterbot|facebookexternalhit|facebot|slackbot|linkedinbot|discordbot|whatsapp|telegrambot|skypeuripreview|iframely|embedly|pinterest|googlebot|bingbot|applebot|redditbot|quora link preview|bitlybot|opengraph|vkshare|slack-imgproxy/i.test(
    ua,
  );
}

export function citationCard(input: {
  question: string;
  postTitle: string;
  authorName: string;
  passages: CitationPassage[];
}): CitationCard {
  const question = cleanAskQuestion(input.question);
  const quotes = input.passages
    .map((p) => ({
      blockId: p.blockId,
      text: stripInline(stripAskMarkup(p.quote)).slice(0, 170),
    }))
    .filter((q) => q.text.length > 0)
    .slice(0, 2);

  const matched = quotes.length > 0;
  return {
    question,
    matched,
    kicker: matched ? 'Cited from this article' : 'Asked of this article',
    dek: matched ? input.postTitle : "This isn't covered in the article.",
    quotes,
    footerLeft: `by ${input.authorName}`,
    footerRight: 'strata.pub',
  };
}

/** A citation is a matched answer. A refusal is not a research object. */
export function citationIsShareable(input: { matched: boolean; error?: string | null }): boolean {
  return input.matched && !input.error;
}

export function citationShareText(quotes: Array<{ quote: string }>): string {
  return stripInline(stripAskMarkup(quotes.map((p) => p.quote).join(' '))).slice(0, 240);
}

export function citationSharePath(slug: string, question: string): string {
  const params = new URLSearchParams({ ask: cleanAskQuestion(question) });
  return `/w/${slug}?${params.toString()}#ask`;
}

export function citationOgPath(slug: string, question: string): string {
  const params = new URLSearchParams({ q: cleanAskQuestion(question) });
  return `/og/${slug}-ask.png?${params.toString()}`;
}
