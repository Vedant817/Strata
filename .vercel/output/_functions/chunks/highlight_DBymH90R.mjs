import { t as __exportAll } from "./rolldown-runtime_8H4AJuhK.mjs";
import "./prefs_CLygXapP.mjs";
import { t as getIdentity } from "./auth_BCgGryh8.mjs";
import { i as toggleHighlight, r as highlightKeyFor } from "./highlights_CaFzTkyg.mjs";
import { z } from "zod";
//#region src/pages/api/highlight.ts
var highlight_exports = /* @__PURE__ */ __exportAll({
	GET: () => GET,
	POST: () => POST
});
/**
* Toggle a highlight. A form post so it works without JavaScript; the island
* upgrades it to a fetch when present.
*
* Deliberately silent and unanimated: a highlight belongs to the reader, so
* nothing is announced, no count is shown, and the only trace left is a warm
* underline on their own return visit. Making it visible to others would turn
* a private act into applause, which §1.1 refuses.
*/
var schema = z.object({
	postId: z.string().min(1),
	blockId: z.string().min(1),
	text: z.string().max(600),
	returnTo: z.string().optional()
});
var POST = async ({ request, cookies, redirect }) => {
	const contentType = request.headers.get("content-type") ?? "";
	let raw = null;
	let back = "/";
	if (contentType.includes("application/json")) raw = await request.json().catch(() => null);
	else {
		const form = await request.formData().catch(() => null);
		back = typeof form?.get("returnTo") === "string" ? form.get("returnTo") : "/";
		raw = form ? Object.fromEntries(form) : null;
	}
	const parsed = schema.safeParse(raw);
	if (!parsed.success) {
		if (contentType.includes("application/json")) return new Response(JSON.stringify({ error: "Invalid highlight." }), {
			status: 400,
			headers: { "content-type": "application/json" }
		});
		return redirect(back, 303);
	}
	const identity = await getIdentity(cookies);
	const anonId = cookies.get("strata_anon")?.value ?? identity.anonId;
	if (!anonId) {
		if (contentType.includes("application/json")) return new Response(null, { status: 204 });
		return redirect(back, 303);
	}
	const added = await toggleHighlight({
		postId: parsed.data.postId,
		blockId: parsed.data.blockId,
		text: parsed.data.text || "",
		key: highlightKeyFor(identity.userId, anonId),
		userId: identity.userId
	});
	if (contentType.includes("application/json")) return new Response(JSON.stringify({
		ok: true,
		highlighted: added
	}), { headers: { "content-type": "application/json" } });
	return redirect(`${back}${back.includes("?") ? "&" : "?"}hl=${added ? "on" : "off"}`, 303);
};
var GET = () => Response.redirect("/", 303);
//#endregion
//#region \0virtual:astro:page:src/pages/api/highlight@_@ts
var page = () => highlight_exports;
//#endregion
export { page };
