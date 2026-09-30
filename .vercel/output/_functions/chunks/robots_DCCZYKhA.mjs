import { t as __exportAll } from "./rolldown-runtime_8H4AJuhK.mjs";
//#region src/pages/robots.txt.ts
var robots_txt_exports = /* @__PURE__ */ __exportAll({ GET: () => GET });
/**
* robots.txt, which also advertises the sitemap.
*
* The sitemap is generated at build time by @astrojs/sitemap, so there is no dev
* route for it and nothing in the served HTML would otherwise point a crawler at
* it. Saying so here is what makes the discovery layer actually discoverable.
*
* `/api/` is disallowed because those endpoints take writes and a crawler has no
* business invoking them. Claim tokens are single-use, and a crawler following
* `/claim/<token>` in a preview would burn the reader's link before they saw it.
*/
function GET(context) {
	const site = context.site ?? new URL("http://localhost:4321");
	const body = [
		"User-agent: *",
		"Allow: /",
		"Disallow: /api/",
		"Disallow: /claim/",
		"",
		`Sitemap: ${new URL("/sitemap-index.xml", site).href}`,
		""
	].join("\n");
	return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
//#endregion
//#region \0virtual:astro:page:src/pages/robots.txt@_@ts
var page = () => robots_txt_exports;
//#endregion
export { page };
