import { t as __exportAll } from "./rolldown-runtime_8H4AJuhK.mjs";
import { d as renderTemplate, f as maybeRenderHead, i as renderComponent, m as addAttribute, w as createAstro } from "./server_DKu4icSC.mjs";
import { t as createComponent } from "./compiler_DeGWR9rg.mjs";
import { u as resolvePrefs } from "./prefs_CLygXapP.mjs";
import { t as $$Base } from "./Base_BucALmBf.mjs";
import { r as plural } from "./format_D0bVmvvo.mjs";
import { d as listReadingLists } from "./taxonomy_CiJ526xn.mjs";
//#region src/pages/lists/index.astro
var lists_exports = /* @__PURE__ */ __exportAll({
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
	const lists = await listReadingLists();
	return renderTemplate`${renderComponent($$result, "Base", $$Base, {
		"title": "Reading lists",
		"description": "Discovery here is curation, not a feed. Sequences with a reason for the order.",
		"prefs": prefs
	}, { "default": ($$result) => renderTemplate`${maybeRenderHead($$result)}<header class="shell border-b border-rule py-12"><div class="max-w-2xl"><h1 class="text-3xl">Reading lists</h1><p class="mt-4 text-[1.0625rem] leading-relaxed text-ink-2">There is no algorithmic feed here, on purpose. A feed can only be optimised for engagement, and an engagement-optimised feed is structurally hostile to the thing this publication is for. So the primary unit of discovery is an <strong class="font-medium text-ink">ordered sequence with a reason for the order</strong> — a playlist for long-form, where "read this before the third one" is the actual value.</p></div></header><div class="shell py-12">${lists.length === 0 ? renderTemplate`<p class="text-[0.9375rem] text-ink-3">No lists yet.</p>` : renderTemplate`<ul class="max-w-3xl">${lists.map((list) => renderTemplate`<li class="border-b border-rule py-6 first:border-t first:pt-0 last:border-b-0"><h2 class="text-lg"><a${addAttribute(`/lists/${list.slug}`, "href")} class="no-underline transition-colors hover:text-accent">${list.title}</a></h2><p class="mt-1.5 text-[0.9375rem] leading-relaxed text-ink-2">${list.description}</p><p class="meta mt-2">${plural(list.items.length, "post")} · by ${list.ownerHandle}</p><ol class="mt-3 flex flex-wrap gap-x-2 gap-y-1">${list.items.map((item, i) => renderTemplate`<li class="meta"><span class="text-ink-3 tabular-nums">${i + 1}.</span>${" "}<a${addAttribute(`/w/${item.post.slug}`, "href")} class="no-underline transition-colors hover:text-ink">${item.post.title}</a></li>`)}</ol></li>`)}</ul>`}</div>` })}`;
}, "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/pages/lists/index.astro", void 0);
var $$file = "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/pages/lists/index.astro";
var $$url = "/lists";
//#endregion
//#region \0virtual:astro:page:src/pages/lists/index@_@astro
var page = () => lists_exports;
//#endregion
export { page };
