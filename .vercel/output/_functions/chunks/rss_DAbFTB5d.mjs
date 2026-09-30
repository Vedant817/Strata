import { t as __exportAll } from "./rolldown-runtime_8H4AJuhK.mjs";
import { l as listAll } from "./taxonomy_CiJ526xn.mjs";
import { i as stripInline } from "./inline_YMPn7sV2.mjs";
import rss from "@astrojs/rss";
//#region src/pages/rss.xml.ts
var rss_xml_exports = /* @__PURE__ */ __exportAll({ GET: () => GET });
/**
* RSS, including the revision count as a namespaced element. A reader watching
* for corrections is the whole thesis in feed form — the one thing a static
* feed normally cannot express.
*/
async function GET(context) {
	const posts = await listAll();
	return rss({
		title: "Strata",
		description: "A publication for long-form that outlives its own publication date. Posts carry their revision history.",
		site: context.site ?? "http://localhost:4321",
		trailingSlash: false,
		customData: "<language>en</language>",
		xmlns: { strata: "https://strata.pub/ns" },
		items: posts.map((post) => ({
			title: post.title,
			description: post.dek || stripInline(post.title),
			pubDate: new Date(post.publishedAt ?? post.createdAt ?? Date.now()),
			link: `/w/${post.slug}`,
			categories: post.topicName ? [post.topicName] : void 0,
			author: post.authorName,
			customData: `<strata:revision>${post.versionCount}</strata:revision>`
		}))
	});
}
//#endregion
//#region \0virtual:astro:page:src/pages/rss.xml@_@ts
var page = () => rss_xml_exports;
//#endregion
export { page };
