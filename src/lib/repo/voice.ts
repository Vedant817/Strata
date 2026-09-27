import { and, eq } from 'drizzle-orm';
import { readyDb } from '../db';
import { posts, postVersions, users } from '../db/schema';
import { blockToPlainText, parseBody, type Block } from '../blocks';

/**
 * Voice fingerprint, §7 Co-Thinking v1.
 *
 * Not stylometry and not a model — a handful of lexical statistics computed
 * over an author's published posts: how long their sentences run, how varied
 * their vocabulary is, how often they ask, how often they show code. The point
 * is drift detection with a straight face: "your last post reads nothing like
 * your other five" is useful whether the cause is growth, a deadline, or a
 * ghostwriter, and a number that cannot explain itself would be worse than
 * none, so every feature is named in plain words on the page.
 *
 * Stored as JSON in `users.tone_vector`. That column predates this module;
 * this is what it was for.
 */

export interface VoiceFeatures {
  sentences: number;
  meanSentenceWords: number;
  typeTokenRatio: number;
  questionRate: number;
  exclaimRate: number;
  codeDensity: number;
  meanParaWords: number;
}

export interface VoiceProfile {
  features: VoiceFeatures;
  postCount: number;
  slugs: string[];
  updatedAt: number;
}

const WORD = /[a-z][a-z'-]{2,}/gi;

function featuresOf(texts: string[], codeBlocks: number, totalBlocks: number): VoiceFeatures {
  const joined = texts.join('\n');
  const sentences = joined.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const words = joined.match(WORD)?.map((w) => w.toLowerCase()) ?? [];
  const distinct = new Set(words);
  const q = sentences.filter((s) => s.endsWith('?')).length;
  const e = sentences.filter((s) => s.endsWith('!')).length;
  const paras = texts.filter((t) => t.trim().length > 0);
  return {
    sentences: sentences.length,
    meanSentenceWords: sentences.length ? words.length / Math.max(1, sentences.length) : 0,
    typeTokenRatio: words.length ? distinct.size / words.length : 0,
    questionRate: sentences.length ? q / sentences.length : 0,
    exclaimRate: sentences.length ? e / sentences.length : 0,
    codeDensity: totalBlocks ? codeBlocks / totalBlocks : 0,
    meanParaWords: paras.length
      ? paras.reduce((n, p) => n + (p.match(WORD)?.length ?? 0), 0) / paras.length
      : 0,
  };
}

function average(list: VoiceFeatures[]): VoiceFeatures {
  const zero: VoiceFeatures = {
    sentences: 0, meanSentenceWords: 0, typeTokenRatio: 0, questionRate: 0,
    exclaimRate: 0, codeDensity: 0, meanParaWords: 0,
  };
  if (list.length === 0) return zero;
  const sum = list.reduce(
    (a, f) => ({
      sentences: a.sentences + f.sentences,
      meanSentenceWords: a.meanSentenceWords + f.meanSentenceWords,
      typeTokenRatio: a.typeTokenRatio + f.typeTokenRatio,
      questionRate: a.questionRate + f.questionRate,
      exclaimRate: a.exclaimRate + f.exclaimRate,
      codeDensity: a.codeDensity + f.codeDensity,
      meanParaWords: a.meanParaWords + f.meanParaWords,
    }),
    { ...zero },
  );
  const n = list.length;
  return {
    sentences: Math.round(sum.sentences / n),
    meanSentenceWords: sum.meanSentenceWords / n,
    typeTokenRatio: sum.typeTokenRatio / n,
    questionRate: sum.questionRate / n,
    exclaimRate: sum.exclaimRate / n,
    codeDensity: sum.codeDensity / n,
    meanParaWords: sum.meanParaWords / n,
  };
}

export async function computeVoice(authorId: string): Promise<VoiceProfile | null> {
  const database = await readyDb();
  const own = await database
    .select({ slug: posts.slug, body: postVersions.body })
    .from(posts)
    .innerJoin(postVersions, eq(posts.currentVersionId, postVersions.id))
    .where(and(eq(posts.authorId, authorId), eq(posts.visibility, 'public')));
  if (own.length === 0) return null;

  const per = own.map((p) => {
    const blocks = parseBody(p.body);
    const texts = blocks
      .filter((b) => ['paragraph', 'quote', 'tldr', 'callout', 'list'].includes(b.type))
      .map((b) => blockToPlainText(b));
    const code = blocks.filter((b) => b.type === 'code').length;
    return featuresOf(texts, code, blocks.length);
  });
  return {
    features: average(per),
    postCount: own.length,
    slugs: own.map((p) => p.slug),
    updatedAt: Date.now(),
  };
}

export async function refreshVoice(authorId: string): Promise<VoiceProfile | null> {
  const profile = await computeVoice(authorId);
  if (!profile) return null;
  const database = await readyDb();
  await database.update(users).set({ toneVector: JSON.stringify(profile) }).where(eq(users.id, authorId));
  return profile;
}

export function readVoice(raw: string | null): VoiceProfile | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as VoiceProfile;
    if (!parsed.features || typeof parsed.postCount !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * How far one post sits from the author's fingerprint, 0–1.
 *
 * Normalized per-feature distances, averaged. Below ~0.15 the post reads like
 * its author; above ~0.35 something changed and the page says which features
 * moved, because a single number without names is a horoscope. With fewer
 * than two posts in the fingerprint there is no baseline and the answer is
 * honestly "cannot tell yet".
 */
export function driftScore(profile: VoiceProfile, post: VoiceFeatures): { score: number; moved: string[] } {
  const f = profile.features;
  const moved: string[] = [];
  const dist = (a: number, b: number, scale: number, name: string) => {
    const d = Math.min(1, Math.abs(a - b) / scale);
    if (d > 0.4) moved.push(name);
    return d;
  };
  const parts = [
    dist(post.meanSentenceWords, f.meanSentenceWords, 12, 'sentence length'),
    dist(post.typeTokenRatio, f.typeTokenRatio, 0.25, 'vocabulary range'),
    dist(post.questionRate, f.questionRate, 0.15, 'asking'),
    dist(post.codeDensity, f.codeDensity, 0.5, 'code density'),
    dist(post.meanParaWords, f.meanParaWords, 60, 'paragraph length'),
  ];
  return { score: parts.reduce((a, b) => a + b, 0) / parts.length, moved };
}

/** Features of one post's blocks — the unit the drift check compares. */
export function featuresOfBlocks(blocks: Block[]): VoiceFeatures {
  const texts = blocks
    .filter((b) => ['paragraph', 'quote', 'tldr', 'callout', 'list'].includes(b.type))
    .map((b) => blockToPlainText(b));
  return featuresOf(
    texts,
    blocks.filter((b) => b.type === 'code').length,
    blocks.length,
  );
}
