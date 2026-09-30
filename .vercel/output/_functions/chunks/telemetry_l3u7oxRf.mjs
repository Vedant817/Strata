import { t as __exportAll } from "./rolldown-runtime_8H4AJuhK.mjs";
import "./prefs_CLygXapP.mjs";
import { t as getIdentity } from "./auth_BCgGryh8.mjs";
import { _ as recordReach } from "./posts_DKPEGog2.mjs";
//#region src/pages/api/telemetry.ts
var telemetry_exports = /* @__PURE__ */ __exportAll({
	GET: () => GET,
	POST: () => POST
});
/**
* Reach beacon. The reader-instrumented comprehension signal behind the empathy
* analytics — which blocks did this reader actually get to.
*
* Deliberately narrow: a post id, the browser's own anon id, and a list of block
* ids. No scroll position, no dwell timing, no per-reader profile a writer could
* browse, and no third party involved. Suppressed for cohorts under twenty
* readers on the way out.
*/
var POST = async ({ request, cookies }) => {
	let payload;
	try {
		payload = await request.json();
	} catch {
		return new Response(null, { status: 400 });
	}
	const postId = typeof payload.postId === "string" ? payload.postId : "";
	const blockIds = Array.isArray(payload.blockIds) ? payload.blockIds.filter((b) => typeof b === "string").slice(0, 400) : [];
	if (!postId || blockIds.length === 0) return new Response(null, { status: 204 });
	const anonId = cookies.get("strata_anon")?.value ?? "";
	if (!anonId) return new Response(null, { status: 204 });
	const identity = await getIdentity(cookies);
	try {
		await recordReach({
			postId,
			anonId,
			userId: identity.userId,
			blockIds
		});
	} catch (err) {
		console.error("[strata] reach beacon failed", err);
	}
	return new Response(null, { status: 204 });
};
/** sendBeacon sends POST, but be explicit for anything that strays. */
var GET = () => new Response(null, { status: 405 });
//#endregion
//#region \0virtual:astro:page:src/pages/api/telemetry@_@ts
var page = () => telemetry_exports;
//#endregion
export { page };
