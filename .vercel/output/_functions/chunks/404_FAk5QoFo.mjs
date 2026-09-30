import { t as __exportAll } from "./rolldown-runtime_8H4AJuhK.mjs";
import { d as renderTemplate, f as maybeRenderHead, i as renderComponent } from "./server_DKu4icSC.mjs";
import { t as createComponent } from "./compiler_DeGWR9rg.mjs";
import { t as $$Base } from "./Base_BucALmBf.mjs";
//#region src/pages/404.astro
var _404_exports = /* @__PURE__ */ __exportAll({
	default: () => $$404,
	file: () => $$file,
	url: () => $$url
});
var $$404 = createComponent(($$result, $$props, $$slots) => {
	return renderTemplate`${renderComponent($$result, "Base", $$Base, {
		"title": "Not found",
		"description": "That page does not exist.",
		"noindex": true
	}, { "default": ($$result) => renderTemplate`${maybeRenderHead($$result)}<div class="shell py-24"><p class="meta">404</p><h1 class="measure mt-3 text-3xl">This page isn't here.</h1><p class="measure mt-4 text-ink-2">It may have been renamed, or it may never have existed. Both happen.</p><ul class="measure mt-8 space-y-2"><li><a href="/writing">All writing</a></li><li><a href="/topics">Browse by topic</a></li><li><a href="/">Back to the front page</a></li></ul></div>` })}`;
}, "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/pages/404.astro", void 0);
var $$file = "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/pages/404.astro";
var $$url = "/404";
//#endregion
//#region \0virtual:astro:page:src/pages/404@_@astro
var page = () => _404_exports;
//#endregion
export { page };
