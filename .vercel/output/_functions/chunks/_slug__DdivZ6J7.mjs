import { t as __exportAll } from "./rolldown-runtime_8H4AJuhK.mjs";
import { u as getPostBySlug } from "./posts_DKPEGog2.mjs";
import { t as renderShareCard } from "./og_CWbiWr-7.mjs";
//#region src/pages/og/[slug].png.ts
var _slug__png_exports = /* @__PURE__ */ __exportAll({ GET: () => GET });
/**
* The share image for a post. Carries the revision count because the record
* of revision is the credibility signal — a card that only shows the title
* could belong to any blog. Cached for a day; a new revision is worth a new
* card, but not a new card on every read.
*/
var GET = async ({ params }) => {
	const post = params.slug ? await getPostBySlug(params.slug) : null;
	if (!post) return new Response(null, {
		status: 404,
		statusText: "Not found"
	});
	const png = await renderShareCard({
		title: post.title,
		dek: post.dek || void 0,
		kicker: post.status,
		kickerColor: "#a63a24",
		footerLeft: `by ${post.authorName} · revised ${post.versionCount}×`,
		footerRight: "strata.pub"
	});
	return new Response(png, { headers: {
		"content-type": "image/png",
		"cache-control": "public, max-age=86400"
	} });
};
//#endregion
//#region \0virtual:astro:page:src/pages/og/[slug].png@_@ts
var page = () => _slug__png_exports;
//#endregion
export { page };
