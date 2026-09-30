import { t as __exportAll } from "./rolldown-runtime_8H4AJuhK.mjs";
import { a as unsubscribe, i as subscribe, t as isEmail } from "./subscriptions_BILT-nEZ.mjs";
import { r as safeReturnTo } from "./note-actions_CI6lMVYb.mjs";
import { z } from "zod";
//#region src/pages/api/subscribe.ts
var subscribe_exports = /* @__PURE__ */ __exportAll({
	GET: () => GET,
	POST: () => POST
});
/**
* Subscribe to a post's revisions. A plain form post, so it works with
* JavaScript off — the whole point of a subscription is that it is a
* considered act, not a one-tap gesture.
*
* Unsubscribe is the same endpoint with `?unsubscribe=1`, because the one
* action that must never be hard is leaving. It needs no confirmation, and no
* "are you sure" interstitial between a reader and the exit.
*/
var schema = z.object({
	postId: z.string().min(1),
	email: z.string().trim().toLowerCase().max(320),
	returnTo: z.string().optional(),
	unsubscribe: z.string().optional()
});
var POST = async ({ request, redirect, url }) => {
	const form = await request.formData().catch(() => null);
	const back = safeReturnTo(form?.get("returnTo"), "/");
	const target = new URL(back, url);
	target.searchParams.delete("subscribe");
	const parsed = schema.safeParse(form ? Object.fromEntries(form) : null);
	if (!parsed.success) {
		target.searchParams.set("subscribe", "error");
		return redirect(target.pathname + target.search, 303);
	}
	if (!isEmail(parsed.data.email)) {
		target.searchParams.set("subscribe", "bad-email");
		return redirect(target.pathname + target.search, 303);
	}
	if (parsed.data.unsubscribe) {
		await unsubscribe(parsed.data.postId, parsed.data.email);
		target.searchParams.set("subscribe", "off");
	} else {
		await subscribe(parsed.data.postId, parsed.data.email);
		target.searchParams.set("subscribe", "on");
	}
	return redirect(target.pathname + target.search, 303);
};
var GET = () => Response.redirect("/", 303);
//#endregion
//#region \0virtual:astro:page:src/pages/api/subscribe@_@ts
var page = () => subscribe_exports;
//#endregion
export { page };
