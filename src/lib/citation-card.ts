/**
 * Ask answers as citation cards — PLAN.md §10.6.
 *
 * The share unit is the question plus the quotes that answered it, never the
 * model prose and never a reader id. A card that quoted a generated summary
 * would be spreading something that can go stale independently of the post;
 * the quotes are the post, so they stay true as long as the revision does.
 */

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
    .replace(/<\/?mark>/gi, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function citationCard(input: {
  question: string;
  postTitle: string;
  authorName: string;
  passages: CitationPassage[];
}): CitationCard {
  const question = input.question.trim().slice(0, 500);
  const quotes = input.passages
    .map((p) => ({
      blockId: p.blockId,
      text: stripAskMarkup(p.quote).slice(0, 170),
    }))
    .filter((q) => q.text.length > 0)
    .slice(0, 3);

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

export function citationSharePath(slug: string, question: string): string {
  const params = new URLSearchParams({ ask: question.trim().slice(0, 500) });
  return `/w/${slug}?${params.toString()}#ask`;
}

export function citationOgPath(slug: string, question: string): string {
  const params = new URLSearchParams({ q: question.trim().slice(0, 500) });
  return `/og/${slug}-ask.png?${params.toString()}`;
}
