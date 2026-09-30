import { t as __exportAll } from "./rolldown-runtime_8H4AJuhK.mjs";
import { M as users, n as readyDb, v as postVersions, y as posts } from "./db_NRbr6ekn.mjs";
import { E as parseBody, w as blockToPlainText } from "./posts_DKPEGog2.mjs";
import { and, eq } from "drizzle-orm";
//#region src/lib/repo/voice.ts
var voice_exports = /* @__PURE__ */ __exportAll({
	computeVoice: () => computeVoice,
	driftScore: () => driftScore,
	featuresOfBlocks: () => featuresOfBlocks,
	readVoice: () => readVoice,
	refreshVoice: () => refreshVoice
});
var WORD = /[a-z][a-z'-]{2,}/gi;
function featuresOf(texts, codeBlocks, totalBlocks) {
	const joined = texts.join("\n");
	const sentences = joined.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
	const words = joined.match(WORD)?.map((w) => w.toLowerCase()) ?? [];
	const distinct = new Set(words);
	const q = sentences.filter((s) => s.endsWith("?")).length;
	const e = sentences.filter((s) => s.endsWith("!")).length;
	const paras = texts.filter((t) => t.trim().length > 0);
	return {
		sentences: sentences.length,
		meanSentenceWords: sentences.length ? words.length / Math.max(1, sentences.length) : 0,
		typeTokenRatio: words.length ? distinct.size / words.length : 0,
		questionRate: sentences.length ? q / sentences.length : 0,
		exclaimRate: sentences.length ? e / sentences.length : 0,
		codeDensity: totalBlocks ? codeBlocks / totalBlocks : 0,
		meanParaWords: paras.length ? paras.reduce((n, p) => n + (p.match(WORD)?.length ?? 0), 0) / paras.length : 0
	};
}
function average(list) {
	const zero = {
		sentences: 0,
		meanSentenceWords: 0,
		typeTokenRatio: 0,
		questionRate: 0,
		exclaimRate: 0,
		codeDensity: 0,
		meanParaWords: 0
	};
	if (list.length === 0) return zero;
	const sum = list.reduce((a, f) => ({
		sentences: a.sentences + f.sentences,
		meanSentenceWords: a.meanSentenceWords + f.meanSentenceWords,
		typeTokenRatio: a.typeTokenRatio + f.typeTokenRatio,
		questionRate: a.questionRate + f.questionRate,
		exclaimRate: a.exclaimRate + f.exclaimRate,
		codeDensity: a.codeDensity + f.codeDensity,
		meanParaWords: a.meanParaWords + f.meanParaWords
	}), { ...zero });
	const n = list.length;
	return {
		sentences: Math.round(sum.sentences / n),
		meanSentenceWords: sum.meanSentenceWords / n,
		typeTokenRatio: sum.typeTokenRatio / n,
		questionRate: sum.questionRate / n,
		exclaimRate: sum.exclaimRate / n,
		codeDensity: sum.codeDensity / n,
		meanParaWords: sum.meanParaWords / n
	};
}
async function computeVoice(authorId) {
	const own = await (await readyDb()).select({
		slug: posts.slug,
		body: postVersions.body
	}).from(posts).innerJoin(postVersions, eq(posts.currentVersionId, postVersions.id)).where(and(eq(posts.authorId, authorId), eq(posts.visibility, "public")));
	if (own.length === 0) return null;
	return {
		features: average(own.map((p) => {
			const blocks = parseBody(p.body);
			const texts = blocks.filter((b) => [
				"paragraph",
				"quote",
				"tldr",
				"callout",
				"list"
			].includes(b.type)).map((b) => blockToPlainText(b));
			const code = blocks.filter((b) => b.type === "code").length;
			return featuresOf(texts, code, blocks.length);
		})),
		postCount: own.length,
		slugs: own.map((p) => p.slug),
		updatedAt: Date.now()
	};
}
async function refreshVoice(authorId) {
	const profile = await computeVoice(authorId);
	if (!profile) return null;
	await (await readyDb()).update(users).set({ toneVector: JSON.stringify(profile) }).where(eq(users.id, authorId));
	return profile;
}
function readVoice(raw) {
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw);
		if (!parsed.features || typeof parsed.postCount !== "number") return null;
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
function driftScore(profile, post) {
	const f = profile.features;
	const moved = [];
	const dist = (a, b, scale, name) => {
		const d = Math.min(1, Math.abs(a - b) / scale);
		if (d > .4) moved.push(name);
		return d;
	};
	const parts = [
		dist(post.meanSentenceWords, f.meanSentenceWords, 12, "sentence length"),
		dist(post.typeTokenRatio, f.typeTokenRatio, .25, "vocabulary range"),
		dist(post.questionRate, f.questionRate, .15, "asking"),
		dist(post.codeDensity, f.codeDensity, .5, "code density"),
		dist(post.meanParaWords, f.meanParaWords, 60, "paragraph length")
	];
	return {
		score: parts.reduce((a, b) => a + b, 0) / parts.length,
		moved
	};
}
/** Features of one post's blocks — the unit the drift check compares. */
function featuresOfBlocks(blocks) {
	return featuresOf(blocks.filter((b) => [
		"paragraph",
		"quote",
		"tldr",
		"callout",
		"list"
	].includes(b.type)).map((b) => blockToPlainText(b)), blocks.filter((b) => b.type === "code").length, blocks.length);
}
//#endregion
export { voice_exports as i, featuresOfBlocks as n, readVoice as r, driftScore as t };
