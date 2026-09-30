import { t as __exportAll } from "./rolldown-runtime_8H4AJuhK.mjs";
import { d as captureItems, l as asks, n as readyDb, s as annotations, v as postVersions, y as posts } from "./db_NRbr6ekn.mjs";
import { t as nanoid } from "./ids_TtqtpDCt.mjs";
import { r as createPost } from "./posts_DKPEGog2.mjs";
import { and, desc, eq, sql } from "drizzle-orm";
//#region src/lib/repo/studio.ts
var studio_exports = /* @__PURE__ */ __exportAll({
	addCapture: () => addCapture,
	getOpenAsks: () => getOpenAsks,
	growGroup: () => growGroup,
	listCaptures: () => listCaptures,
	myPostHealth: () => myPostHealth,
	promoteCapture: () => promoteCapture,
	setCaptureState: () => setCaptureState,
	synthesizeInbox: () => synthesizeInbox
});
/**
* Writer Studio, v1: the capture inbox, staleness, and empathy.
*
* The plan's observation is that writing apps optimize publishing and almost
* none solve *noticing*. So the loop starts before any editor: a fragment
* lands in the inbox in seconds, graduates to a seedling when it earns it,
* and the posts that need attention — stale, questioned, or losing readers
* at the same paragraph — say so in one place. The block editor, synthesis
* and voice profiling are later; a capture that rots in a table is worse
* than no capture at all, so the inbox ships with its full lifecycle first.
*/
async function listCaptures(authorId, state) {
	const database = await readyDb();
	const conditions = [eq(captureItems.authorId, authorId)];
	if (state) conditions.push(eq(captureItems.state, state));
	return database.select().from(captureItems).where(and(...conditions)).orderBy(desc(captureItems.capturedAt)).limit(100);
}
async function addCapture(authorId, body, source = "scratchpad") {
	const clean = body.trim().slice(0, 4e3);
	if (!clean) return {
		ok: false,
		error: "A capture needs some text."
	};
	const database = await readyDb();
	const id = nanoid();
	await database.insert(captureItems).values({
		id,
		authorId,
		body: clean,
		source
	});
	return {
		ok: true,
		id
	};
}
async function setCaptureState(id, authorId, state) {
	return (await (await readyDb()).update(captureItems).set({ state }).where(and(eq(captureItems.id, id), eq(captureItems.authorId, authorId))).returning({ id: captureItems.id })).length > 0;
}
/** A fragment earns a post: seedling, first paragraph pre-filled, linked back. */
async function promoteCapture(id, authorId) {
	const database = await readyDb();
	const [item] = await database.select().from(captureItems).where(and(eq(captureItems.id, id), eq(captureItems.authorId, authorId))).limit(1);
	if (!item || item.state === "discarded") return {
		ok: false,
		error: "That capture is gone."
	};
	if (item.promotedPostId) return {
		ok: true,
		postId: item.promotedPostId
	};
	const firstLine = item.body.split("\n")[0].trim().slice(0, 90) || "Untitled seedling";
	const slug = `${firstLine.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "seedling"}-${nanoid().slice(0, 6)}`;
	const created = await createPost({
		slug,
		title: firstLine,
		authorId,
		body: [{
			id: nanoid(),
			type: "paragraph",
			text: item.body,
			layer: "core"
		}],
		status: "seedling",
		changeSummary: `Grown from a captured fragment.`
	});
	await database.update(captureItems).set({
		state: "draft",
		promotedPostId: created.postId
	}).where(eq(captureItems.id, id));
	return {
		ok: true,
		postId: created.postId
	};
}
/** Every post this author owns, with the three signals that say "look at me":
*  unanswered reader questions, margin activity, and days since review. */
async function myPostHealth(authorId) {
	const database = await readyDb();
	const own = await database.select({
		id: posts.id,
		slug: posts.slug,
		title: posts.title,
		status: posts.status,
		lastReviewedAt: posts.lastReviewedAt
	}).from(posts).where(eq(posts.authorId, authorId)).orderBy(desc(posts.updatedAt));
	const out = [];
	for (const p of own) {
		const [versions] = await database.select({ n: sql`count(*)` }).from(postVersions).where(eq(postVersions.postId, p.id));
		const [noteRows] = await database.select({ n: sql`count(*)` }).from(annotations).where(and(eq(annotations.postId, p.id), eq(annotations.status, "visible")));
		const [askRows] = await database.select({ n: sql`count(*)` }).from(asks).where(and(eq(asks.postId, p.id), eq(asks.answer, "")));
		const staleDays = p.lastReviewedAt ? Math.floor((Date.now() - p.lastReviewedAt) / 864e5) : null;
		out.push({
			...p,
			versionCount: Number(versions?.n ?? 0),
			notes: Number(noteRows?.n ?? 0),
			openAsks: Number(askRows?.n ?? 0),
			staleDays
		});
	}
	return out.sort((a, b) => b.openAsks - a.openAsks || (b.staleDays ?? 0) - (a.staleDays ?? 0));
}
/** Questions readers asked that this post could not answer. */
async function getOpenAsks(postId, authorId) {
	const database = await readyDb();
	const [own] = await database.select({ id: posts.id }).from(posts).where(and(eq(posts.id, postId), eq(posts.authorId, authorId))).limit(1);
	if (!own) return [];
	return database.select({
		id: asks.id,
		question: asks.question,
		createdAt: asks.createdAt
	}).from(asks).where(and(eq(asks.postId, postId), eq(asks.answer, ""))).orderBy(desc(asks.createdAt)).limit(20);
}
var STOPWORDS = new Set("about above after again against all almost also always among another around because become before behind being below between both during every first from further had having here however into itself just like made make many might more most much never often only other ought our over same should since some such than that their them then there these through under until want were what when where which while with within without would your".split(" "));
function stem(word) {
	if (word.endsWith("ies") && word.length > 5) return `${word.slice(0, -3)}y`;
	if (word.endsWith("es") && word.length > 5 && !word.endsWith("sses")) return word.slice(0, -2);
	if (word.endsWith("s") && !word.endsWith("ss") && word.length > 4) return word.slice(0, -1);
	return word;
}
function significantWords(body) {
	const words = body.toLowerCase().match(/[a-z][a-z'-]{4,}/g) ?? [];
	return new Set(words.filter((w) => !STOPWORDS.has(w)).map(stem));
}
/**
* Weekly synthesis, runnable on demand rather than on a cron that does not
* exist here yet. Groups inbox fragments by shared significant vocabulary —
* two fragments using the same unusual words are usually two halves of one
* post trying to happen. Pairs sharing fewer than two words are left alone;
* forcing unrelated fragments together is how synthesis becomes slop.
*/
function synthesizeInbox(captures) {
	const sigils = captures.map((c) => ({
		id: c.id,
		body: c.body,
		words: significantWords(c.body)
	}));
	const used = /* @__PURE__ */ new Set();
	const groups = [];
	for (let i = 0; i < sigils.length; i++) {
		if (used.has(sigils[i].id)) continue;
		const group = [sigils[i]];
		used.add(sigils[i].id);
		for (let j = i + 1; j < sigils.length; j++) {
			if (used.has(sigils[j].id)) continue;
			if ([...new Set(group.flatMap((g) => [...g.words]))].filter((w) => sigils[j].words.has(w)).length >= 2) {
				group.push(sigils[j]);
				used.add(sigils[j].id);
			}
		}
		if (group.length >= 2) {
			const counts = /* @__PURE__ */ new Map();
			for (const g of group) for (const w of g.words) counts.set(w, (counts.get(w) ?? 0) + 1);
			const shared = [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([w]) => w);
			groups.push({
				ids: group.map((g) => g.id),
				bodies: group.map((g) => g.body),
				shared
			});
		}
	}
	return groups;
}
/** Grow a synthesized group into a seedling, linking every member to it. */
async function growGroup(authorId, ids) {
	const database = await readyDb();
	const clean = [...new Set(ids)].slice(0, 20);
	if (clean.length < 2) return {
		ok: false,
		error: "A group needs at least two fragments."
	};
	const rows = await database.select().from(captureItems).where(and(eq(captureItems.authorId, authorId), sql`id in (${sql.join(clean.map((c) => sql`${c}`), sql`, `)})`));
	if (rows.length < 2) return {
		ok: false,
		error: "Those captures are not yours."
	};
	const firstLine = rows[0].body.split("\n")[0].trim().slice(0, 90) || "Untitled seedling";
	const slugBase = firstLine.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "seedling";
	const created = await createPost({
		slug: `${slugBase}-${nanoid().slice(0, 6)}`,
		title: firstLine,
		authorId,
		body: rows.map((r) => ({
			id: nanoid(),
			type: "paragraph",
			text: r.body,
			layer: "core"
		})),
		status: "seedling",
		changeSummary: `Synthesized from ${rows.length} captured fragments.`
	});
	for (const r of rows) await database.update(captureItems).set({
		state: "draft",
		promotedPostId: created.postId
	}).where(eq(captureItems.id, r.id));
	return {
		ok: true,
		postId: created.postId
	};
}
//#endregion
export { promoteCapture as a, synthesizeInbox as c, myPostHealth as i, getOpenAsks as n, setCaptureState as o, listCaptures as r, studio_exports as s, addCapture as t };
