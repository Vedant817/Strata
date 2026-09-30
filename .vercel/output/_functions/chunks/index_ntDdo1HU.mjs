import { t as __exportAll } from "./rolldown-runtime_8H4AJuhK.mjs";
import { d as renderTemplate, f as maybeRenderHead, i as renderComponent, m as addAttribute, w as createAstro } from "./server_DKu4icSC.mjs";
import { t as createComponent } from "./compiler_DeGWR9rg.mjs";
import { u as resolvePrefs } from "./prefs_CLygXapP.mjs";
import { t as $$Base } from "./Base_BucALmBf.mjs";
import { r as plural } from "./format_D0bVmvvo.mjs";
import { t as $$PostRow } from "./PostRow_B0WJeZNZ.mjs";
import { c as getStatusCounts, f as listTopics, l as listAll, s as getReadingList } from "./taxonomy_CiJ526xn.mjs";
//#region src/pages/index.astro
var pages_exports = /* @__PURE__ */ __exportAll({
	default: () => $$Index,
	file: () => $$file,
	url: () => ""
});
createAstro("http://localhost:4321");
var $$Index = createComponent(async ($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$Index;
	const anonId = Astro.cookies.get("strata_anon")?.value ?? crypto.randomUUID();
	const prefs = resolvePrefs(Astro.cookies, anonId);
	const all = await listAll();
	const curated = await getReadingList("start-here");
	const counts = await getStatusCounts();
	const topicList = (await listTopics()).filter((t) => t.total > 0);
	const recentlyRevised = all.filter((p) => p.versionCount > 1).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).slice(0, 3);
	const evergreen = all.filter((p) => p.status === "evergreen").slice(0, 2);
	return renderTemplate`${renderComponent($$result, "Base", $$Base, {
		"title": "Strata",
		"description": "A publication for long-form that outlives its own publication date. Posts carry their revision history, you set the depth you read at, and you can argue in the margin.",
		"prefs": prefs
	}, { "default": ($$result) => renderTemplate`${maybeRenderHead($$result)}<section class="shell border-b border-rule py-16 md:py-24"><div class="max-w-2xl"><p class="meta">A publication about things that change</p><h1 class="mt-4 text-4xl">The blog format never changed. The web did.</h1><div class="mt-6 space-y-4 text-[1.0625rem] leading-relaxed text-ink-2"><p>A post is still a file: written once, dated, abandoned. But the software it describes kept moving, and so did its author’s understanding of it. So a 2019 post is quietly wrong now, and the format offers no way to fix it in place.</p><p>Strata treats a post as a <strong class="font-medium text-ink">living, layered document</strong>. It carries a visible revision history. It renders at the depth you choose. And it accepts notes pinned to a specific sentence <em>and</em> to the specific revision that sentence belonged to — so an argument with a post survives the post being rewritten.</p><p class="text-ink">No likes, no follower counts, no trending, no algorithmic feed. If we cannot explain why something surfaced, it does not surface.</p></div></div></section>${curated && renderTemplate`<section class="shell py-14" aria-labelledby="curated-heading"><div class="flex flex-wrap items-baseline justify-between gap-4 border-b border-rule pb-4"><h2 id="curated-heading" class="text-xl">${curated.title}</h2><a href="/lists" class="meta no-underline transition-colors hover:text-ink">All reading lists →</a></div><p class="mt-3 max-w-xl text-[0.9375rem] leading-relaxed text-ink-2">${curated.description}</p><div class="mt-6">${curated.items.map((item, i) => renderTemplate`${renderComponent($$result, "PostRow", $$PostRow, {
		"slug": item.post.slug,
		"title": item.post.title,
		"dek": item.post.dek,
		"status": item.post.status,
		"publishedAt": item.post.publishedAt,
		"readingMinutes": item.post.readingMinutes,
		"authorName": item.post.authorName,
		"note": item.note,
		"ordinal": i + 1
	})}`)}</div></section>`}${recentlyRevised.length > 0 && renderTemplate`<section class="shell py-14" aria-labelledby="living-heading"><div class="flex flex-wrap items-baseline justify-between gap-4 border-b border-rule pb-4"><h2 id="living-heading" class="text-xl">Living now</h2><p class="meta">recently revised, not recently published</p></div><p class="mt-3 max-w-xl text-[0.9375rem] leading-relaxed text-ink-2">A chronological feed can only tell you what is new. This tells you what is${" "}<em>wrong</em> — and lets you see the exact edit.</p><div class="mt-6">${recentlyRevised.map((p) => renderTemplate`${renderComponent($$result, "PostRow", $$PostRow, {
		"slug": p.slug,
		"title": p.title,
		"dek": p.dek,
		"status": p.status,
		"publishedAt": p.publishedAt,
		"updatedAt": p.updatedAt,
		"readingMinutes": p.readingMinutes,
		"versionCount": p.versionCount,
		"annotationTotal": p.annotationTotal,
		"authorName": p.authorName
	})}`)}</div></section>`}${evergreen.length > 0 && renderTemplate`<section class="shell py-14" aria-labelledby="evergreen-heading"><div class="flex flex-wrap items-baseline justify-between gap-4 border-b border-rule pb-4"><h2 id="evergreen-heading" class="text-xl">Evergreen</h2><p class="meta">${counts.evergreen} maintained · ${counts.budding} forming · ${counts.seedling} growing</p></div><p class="mt-3 max-w-xl text-[0.9375rem] leading-relaxed text-ink-2">Posts here are not finished once. An evergreen is a surface somebody is answerable for, and the revision history is the evidence.</p><div class="mt-6">${evergreen.map((p) => renderTemplate`${renderComponent($$result, "PostRow", $$PostRow, {
		"slug": p.slug,
		"title": p.title,
		"dek": p.dek,
		"status": p.status,
		"publishedAt": p.publishedAt,
		"updatedAt": p.updatedAt,
		"readingMinutes": p.readingMinutes,
		"versionCount": p.versionCount,
		"annotationTotal": p.annotationTotal,
		"authorName": p.authorName
	})}`)}</div></section>`}<section class="shell py-14" aria-labelledby="topics-heading"><div class="border-b border-rule pb-4"><h2 id="topics-heading" class="text-xl">Topics</h2></div><ul class="mt-6 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">${topicList.map((t) => renderTemplate`<li><a${addAttribute(`/topics#${t.slug}`, "href")} class="group block no-underline"><p class="font-serif text-[1.0625rem] text-ink transition-colors group-hover:text-accent">${t.name}</p><p class="mt-1 text-[0.9375rem] leading-relaxed text-ink-2">${t.blurb}</p><p class="meta mt-1.5">${plural(t.total, "post")}</p></a></li>`)}</ul></section><section class="shell py-14"><div class="max-w-2xl border-t border-rule pt-8"><p class="text-[0.9375rem] leading-relaxed text-ink-2">We keep no third-party analytics scripts, no ad-tech cookies and no fingerprinting. Reading telemetry is first-party, aggregate-only, and is never shown to a writer for a group smaller than twenty readers.${" "}<a href="/privacy#forget" class="text-ink no-underline hover:text-accent">You can erase everything we know about you in one click →</a></p></div></section>` })}`;
}, "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/pages/index.astro", void 0);
var $$file = "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/pages/index.astro";
//#endregion
//#region \0virtual:astro:page:src/pages/index@_@astro
var page = () => pages_exports;
//#endregion
export { page };
