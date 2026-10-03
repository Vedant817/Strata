/**
 * After the first read: three posts that fit what the reader just did.
 *
 * PLAN.md §10.4 — "one short, one long, one that shows a living diff."
 * Depth and interest are inferred from behaviour (what was already read),
 * never a form. The picker is deterministic so the same memory produces the
 * same three until the canon or the receipts change.
 */

export interface RecommendCandidate {
  id: string;
  slug: string;
  title: string;
  dek: string;
  readingMinutes: number;
  versionCount: number;
}

export type RecommendKind = 'short' | 'long' | 'living';

export interface Recommendation {
  slug: string;
  title: string;
  dek: string;
  kind: RecommendKind;
  reason: string;
  readingMinutes: number;
}

const REASONS: Record<RecommendKind, string> = {
  short: 'Short — a few minutes, after what you just read.',
  long: 'Longer — more of the argument, when you have the time.',
  living: 'Living — revised since it shipped, so the diff is the point.',
};

export function pickThree(candidates: RecommendCandidate[]): Recommendation[] {
  const pool = [...candidates];
  const out: Recommendation[] = [];
  const used = new Set<string>();

  const take = (kind: RecommendKind, pick: RecommendCandidate | undefined) => {
    if (!pick || used.has(pick.id)) return;
    used.add(pick.id);
    out.push({
      slug: pick.slug,
      title: pick.title,
      dek: pick.dek,
      kind,
      reason: REASONS[kind],
      readingMinutes: pick.readingMinutes,
    });
  };

  const remaining = () => pool.filter((c) => !used.has(c.id));

  const byMinutes = remaining().slice().sort((a, b) => a.readingMinutes - b.readingMinutes);
  take('short', byMinutes[0]);

  const living = remaining()
    .filter((c) => c.versionCount >= 2)
    .sort((a, b) => b.versionCount - a.versionCount || b.readingMinutes - a.readingMinutes);
  take('living', living[0]);

  const longest = remaining().slice().sort((a, b) => b.readingMinutes - a.readingMinutes);
  take('long', longest[0]);

  // Fewer than three published unread posts: fill with whatever is left,
  // still labelled honestly. Never invent a "living" post that has one version.
  for (const leftover of remaining()) {
    if (out.length >= 3) break;
    const kind: RecommendKind = leftover.versionCount >= 2 ? 'living' : leftover.readingMinutes <= (byMinutes[0]?.readingMinutes ?? 1) ? 'short' : 'long';
    if (out.some((p) => p.kind === kind)) continue;
    take(kind, leftover);
  }

  return out.slice(0, 3);
}
