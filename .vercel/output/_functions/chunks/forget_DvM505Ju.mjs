import { t as __exportAll } from "./rolldown-runtime_8H4AJuhK.mjs";
import { i as forgetReader } from "./posts_DKPEGog2.mjs";
//#region src/pages/api/forget.ts
var forget_exports = /* @__PURE__ */ __exportAll({
	GET: () => GET,
	POST: () => POST
});
/**
* Reader-initiated erasure. Issues a real DELETE rather than hiding records
* behind a preference — privacy you cannot exercise is not privacy.
*
* Deliberately POST-only and CSRF-protected by Astro's origin check, and it
* only ever deletes rows scoped to the supplied anon id.
*/
var POST = async ({ request, redirect }) => {
	const anon = (await request.formData().catch(() => null))?.get("anon");
	if (typeof anon !== "string" || !/^[a-z0-9-]{8,64}$/i.test(anon)) return redirect("/privacy", 303);
	try {
		await forgetReader(anon);
	} catch (err) {
		console.error("[strata] forget failed", err);
		return new Response("Could not complete the deletion.", { status: 500 });
	}
	return redirect("/privacy?forgotten=1", 303);
};
/** A GET here is a misclick; send them somewhere useful instead of leaking. */
var GET = ({ redirect }) => redirect("/privacy#forget", 303);
//#endregion
//#region \0virtual:astro:page:src/pages/api/forget@_@ts
var page = () => forget_exports;
//#endregion
export { page };
