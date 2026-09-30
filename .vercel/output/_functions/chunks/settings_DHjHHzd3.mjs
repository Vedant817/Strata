import { t as __exportAll } from "./rolldown-runtime_8H4AJuhK.mjs";
import { a as DEPTH_COOKIE, r as DENSITY_COOKIE } from "./prefs_CLygXapP.mjs";
import { t as getIdentity } from "./auth_BCgGryh8.mjs";
import { r as safeReturnTo } from "./note-actions_CI6lMVYb.mjs";
import { r as saveProfile } from "./readerProfile_BXIp8Gwr.mjs";
import { z } from "zod";
//#region src/pages/api/settings.ts
var settings_exports = /* @__PURE__ */ __exportAll({
	GET: () => GET,
	POST: () => POST
});
/**
* Save reading preferences.
*
* Two writes, on purpose. The cookie is what this device reads on every page,
* so it must be updated immediately or the reader's next click is ignored. The
* profile is what a *different* device inherits. Writing only one of them is
* how a settings page ends up that appears to work until you switch laptops.
*/
var schema = z.object({
	depth: z.enum([
		"skim",
		"understand",
		"master"
	]),
	density: z.enum([
		"comfortable",
		"compact",
		"roomy"
	]),
	returnTo: z.string().optional()
});
var POST = async ({ request, cookies, redirect, url }) => {
	const identity = await getIdentity(cookies);
	const form = await request.formData().catch(() => null);
	const back = safeReturnTo(form?.get("returnTo"), "/settings");
	const target = new URL(back, url);
	target.searchParams.delete("settingsError");
	target.searchParams.delete("saved");
	if (!identity.userId) return redirect("/write#handle", 303);
	const parsed = schema.safeParse(form ? Object.fromEntries(form) : null);
	if (!parsed.success) {
		target.searchParams.set("settingsError", "Those settings did not look right.");
		return redirect(target.pathname + target.search, 303);
	}
	const year = 31536e3;
	cookies.set(DEPTH_COOKIE, parsed.data.depth, {
		path: "/",
		maxAge: year,
		sameSite: "lax"
	});
	cookies.set(DENSITY_COOKIE, parsed.data.density, {
		path: "/",
		maxAge: year,
		sameSite: "lax"
	});
	await saveProfile(identity.userId, {
		depth: parsed.data.depth,
		density: parsed.data.density
	});
	target.searchParams.set("saved", "1");
	return redirect(target.pathname + target.search, 303);
};
var GET = () => Response.redirect("/settings", 303);
//#endregion
//#region \0virtual:astro:page:src/pages/api/settings@_@ts
var page = () => settings_exports;
//#endregion
export { page };
