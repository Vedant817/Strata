import { t as __exportAll } from "./rolldown-runtime_8H4AJuhK.mjs";
import { d as renderTemplate, f as maybeRenderHead, i as renderComponent, m as addAttribute, w as createAstro } from "./server_DKu4icSC.mjs";
import { t as createComponent } from "./compiler_DeGWR9rg.mjs";
import { u as resolvePrefs } from "./prefs_CLygXapP.mjs";
import { t as $$Base } from "./Base_BucALmBf.mjs";
import { r as plural } from "./format_D0bVmvvo.mjs";
import { t as $$PostRow } from "./PostRow_B0WJeZNZ.mjs";
import { l as listAll } from "./taxonomy_CiJ526xn.mjs";
//#region src/pages/writing/index.astro
var writing_exports = /* @__PURE__ */ __exportAll({
	default: () => $$Index,
	file: () => $$file,
	url: () => $$url
});
createAstro("http://localhost:4321");
var $$Index = createComponent(async ($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$Index;
	const anonId = Astro.cookies.get("strata_anon")?.value ?? crypto.randomUUID();
	const prefs = resolvePrefs(Astro.cookies, anonId);
	const posts = await listAll({ includeSeedlings: true });
	const groups = [
		{
			key: "evergreen",
			label: "Evergreen",
			blurb: "Actively maintained. Someone is answerable for the accuracy."
		},
		{
			key: "budding",
			label: "Budding",
			blurb: "An argument forming, with references attached to its claims."
		},
		{
			key: "seedling",
			label: "Seedlings",
			blurb: "Published before they are finished, on purpose."
		},
		{
			key: "archived",
			label: "Archived",
			blurb: "Kept for the record, no longer maintained."
		}
	];
	return renderTemplate`${renderComponent($$result, "Base", $$Base, {
		"title": "Writing",
		"description": "Everything published on Strata, grouped by how finished it is.",
		"prefs": prefs
	}, { "default": ($$result) => renderTemplate`${maybeRenderHead($$result)}<header class="shell border-b border-rule py-12"><div class="max-w-2xl"><h1 class="text-3xl">Writing</h1><p class="mt-4 text-[1.0625rem] leading-relaxed text-ink-2">${plural(posts.length, "post")}, grouped by how finished they are rather than by date. Grouping by lifecycle is the point: on most publications everything is presented as equally settled, and the reader has no way to know how much weight a claim has earned.</p></div></header><div class="shell py-12"><nav aria-label="Jump to a group" class="mb-10 flex flex-wrap gap-x-5 gap-y-2 border-b border-rule pb-4">${groups.filter((g) => posts.some((p) => p.status === g.key)).map((g) => renderTemplate`<a${addAttribute(`#${g.key}`, "href")} class="meta no-underline transition-colors hover:text-ink">${g.label}</a>`)}</nav>${groups.map((group) => {
		const items = posts.filter((p) => p.status === group.key);
		if (items.length === 0) return null;
		return renderTemplate`<section${addAttribute(group.key, "id")} class="mb-14 scroll-mt-24 last:mb-0"><div class="flex flex-wrap items-baseline justify-between gap-3 border-b border-rule pb-3"><h2 class="text-xl">${group.label}</h2><p class="meta">${plural(items.length, "post")}</p></div><p class="mt-2 max-w-xl text-[0.9375rem] text-ink-2">${group.blurb}</p><div class="mt-5">${items.map((p) => renderTemplate`${renderComponent($$result, "PostRow", $$PostRow, {
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
			"topicName": p.topicName
		})}`)}</div></section>`;
	})}</div>` })}`;
}, "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/pages/writing/index.astro", void 0);
var $$file = "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/pages/writing/index.astro";
var $$url = "/writing";
//#endregion
//#region \0virtual:astro:page:src/pages/writing/index@_@astro
var page = () => writing_exports;
//#endregion
export { page };
