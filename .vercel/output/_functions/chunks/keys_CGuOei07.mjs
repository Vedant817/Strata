import { t as __exportAll } from "./rolldown-runtime_8H4AJuhK.mjs";
import { t as getIdentity } from "./auth_BCgGryh8.mjs";
import { r as safeReturnTo } from "./note-actions_CI6lMVYb.mjs";
import { a as setKey, c as getProvider, l as isByokEnabled, o as setModel, r as removeKey } from "./providerKeys_Dw83htch.mjs";
import { z } from "zod";
//#region src/pages/api/keys.ts
var keys_exports = /* @__PURE__ */ __exportAll({
	GET: () => GET,
	POST: () => POST
});
/**
* Bring-your-own-key management.
*
* Four actions, all ordinary form posts so they work with JavaScript off. The
* key is accepted, sealed immediately, and never echoed: the redirect carries
* only a status, so a key cannot end up in a URL, a referrer header, or the
* browser history.
*
* If KEY_ENCRYPTION_SECRET is absent, every write is refused rather than
* silently storing plaintext. A settings page that quietly degrades to
* plaintext when someone forgets an env var is the failure mode this whole
* module exists to prevent.
*/
var keySchema = z.object({
	action: z.literal("add"),
	providerId: z.string().min(1).max(40),
	apiKey: z.string().min(12).max(400),
	model: z.string().max(120).optional(),
	returnTo: z.string().optional()
});
var modelSchema = z.object({
	action: z.literal("model"),
	providerId: z.string().min(1).max(40),
	model: z.string().min(1).max(120),
	returnTo: z.string().optional()
});
var removeSchema = z.object({
	action: z.literal("remove"),
	providerId: z.string().min(1).max(40),
	returnTo: z.string().optional()
});
var POST = async ({ request, cookies, redirect, url }) => {
	const identity = await getIdentity(cookies);
	const form = await request.formData().catch(() => null);
	const back = safeReturnTo(form?.get("returnTo"), "/settings");
	const target = new URL(back, url);
	target.searchParams.delete("keysError");
	target.searchParams.delete("keysDone");
	target.searchParams.delete("keys");
	if (!identity.userId) return redirect("/write#handle", 303);
	const fail = (message) => {
		target.searchParams.set("keysError", message);
		return redirect(target.pathname + target.search, 303);
	};
	const done = (message) => {
		target.searchParams.set("keysDone", message);
		return redirect(target.pathname + target.search, 303);
	};
	if (!isByokEnabled()) return fail("Bring-your-own-key is disabled: the server has no KEY_ENCRYPTION_SECRET, so a key cannot be stored safely.");
	const raw = form ? Object.fromEntries(form) : null;
	const asKey = keySchema.safeParse(raw);
	if (asKey.success) {
		if (!getProvider(asKey.data.providerId)) return fail("Unknown provider.");
		const result = await setKey(identity.userId, asKey.data.providerId, asKey.data.apiKey, asKey.data.model);
		if (!result.ok) return fail(result.error);
		return done("Key saved. It is encrypted at rest and never shown again.");
	}
	const asModel = modelSchema.safeParse(raw);
	if (asModel.success) {
		if (!await setModel(identity.userId, asModel.data.providerId, asModel.data.model)) return fail("No key stored for that provider.");
		return done("Model chosen.");
	}
	const asRemove = removeSchema.safeParse(raw);
	if (asRemove.success) {
		if (!await removeKey(identity.userId, asRemove.data.providerId)) return fail("No key stored for that provider.");
		return done("Key deleted. It is gone from the system.");
	}
	return fail("That did not look like a valid request.");
};
var GET = () => Response.redirect("/settings", 303);
//#endregion
//#region \0virtual:astro:page:src/pages/api/keys@_@ts
var page = () => keys_exports;
//#endregion
export { page };
