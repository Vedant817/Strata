import { t as __exportAll } from "./rolldown-runtime_8H4AJuhK.mjs";
import { d as renderTemplate, f as maybeRenderHead, i as renderComponent, m as addAttribute, w as createAstro } from "./server_DKu4icSC.mjs";
import { t as createComponent } from "./compiler_DeGWR9rg.mjs";
import { u as resolvePrefs } from "./prefs_CLygXapP.mjs";
import { t as $$Base } from "./Base_BucALmBf.mjs";
import { S as readReceipts, n as readyDb, s as annotations, v as postVersions, y as posts } from "./db_NRbr6ekn.mjs";
import { t as getIdentity } from "./auth_BCgGryh8.mjs";
import { and, eq, isNotNull } from "drizzle-orm";
//#region src/lib/repo/thesis.ts
var DAY = 864e5;
async function getThesisMetrics() {
	const database = await readyDb();
	const postRows = await database.select({
		id: posts.id,
		publishedAt: posts.publishedAt
	}).from(posts).where(and(eq(posts.visibility, "public"), isNotNull(posts.publishedAt)));
	const versionRows = await database.select({
		postId: postVersions.postId,
		versionNumber: postVersions.versionNumber,
		createdAt: postVersions.createdAt
	}).from(postVersions);
	const versionsByPost = /* @__PURE__ */ new Map();
	for (const v of versionRows) {
		const list = versionsByPost.get(v.postId) ?? [];
		list.push({
			n: v.versionNumber,
			createdAt: v.createdAt
		});
		versionsByPost.set(v.postId, list);
	}
	let revised = 0;
	for (const p of postRows) {
		if (!p.publishedAt) continue;
		if ((versionsByPost.get(p.id) ?? []).some((v) => v.n > 1 && v.createdAt <= p.publishedAt + 60 * DAY)) revised++;
	}
	const readRows = await database.select({
		postId: readReceipts.postId,
		anonId: readReceipts.anonId,
		userId: readReceipts.userId,
		readAt: readReceipts.readAt
	}).from(readReceipts);
	const publishedAt = new Map(postRows.map((p) => [p.id, p.publishedAt ?? 0]));
	const reads = readRows.length;
	const late = readRows.filter((r) => r.readAt >= (publishedAt.get(r.postId) ?? 0) + 365 * DAY).length;
	const noteRows = await database.select({ id: annotations.id }).from(annotations).where(and(eq(annotations.status, "visible"), eq(annotations.isPrivate, false)));
	const byReader = /* @__PURE__ */ new Map();
	for (const r of readRows) {
		const key = r.userId ?? r.anonId ?? "unknown";
		const slot = byReader.get(key) ?? {
			first: r.readAt,
			last: r.readAt
		};
		slot.first = Math.min(slot.first, r.readAt);
		slot.last = Math.max(slot.last, r.readAt);
		byReader.set(key, slot);
	}
	const readers = byReader.size;
	const returning = [...byReader.values()].filter((s) => s.last - s.first >= 30 * DAY).length;
	return {
		posts: postRows.length,
		reads,
		halfLifeShare: reads === 0 ? 0 : late / reads,
		halfLifeReads: late,
		revisedShare: postRows.length === 0 ? 0 : revised / postRows.length,
		revised,
		annotationsPerHundred: reads === 0 ? 0 : noteRows.length / reads * 100,
		annotationCount: noteRows.length,
		returnShare: readers === 0 ? 0 : returning / readers,
		returningReaders: returning,
		readers,
		enoughData: reads >= 20
	};
}
/** The four kill criteria with their live verdicts. `null` means unjudgeable. */
function judgeThesis(m) {
	if (!m.enoughData) return [
		{
			criterion: "Post half-life beats a conventional blog",
			target: "Meaningful share of reads at 12+ months",
			value: `${m.reads} reads so far — too few to judge`,
			verdict: "unknown"
		},
		{
			criterion: "30% of posts revised within 60 days",
			target: "≥ 30%",
			value: `${m.reads} reads so far — too few to judge`,
			verdict: "unknown"
		},
		{
			criterion: "Marginalia loop forming",
			target: "≥ 1 annotation per 200 reads",
			value: `${m.reads} reads so far — too few to judge`,
			verdict: "unknown"
		},
		{
			criterion: "Memory compounding",
			target: "≥ 20% 30-day return",
			value: `${m.reads} reads so far — too few to judge`,
			verdict: "unknown"
		}
	];
	return [
		{
			criterion: "Post half-life beats a conventional blog",
			target: "Meaningful share of reads at 12+ months",
			value: `${(m.halfLifeShare * 100).toFixed(1)}% of reads (${m.halfLifeReads}/${m.reads})`,
			verdict: m.halfLifeShare > .05 ? "passing" : "failing"
		},
		{
			criterion: "30% of posts revised within 60 days",
			target: "≥ 30%",
			value: `${(m.revisedShare * 100).toFixed(1)}% (${m.revised}/${m.posts} posts)`,
			verdict: m.revisedShare >= .3 ? "passing" : "failing"
		},
		{
			criterion: "Marginalia loop forming",
			target: "≥ 1 annotation per 200 reads",
			value: `${m.annotationsPerHundred.toFixed(2)} per 100 reads (${m.annotationCount} notes)`,
			verdict: m.annotationsPerHundred >= .5 ? "passing" : "failing"
		},
		{
			criterion: "Memory compounding",
			target: "≥ 20% 30-day return",
			value: `${(m.returnShare * 100).toFixed(1)}% (${m.returningReaders}/${m.readers} readers)`,
			verdict: m.returnShare >= .2 ? "passing" : "failing"
		}
	];
}
//#endregion
//#region src/pages/thesis.astro
var thesis_exports = /* @__PURE__ */ __exportAll({
	default: () => $$Thesis,
	file: () => $$file,
	url: () => $$url
});
createAstro("http://localhost:4321");
var $$Thesis = createComponent(async ($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$Thesis;
	const anonId = Astro.cookies.get("strata_anon")?.value ?? crypto.randomUUID();
	const prefs = resolvePrefs(Astro.cookies, anonId);
	getIdentity(Astro.cookies);
	const metrics = await getThesisMetrics();
	const verdicts = judgeThesis(metrics);
	const VERDICT_STYLE = {
		passing: "border-pine text-pine",
		failing: "border-danger text-danger",
		unknown: "border-rule-strong text-ink-3"
	};
	const VERDICT_LABEL = {
		passing: "holding",
		failing: "failing",
		unknown: "too early"
	};
	return renderTemplate`${renderComponent($$result, "Base", $$Base, {
		"title": "Is this working?",
		"description": "The four kill criteria for Strata, with live numbers. A post is a durable surface; these numbers test whether it behaves like one.",
		"prefs": prefs
	}, { "default": ($$result) => renderTemplate`${maybeRenderHead($$result)}<header class="shell border-b border-rule py-12"><div class="max-w-2xl"><p class="meta">The thesis test</p><h1 class="mt-3 text-3xl">Is this working?</h1><p class="mt-4 text-[1.0625rem] leading-relaxed text-ink-2">The prediction is falsifiable: a post published a year ago should still be receiving a meaningful share of its reads. If it is not, the correct response is to stop and rebuild — not to add features. These are the four criteria, with today's numbers beside them.</p><p class="meta mt-4">${metrics.posts} posts · ${metrics.reads} reads · ${metrics.readers} readers ·${" "}${metrics.annotationCount} notes</p></div></header><div class="shell py-12"><div class="max-w-2xl"><ol class="space-y-6">${verdicts.map((v, i) => renderTemplate`<li${addAttribute(`border border-rule p-4`, "class")}><div class="flex flex-wrap items-baseline justify-between gap-2"><p class="meta">Criterion ${i + 1}</p><p${addAttribute(`meta border px-2 py-0.5 ${VERDICT_STYLE[v.verdict]}`, "class")}>${VERDICT_LABEL[v.verdict]}</p></div><h2 class="mt-2 text-xl">${v.criterion}</h2><p class="mt-1 text-[0.9375rem] text-ink-2">Target: ${v.target}.</p><p class="mt-1 font-mono text-[0.9375rem] tabular-nums">${v.value}</p></li>`)}</ol>${!metrics.enoughData && renderTemplate`<p class="mt-8 border-l-2 border-rule-strong pl-4 text-[0.9375rem] leading-relaxed text-ink-2">Every criterion reads “too early” because rates built on fewer than twenty reads are noise. That threshold is the same cohort rule the writer analytics obey: never judge a pattern you cannot see clearly.</p>`}<p class="mt-8 border-t border-rule pt-6 text-[0.9375rem] text-ink-2">Reads here mean <em>read receipts</em> — one per reader per post per version — not block impressions, which would flatter every rate by an order of magnitude. If criterion 1 or 2 fails at month 6, the plan says to stop. It is written here so the decision is not made by sunk cost.</p></div></div>` })}`;
}, "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/pages/thesis.astro", void 0);
var $$file = "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/pages/thesis.astro";
var $$url = "/thesis";
//#endregion
//#region \0virtual:astro:page:src/pages/thesis@_@astro
var page = () => thesis_exports;
//#endregion
export { page };
