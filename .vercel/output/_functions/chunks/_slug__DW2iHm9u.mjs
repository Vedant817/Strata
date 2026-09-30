import { t as __exportAll } from "./rolldown-runtime_8H4AJuhK.mjs";
import { a as Fragment, d as renderTemplate, f as maybeRenderHead, i as renderComponent, m as addAttribute, w as createAstro } from "./server_DKu4icSC.mjs";
import { t as createComponent } from "./compiler_DeGWR9rg.mjs";
import { u as resolvePrefs } from "./prefs_CLygXapP.mjs";
import { t as $$Base } from "./Base_BucALmBf.mjs";
import { r as plural } from "./format_D0bVmvvo.mjs";
import { t as $$StatusBadge } from "./StatusBadge_wg3zFwEI.mjs";
import { l as asks, n as readyDb, s as annotations, u as blocks, x as readEvents, y as posts } from "./db_NRbr6ekn.mjs";
import { t as getIdentity } from "./auth_BCgGryh8.mjs";
import { E as parseBody, w as blockToPlainText } from "./posts_DKPEGog2.mjs";
import { t as getHighlights } from "./highlights_CaFzTkyg.mjs";
import { i as myPostHealth } from "./studio_B88tlfqA.mjs";
import { and, desc, eq, sql } from "drizzle-orm";
async function getEmpathyReport(postId) {
	const database = await readyDb();
	const [post] = await database.select({
		id: posts.id,
		slug: posts.slug,
		title: posts.title,
		authorId: posts.authorId
	}).from(posts).where(eq(posts.id, postId)).limit(1);
	if (!post) return null;
	const [version] = await database.select({ body: sql`pv.body` }).from(sql`post_versions pv`).where(sql`pv.id = (select current_version_id from posts where id = ${postId})`).limit(1);
	const doc = version ? parseBody(version.body) : [];
	const blockRows = await database.select({
		blockId: blocks.blockId,
		ordinal: blocks.ordinal
	}).from(blocks).where(and(eq(blocks.postId, postId), sql`${blocks.versionId} = (select current_version_id from posts where id = ${postId})`)).orderBy(blocks.ordinal);
	const reachRows = await database.select({
		blockId: readEvents.blockId,
		readers: sql`count(distinct ${readEvents.anonId})`
	}).from(readEvents).where(and(eq(readEvents.postId, postId), eq(readEvents.event, "reached"), sql`${readEvents.blockId} is not null`)).groupBy(readEvents.blockId);
	const reachByBlock = new Map(reachRows.map((r) => [r.blockId, Number(r.readers)]));
	const rows = blockRows.map((b) => ({
		blockId: b.blockId,
		ordinal: b.ordinal,
		reached: reachByBlock.get(b.blockId) ?? 0
	}));
	const [cohortRow] = await database.select({ n: sql`count(distinct ${readEvents.anonId})` }).from(readEvents).where(eq(readEvents.postId, postId));
	const [impressionRow] = await database.select({ n: sql`count(*)` }).from(readEvents).where(and(eq(readEvents.postId, postId), eq(readEvents.event, "impression")));
	const cohort = Number(cohortRow?.n ?? 0);
	const suppressed = cohort < 20;
	const byId = new Map(doc.map((b) => [b.id, b]));
	const peak = Math.max(1, ...rows.map((r) => Number(r.reached)));
	const blockReach = rows.map((r) => {
		const block = byId.get(r.blockId);
		const text = block ? blockToPlainText(block) : "";
		return {
			blockId: r.blockId,
			ordinal: r.ordinal,
			headingPath: "",
			type: block?.type ?? "paragraph",
			preview: text.replace(/\s+/g, " ").trim().slice(0, 120),
			reached: Number(r.reached),
			relative: Number(r.reached) / peak
		};
	});
	const PROSE = /* @__PURE__ */ new Set([
		"paragraph",
		"quote",
		"tldr",
		"list",
		"callout",
		"primer",
		"heading"
	]);
	let dropOff = null;
	for (let i = 1; i < blockReach.length; i++) {
		const prev = blockReach[i - 1];
		const cur = blockReach[i];
		if (prev.reached <= 0) continue;
		if (!PROSE.has(prev.type)) continue;
		const fall = (prev.reached - cur.reached) / prev.reached;
		if (fall >= .25 && prev.reached >= 3) {
			dropOff = {
				blockId: prev.blockId,
				preview: prev.preview,
				share: fall
			};
			break;
		}
	}
	const hotspots = [];
	const confusion = [];
	if (!suppressed) {
		const hl = await getHighlights(postId, 5);
		for (const h of hl) {
			const block = byId.get(h.blockId);
			hotspots.push({
				blockId: h.blockId,
				text: h.text || (block ? blockToPlainText(block) : "").replace(/\s+/g, " ").trim().slice(0, 180),
				readers: h.readers
			});
		}
		const openAsks = await database.select({
			question: asks.question,
			count: sql`count(*)`
		}).from(asks).where(and(eq(asks.postId, postId), eq(asks.answer, ""))).groupBy(asks.question).orderBy(desc(sql`count(*)`)).limit(5);
		for (const a of openAsks) confusion.push({
			blockId: "",
			kind: "unanswered_ask",
			count: Number(a.count),
			question: a.question
		});
		const noteKinds = await database.select({
			kind: annotations.kind,
			count: sql`count(*)`
		}).from(annotations).where(and(eq(annotations.postId, postId), eq(annotations.status, "visible"))).groupBy(annotations.kind);
		for (const k of noteKinds) if (k.kind === "disagreement" || k.kind === "correction") confusion.push({
			blockId: "",
			kind: k.kind === "disagreement" ? "disagreement" : "correction",
			count: Number(k.count)
		});
		confusion.sort((a, b) => b.count - a.count);
	}
	return {
		postId,
		slug: post.slug,
		title: post.title,
		cohort,
		impressions: Number(impressionRow?.n ?? 0),
		suppressed,
		blocks: suppressed ? [] : blockReach,
		hotspots,
		confusion: confusion.slice(0, 10),
		dropOff
	};
}
//#endregion
//#region src/pages/studio/readers/[slug].astro
var _slug__exports = /* @__PURE__ */ __exportAll({
	default: () => $$Slug,
	file: () => $$file,
	url: () => $$url
});
createAstro("http://localhost:4321");
var $$Slug = createComponent(async ($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$Slug;
	const anonId = Astro.cookies.get("strata_anon")?.value ?? crypto.randomUUID();
	const prefs = resolvePrefs(Astro.cookies, anonId);
	const identity = await getIdentity(Astro.cookies);
	const slug = Astro.params.slug ?? "";
	const mine = (identity.userId ? await myPostHealth(identity.userId) : []).find((p) => p.slug === slug);
	const report = mine ? await getEmpathyReport(mine.id) : null;
	if (mine && !report) return new Response(null, {
		status: 404,
		statusText: "Not found"
	});
	return renderTemplate`${renderComponent($$result, "Base", $$Base, {
		"title": mine ? `Readers · ${mine.title}` : "Readers",
		"description": "Where readers reached, what they highlighted, and where thinking broke — in aggregate, never per reader.",
		"prefs": prefs,
		"noindex": true
	}, { "default": ($$result) => renderTemplate`${maybeRenderHead($$result)}<header class="shell border-b border-rule py-12"><div class="max-w-2xl"><p class="meta">Reader comprehension</p>${mine ? renderTemplate`${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`<h1 class="mt-3 text-3xl">${mine.title}</h1><p class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">${renderComponent($$result, "StatusBadge", $$StatusBadge, { "status": mine.status })}<span class="meta">${plural(report.cohort, "reader")} · ${plural(report.impressions, "open")}</span></p>` })}` : renderTemplate`<h1 class="mt-3 text-3xl">Reader comprehension</h1>`}</div></header><div class="shell py-12"><div class="max-w-2xl space-y-14">${!mine && renderTemplate`<p class="text-[1.0625rem] leading-relaxed text-ink-2">These are your posts' reader signals. Open one from${" "}<a href="/studio" class="text-ink no-underline hover:text-accent">Studio →</a></p>`}${mine && report.suppressed && renderTemplate`<div><p class="text-[1.0625rem] leading-relaxed text-ink">Not enough readers yet to say anything honest.</p><p class="mt-3 text-[0.9375rem] leading-relaxed text-ink-2">${report.cohort} ${report.cohort === 1 ? "reader has" : "readers have"} read this; patterns below ${20} readers are noise, and a curve drawn from noise is worse than no curve. ${20 - report.cohort} more would show reach.</p><p class="mt-4 border-l-2 border-rule-strong pl-3 text-[0.9375rem] text-ink-3">This is the same rule the privacy promise uses: a cohort of readers is never analysed individually, and never reported on when it is too small to mean anything.</p></div>`}${mine && !report.suppressed && renderTemplate`${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${report.dropOff && renderTemplate`<section aria-labelledby="dropoff-heading"><h2 id="dropoff-heading" class="text-xl">Am I losing them here?</h2><p class="mt-2 text-[0.9375rem] leading-relaxed text-ink-2">The largest single fall in the reach curve. Readers reached this paragraph, then most of them stopped:</p><blockquote class="mt-3 border-l-2 border-accent pl-3 text-[0.9375rem] leading-relaxed text-ink-2">${report.dropOff.preview || "(a block with no text)"}</blockquote><p class="meta mt-2">${Math.round(report.dropOff.share * 100)}% of the readers who reached it did not read the next paragraph</p></section>`}<section aria-labelledby="curve-heading"><h2 id="curve-heading" class="text-xl">Where readers reach</h2><p class="mt-2 text-[0.9375rem] leading-relaxed text-ink-2">Aggregate reach per block, scaled to the most-reached block. This is not a scroll heatmap and there is no per-reader view to browse.</p><ul class="mt-5 space-y-1.5">${report.blocks.map((b) => renderTemplate`<li class="flex items-center gap-3"><span class="w-16 shrink-0 font-mono text-[0.75rem] tabular-nums text-ink-3">${b.reached}</span><span class="h-3 min-w-0 flex-1 bg-sunken"><span class="block h-3 bg-accent"${addAttribute(`width: ${Math.max(1, Math.round(b.relative * 100))}%`, "style")}></span></span><span class="min-w-0 flex-1 truncate text-[0.75rem] text-ink-3">${b.preview}</span></li>`)}</ul></section>${report.hotspots.length > 0 && renderTemplate`<section aria-labelledby="hotspots-heading"><h2 id="hotspots-heading" class="text-xl">What got highlighted</h2><ol class="mt-4 space-y-3">${report.hotspots.map((h) => renderTemplate`<li class="border-b border-rule pb-3 last:border-b-0"><p class="meta">${plural(h.readers, "reader")}</p><p class="mt-1 text-[0.9375rem] leading-relaxed text-ink-2">${h.text}</p></li>`)}</ol></section>`}${report.confusion.length > 0 && renderTemplate`<section aria-labelledby="confusion-heading"><h2 id="confusion-heading" class="text-xl">Where thinking broke</h2><p class="mt-2 text-[0.9375rem] leading-relaxed text-ink-2">Questions this post could not answer, and where readers argued with each other or with you. These are the to-do list.</p><ul class="mt-4 space-y-3">${report.confusion.map((c, i) => renderTemplate`<li class="border-l-2 border-ochre pl-3">${c.kind === "unanswered_ask" && c.question ? renderTemplate`${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`<p class="text-[0.9375rem] leading-relaxed text-ink">“${c.question}”</p><p class="meta mt-1">asked ${c.count === 1 ? "once" : `${c.count} times`} · not covered in this post</p>` })}` : renderTemplate`<p class="text-[0.9375rem] text-ink-2">${c.kind === "disagreement" ? "Readers disagreed" : "Readers offered corrections"}${" "}— ${plural(c.count, "note")} in the margin</p>`}${i < report.confusion.length - 1 && renderTemplate`<span class="sr-only">,</span>`}</li>`)}</ul></section>`}<p class="border-t border-rule pt-6 text-[0.9375rem] text-ink-2"><a href="/studio" class="text-ink no-underline hover:text-accent">Back to Studio →</a></p>` })}`}</div></div>` })}`;
}, "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/pages/studio/readers/[slug].astro", void 0);
var $$file = "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/pages/studio/readers/[slug].astro";
var $$url = "/studio/readers/[slug]";
//#endregion
//#region \0virtual:astro:page:src/pages/studio/readers/[slug]@_@astro
var page = () => _slug__exports;
//#endregion
export { page };
