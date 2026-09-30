import { t as __exportAll } from "./rolldown-runtime_8H4AJuhK.mjs";
import { S as unescapeHTML, a as Fragment, d as renderTemplate, f as maybeRenderHead, i as renderComponent, m as addAttribute, w as createAstro } from "./server_DKu4icSC.mjs";
import { t as createComponent } from "./compiler_DeGWR9rg.mjs";
import { u as resolvePrefs } from "./prefs_CLygXapP.mjs";
import { t as $$Base } from "./Base_BucALmBf.mjs";
import { t as $$StatusBadge } from "./StatusBadge_wg3zFwEI.mjs";
import { t as getIdentity } from "./auth_BCgGryh8.mjs";
import { b as searchPosts, n as countPosts } from "./posts_DKPEGog2.mjs";
//#region src/pages/search.astro
var search_exports = /* @__PURE__ */ __exportAll({
	default: () => $$Search,
	file: () => $$file,
	url: () => $$url
});
createAstro("http://localhost:4321");
var $$Search = createComponent(async ($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$Search;
	const anonId = Astro.cookies.get("strata_anon")?.value ?? crypto.randomUUID();
	const prefs = resolvePrefs(Astro.cookies, anonId);
	getIdentity(Astro.cookies);
	const query = (Astro.url.searchParams.get("q") ?? "").trim().slice(0, 200);
	const searched = query.length > 0;
	const hits = searched ? await searchPosts(query) : [];
	const indexed = await countPosts();
	return renderTemplate`${renderComponent($$result, "Base", $$Base, {
		"title": searched ? `“${query}” · Search` : "Search",
		"description": "Search every post on Strata — titles, deks and body text, ranked by relevance.",
		"prefs": prefs
	}, { "default": ($$result) => renderTemplate`${maybeRenderHead($$result)}<header class="shell border-b border-rule py-12"><div class="max-w-2xl"><p class="meta">Search</p><h1 class="mt-3 text-3xl">Search the canon</h1><form method="get" action="/search" class="mt-6 flex gap-2" role="search"><label class="sr-only" for="search-q">Search posts</label><input id="search-q" name="q" type="search"${addAttribute(query, "value")} required${addAttribute(2, "minlength")}${addAttribute(200, "maxlength")} autocomplete="off" placeholder="retrieval, p99, staging…" class="min-w-0 flex-1 border border-rule bg-paper px-3 py-2 text-[0.9375rem] focus:border-accent focus:outline-none"><button type="submit" class="shrink-0 border border-ink bg-ink px-4 py-2 text-[0.9375rem] text-paper transition-colors hover:border-accent hover:bg-accent">Search</button></form><p class="meta mt-3">${indexed} ${indexed === 1 ? "post" : "posts"} indexed · titles, deks and body text</p></div></header><div class="shell py-12"><div class="max-w-2xl">${!searched && renderTemplate`<p class="text-[1.0625rem] leading-relaxed text-ink-2">Type above. Results are ranked by relevance, and the sentence your words appear in is shown with each one — so you can tell before clicking whether the post argues what you hoped.</p>`}${searched && hits.length === 0 && renderTemplate`<div><p class="text-[1.0625rem] leading-relaxed text-ink">Nothing on “${query}”.</p><p class="mt-3 text-[0.9375rem] leading-relaxed text-ink-2">The canon is small and the spelling is literal-minded: try a shorter word, a synonym, or${" "}<a href="/writing" class="text-ink no-underline hover:text-accent">browse everything →</a></p></div>`}${searched && hits.length > 0 && renderTemplate`${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`<p class="meta mb-6">${hits.length} ${hits.length === 1 ? "result" : "results"} for “${query}”</p><ol class="space-y-8">${hits.map((hit) => renderTemplate`<li class="border-b border-rule pb-8 last:border-b-0"><div class="flex flex-wrap items-center gap-x-3 gap-y-1">${renderComponent($$result, "StatusBadge", $$StatusBadge, { "status": hit.status })}</div><h2 class="mt-2 text-xl"><a${addAttribute(`/w/${hit.slug}`, "href")} class="no-underline hover:text-accent">${hit.title}</a></h2>${hit.dek && renderTemplate`<p class="mt-1.5 text-[0.9375rem] leading-relaxed text-ink-2">${hit.dek}</p>`}<p class="search-snippet mt-2 border-l-2 border-rule-strong pl-3 text-[0.9375rem] leading-relaxed text-ink-2">${unescapeHTML(hit.snippet)}</p></li>`)}</ol>` })}`}</div></div>` })}`;
}, "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/pages/search.astro", void 0);
var $$file = "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/pages/search.astro";
var $$url = "/search";
//#endregion
//#region \0virtual:astro:page:src/pages/search@_@astro
var page = () => search_exports;
//#endregion
export { page };
