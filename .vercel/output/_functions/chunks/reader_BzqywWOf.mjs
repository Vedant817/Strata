import { t as __exportAll } from "./rolldown-runtime_8H4AJuhK.mjs";
import { a as Fragment, d as renderTemplate, f as maybeRenderHead, i as renderComponent, m as addAttribute, w as createAstro } from "./server_DKu4icSC.mjs";
import { t as createComponent } from "./compiler_DeGWR9rg.mjs";
import { u as resolvePrefs } from "./prefs_CLygXapP.mjs";
import { t as $$Base } from "./Base_BucALmBf.mjs";
import { t as ago } from "./format_D0bVmvvo.mjs";
import { t as getIdentity } from "./auth_BCgGryh8.mjs";
import { t as getReaderMemory } from "./reader_BL_CGxBC.mjs";
//#region src/pages/reader.astro
var reader_exports = /* @__PURE__ */ __exportAll({
	default: () => $$Reader,
	file: () => $$file,
	url: () => $$url
});
createAstro("http://localhost:4321");
var $$Reader = createComponent(async ($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$Reader;
	const anonId = Astro.cookies.get("strata_anon")?.value ?? crypto.randomUUID();
	const prefs = resolvePrefs(Astro.cookies, anonId);
	const identity = await getIdentity(Astro.cookies);
	const memory = await getReaderMemory(anonId, identity.userId);
	const behind = memory.entries.filter((e) => e.behind);
	return renderTemplate`${renderComponent($$result, "Base", $$Base, {
		"title": "Your reading",
		"description": "What you have read, what moved since, and what you argued with in the margins.",
		"prefs": prefs
	}, { "default": ($$result) => renderTemplate`${maybeRenderHead($$result)}<header class="shell border-b border-rule py-12"><div class="max-w-2xl"><p class="meta">Reader memory</p><h1 class="mt-3 text-3xl">Your reading</h1><p class="mt-4 text-[1.0625rem] leading-relaxed text-ink-2">${memory.entries.length === 0 ? "Nothing here yet — which is correct, because nothing has been read from this browser yet." : "Everything this browser has read, and everything that moved since. This is private to you."}</p></div></header><div class="shell py-12"><div class="max-w-2xl space-y-14">${behind.length > 0 && renderTemplate`<section aria-labelledby="moved-heading"><h2 id="moved-heading" class="text-xl">Moved since you read</h2><ol class="mt-4 space-y-3">${behind.map((e) => renderTemplate`<li class="border border-accent bg-accent-soft px-4 py-3"><a${addAttribute(`/w/${e.slug}`, "href")} class="font-medium no-underline hover:text-accent">${e.title}</a><p class="meta mt-1">You saw v${e.versionNumber} · now v${e.currentVersionNumber} · read ${ago(e.readAt)}</p></li>`)}</ol></section>`}<section aria-labelledby="history-heading"><h2 id="history-heading" class="text-xl">History</h2>${memory.entries.length === 0 ? renderTemplate`<p class="mt-3 border-l-2 border-rule-strong pl-3 text-[0.9375rem] text-ink-2">Start with${" "}<a href="/lists/start-here" class="text-ink no-underline hover:text-accent">the starting order →</a></p>` : renderTemplate`<ol class="mt-4 space-y-3">${memory.entries.map((e) => renderTemplate`<li class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-rule pb-3 last:border-b-0"><a${addAttribute(`/w/${e.slug}`, "href")} class="no-underline hover:text-accent">${e.title}</a><span class="meta">v${e.versionNumber}${e.behind ? ` · now v${e.currentVersionNumber}` : ""} · ${ago(e.readAt)}</span></li>`)}</ol>`}</section>${memory.notes.length > 0 && renderTemplate`<section aria-labelledby="your-notes-heading"><h2 id="your-notes-heading" class="text-xl">Your margin notes <span class="meta">· ${memory.notes.length}</span></h2><ol class="mt-4 space-y-4">${memory.notes.map((n) => renderTemplate`<li class="border border-rule p-4"><p class="meta">${n.kind} · on${" "}<a${addAttribute(`/w/${n.postSlug}`, "href")} class="no-underline hover:text-ink">${n.postTitle}</a>${n.isPrivate && renderTemplate`${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${" "}· <span class="text-ochre">only you</span>` })}`}</p><p class="mt-1.5 text-[0.9375rem] leading-relaxed text-ink-2">${n.body}</p><p class="meta mt-1.5"><a${addAttribute(`/w/${n.postSlug}#note-${n.id}`, "href")} class="no-underline hover:text-ink">read in context →</a>${" "}· ${ago(n.createdAt)}</p></li>`)}</ol></section>`}${memory.topics.length > 0 && renderTemplate`<section aria-labelledby="topics-heading"><h2 id="topics-heading" class="text-xl">Your topics</h2><p class="mt-2 text-[0.9375rem] text-ink-2">Revealed by reading, not stated on a form.</p><ul class="mt-3 flex flex-wrap gap-2">${memory.topics.map((t) => renderTemplate`<li><a${addAttribute(`/topics#${t.slug}`, "href")} class="meta no-underline border border-rule px-2 py-1 hover:border-rule-strong hover:text-ink">${t.name}</a></li>`)}</ul></section>`}${(memory.saved.length > 0 || memory.followed.length > 0) && renderTemplate`<section aria-labelledby="kept-heading"><h2 id="kept-heading" class="text-xl">Kept</h2>${memory.saved.length > 0 && renderTemplate`${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`<p class="meta mt-4">Saved for later</p><ol class="mt-2 space-y-3">${memory.saved.map((s) => renderTemplate`<li class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-rule pb-3 last:border-b-0"><a${addAttribute(`/w/${s.slug}`, "href")} class="no-underline hover:text-accent">${s.title}</a><span class="meta">kept ${ago(s.savedAt)}</span></li>`)}</ol>` })}`}${memory.followed.length > 0 && renderTemplate`${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`<p class="meta mt-6">Authors you follow</p><ul class="mt-2 flex flex-wrap gap-2">${memory.followed.map((a) => renderTemplate`<li><a${addAttribute(`/a/${a.handle}`, "href")} class="meta no-underline border border-rule px-2 py-1 hover:border-rule-strong hover:text-ink">@${a.handle}</a></li>`)}</ul>` })}`}</section>`}<p class="border-t border-rule pt-6 text-[0.9375rem] text-ink-2"><a href="/settings" class="text-ink no-underline hover:text-accent">Reading settings →</a>${" "}<a href="/privacy#forget" class="text-ink no-underline hover:text-accent">Forget my reading history →</a>${" "}These empty together.</p></div></div>` })}`;
}, "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/pages/reader.astro", void 0);
var $$file = "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/pages/reader.astro";
var $$url = "/reader";
//#endregion
//#region \0virtual:astro:page:src/pages/reader@_@astro
var page = () => reader_exports;
//#endregion
export { page };
