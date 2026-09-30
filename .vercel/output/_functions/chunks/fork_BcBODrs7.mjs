import { t as __exportAll } from "./rolldown-runtime_8H4AJuhK.mjs";
import { t as getIdentity } from "./auth_BCgGryh8.mjs";
import { a as forkPost } from "./posts_DKPEGog2.mjs";
import { r as safeReturnTo } from "./note-actions_CI6lMVYb.mjs";
import { z } from "zod";
//#region src/pages/api/fork.ts
var fork_exports = /* @__PURE__ */ __exportAll({
	GET: () => GET,
	POST: () => POST
});
/**
* Fork a post into your own seedling.
*
* §4.3 exists because the rebuttal you wish existed, the regional
* perspective, and the translation all deserve to be first-class posts with
* lineage — not comments. Requires a claimed handle: a fork has an author,
* and anonymous text cannot have one. Only public, published posts fork;
* drafts and unlisted posts are not yours to carry elsewhere.
*/
var schema = z.object({
	postId: z.string().min(1),
	returnTo: z.string().optional()
});
var POST = async ({ request, cookies, redirect, url }) => {
	const identity = await getIdentity(cookies);
	if (!identity.userId) return redirect("/write#handle", 303);
	const form = await request.formData().catch(() => null);
	const back = safeReturnTo(form?.get("returnTo"), "/writing");
	const parsed = schema.safeParse(form ? Object.fromEntries(form) : null);
	if (!parsed.success) return redirect(back, 303);
	const result = await forkPost(parsed.data.postId, identity.userId);
	if (!result.ok) {
		const target = new URL(back, url);
		target.searchParams.set("studioError", result.error);
		return redirect(target.pathname + target.search, 303);
	}
	return redirect(`/w/${result.slug}`, 303);
};
var GET = () => Response.redirect("/writing", 303);
//#endregion
//#region \0virtual:astro:page:src/pages/api/fork@_@ts
var page = () => fork_exports;
//#endregion
export { page };
