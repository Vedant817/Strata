import { t as __exportAll } from "./rolldown-runtime_8H4AJuhK.mjs";
import "./prefs_CLygXapP.mjs";
import { t as getIdentity } from "./auth_BCgGryh8.mjs";
import { i as memoryKeyFor, o as toggleFollow, s as toggleSaved } from "./reader_BL_CGxBC.mjs";
import { r as safeReturnTo } from "./note-actions_CI6lMVYb.mjs";
import { z } from "zod";
//#region src/pages/api/memory.ts
var memory_exports = /* @__PURE__ */ __exportAll({
	GET: () => GET,
	POST: () => POST
});
/**
* Follows and saves. Same contract as the note endpoint: ordinary form posts,
* one validated schema, redirect back. Anonymous-first — the key is the
* browser until claimed, and claiming backfills both tables, so nothing is
* lost at the moment an identity appears.
*/
var schema = z.discriminatedUnion("action", [z.object({
	action: z.literal("follow"),
	authorId: z.string().min(1),
	returnTo: z.string().optional()
}), z.object({
	action: z.literal("save"),
	postId: z.string().min(1),
	returnTo: z.string().optional()
})]);
var POST = async ({ request, cookies, redirect }) => {
	const identity = await getIdentity(cookies);
	const anonId = cookies.get("strata_anon")?.value ?? identity.anonId;
	if (!anonId) return redirect("/", 303);
	const form = await request.formData().catch(() => null);
	const back = safeReturnTo(form?.get("returnTo"), "/");
	const parsed = schema.safeParse(form ? Object.fromEntries(form) : null);
	if (!parsed.success) return redirect(back, 303);
	const key = memoryKeyFor(identity.userId, anonId);
	if (parsed.data.action === "follow") await toggleFollow(key, parsed.data.authorId);
	else await toggleSaved(key, parsed.data.postId);
	return redirect(back, 303);
};
var GET = () => Response.redirect("/", 303);
//#endregion
//#region \0virtual:astro:page:src/pages/api/memory@_@ts
var page = () => memory_exports;
//#endregion
export { page };
