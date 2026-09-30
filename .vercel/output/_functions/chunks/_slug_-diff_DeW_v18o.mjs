import { t as __exportAll } from "./rolldown-runtime_8H4AJuhK.mjs";
import { r as plural } from "./format_D0bVmvvo.mjs";
import { i as stripInline } from "./inline_YMPn7sV2.mjs";
import { d as getRevisionView } from "./posts_DKPEGog2.mjs";
import { t as renderShareCard } from "./og_CWbiWr-7.mjs";
//#region src/pages/og/[slug]-diff.png.ts
var _slug__diff_png_exports = /* @__PURE__ */ __exportAll({ GET: () => GET });
/**
* The diff share card: §10.6's "primary viral asset".
*
* A title card could belong to any blog. A card that says what changed in this
* post since revision 2 is this publication's whole thesis, rendered at 1200
* pixels. It is honest rather than clever — the counts come from a real
* comparison against the previous version, so a card can never claim a change
* that is not in the history.
*
* `?rev=N` shares that specific revision's comparison, which is how a writer
* posts the fix they just made.
*/
var GET = async ({ params, url }) => {
	const { slug } = params;
	if (!slug) return new Response(null, {
		status: 404,
		statusText: "Not found"
	});
	const { listAll } = await import("./taxonomy_CiJ526xn.mjs").then((n) => n.v);
	const match = (await listAll()).find((p) => p.slug === slug);
	if (!match) return new Response(null, {
		status: 404,
		statusText: "Not found"
	});
	const requested = Number(url.searchParams.get("rev") ?? "");
	const target = Number.isFinite(requested) && requested > 0 ? requested : void 0;
	const view = await getRevisionView(match.id, target);
	if (!view) return new Response(null, {
		status: 404,
		statusText: "Not found"
	});
	const changed = view.diff.filter((d) => d.status !== "unchanged");
	const isHead = !target;
	const preview = changed.flatMap((d) => d.segments.filter((s) => s.type !== "same" && s.text.trim().length > 12).map((s) => ({
		kind: s.type === "ins" ? "added" : s.type === "del" ? "removed" : "changed",
		text: stripInline(s.text).replace(/\s+/g, " ").trim().slice(0, 170)
	}))).slice(0, 3);
	const png = await renderShareCard({
		title: match.title,
		kicker: changed.length > 0 ? `${plural(changed.length, "change")} in v${view.current.versionNumber}` : `v${view.current.versionNumber}`,
		kickerColor: changed.length > 0 ? "#a63a24" : "#837d72",
		changes: preview,
		footerLeft: changed.length > 0 ? `diffed against v${view.compared?.versionNumber ?? 1}` : "no changes yet",
		footerRight: "strata.pub"
	});
	return new Response(png, { headers: {
		"content-type": "image/png",
		"cache-control": isHead ? "public, max-age=3600" : "public, max-age=86400, immutable"
	} });
};
//#endregion
//#region \0virtual:astro:page:src/pages/og/[slug]-diff.png@_@ts
var page = () => _slug__diff_png_exports;
//#endregion
export { page };
