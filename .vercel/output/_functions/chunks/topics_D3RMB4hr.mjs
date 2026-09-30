import { t as __exportAll } from "./rolldown-runtime_8H4AJuhK.mjs";
import { d as renderTemplate, f as maybeRenderHead, i as renderComponent, m as addAttribute, w as createAstro } from "./server_DKu4icSC.mjs";
import { t as createComponent } from "./compiler_DeGWR9rg.mjs";
import { u as resolvePrefs } from "./prefs_CLygXapP.mjs";
import { t as $$Base } from "./Base_BucALmBf.mjs";
import { r as plural } from "./format_D0bVmvvo.mjs";
import { t as $$PostRow } from "./PostRow_B0WJeZNZ.mjs";
import { f as listTopics, l as listAll } from "./taxonomy_CiJ526xn.mjs";
//#region src/pages/topics.astro
var topics_exports = /* @__PURE__ */ __exportAll({
	default: () => $$Topics,
	file: () => $$file,
	url: () => $$url
});
createAstro("http://localhost:4321");
var $$Topics = createComponent(async ($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$Topics;
	const anonId = Astro.cookies.get("strata_anon")?.value ?? crypto.randomUUID();
	const prefs = resolvePrefs(Astro.cookies, anonId);
	const topics = await listTopics();
	const posts = await listAll();
	return renderTemplate`${renderComponent($$result, "Base", $$Base, {
		"title": "Topics",
		"description": "What Strata writes about, and everything published under each heading.",
		"prefs": prefs
	}, { "default": ($$result) => renderTemplate`${maybeRenderHead($$result)}<header class="shell border-b border-rule py-12"><div class="max-w-2xl"><h1 class="text-3xl">Topics</h1><p class="mt-4 text-[1.0625rem] leading-relaxed text-ink-2">A small number of subjects, chosen because the format's advantage — depth, argument, and someone being accountable for accuracy — actually beats short-form social in them.</p></div></header><div class="shell py-12">${topics.map((topic) => {
		const items = posts.filter((p) => p.topicId === topic.id);
		return renderTemplate`<section${addAttribute(topic.slug, "id")} class="mb-16 scroll-mt-24 last:mb-0"><div class="border-b border-rule pb-3"><h2 class="text-xl">${topic.name}</h2></div><p class="mt-2 max-w-xl text-[0.9375rem] text-ink-2">${topic.blurb}</p><div class="mt-5">${items.length === 0 ? renderTemplate`<p class="py-6 text-[0.9375rem] text-ink-3">Nothing here yet.</p>` : items.map((p) => renderTemplate`${renderComponent($$result, "PostRow", $$PostRow, {
			"slug": p.slug,
			"title": p.title,
			"dek": p.dek,
			"status": p.status,
			"publishedAt": p.publishedAt,
			"updatedAt": p.updatedAt,
			"readingMinutes": p.readingMinutes,
			"versionCount": p.versionCount,
			"annotationTotal": p.annotationTotal,
			"authorName": p.authorName,
			"compact": true
		})}`)}</div><p class="meta mt-3">${plural(items.length, "post")}</p></section>`;
	})}</div>` })}`;
}, "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/pages/topics.astro", void 0);
var $$file = "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/pages/topics.astro";
var $$url = "/topics";
//#endregion
//#region \0virtual:astro:page:src/pages/topics@_@astro
var page = () => topics_exports;
//#endregion
export { page };
