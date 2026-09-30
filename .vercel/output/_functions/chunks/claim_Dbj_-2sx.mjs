import { t as __exportAll } from "./rolldown-runtime_8H4AJuhK.mjs";
import "./prefs_CLygXapP.mjs";
import { a as requestHandleClaim } from "./auth_BCgGryh8.mjs";
import { n as sendMail, t as isMailConfigured } from "./mail_DxMsbSXU.mjs";
//#region src/pages/api/claim.ts
var claim_exports = /* @__PURE__ */ __exportAll({
	GET: () => GET,
	POST: () => POST
});
/**
* Request a handle claim.
*
* The link goes out by email when a mailer is configured. When none is, the
* page shows the link on screen instead — stated plainly in the UI rather
* than dressed up as a working confirmation email.
*/
var POST = async ({ request, cookies }) => {
	const form = await request.formData().catch(() => null);
	const handle = form?.get("handle");
	const email = form?.get("email");
	const anonId = cookies.get("strata_anon")?.value || form?.get("anon") || "";
	if (typeof handle !== "string" || typeof email !== "string") return new Response("Missing handle or email.", { status: 400 });
	const result = await requestHandleClaim({
		handle,
		email,
		anonId
	});
	if (!result.ok) return new Response(result.error, { status: 400 });
	const site = new URL(request.url);
	const link = new URL(`/claim/${result.token}`, site).href;
	const cleanHandle = handle.trim().toLowerCase();
	let mailed = false;
	if (isMailConfigured()) {
		const sent = await sendMail({
			to: email.trim().toLowerCase(),
			subject: `Claim @${cleanHandle} on Strata`,
			text: [
				`Someone — hopefully you — asked to claim the handle @${cleanHandle}.`,
				"",
				`Open this link within 20 minutes to attach it to your notes:`,
				link,
				"",
				"If that was not you, ignore this. The handle stays unclaimed."
			].join("\n")
		});
		if (!sent.ok) {
			console.error("[strata] claim email failed:", sent.error);
			return new Response("The claim was recorded but the email could not be sent. Ask for a new link and try again.", { status: 502 });
		}
		mailed = true;
	} else console.log("[strata] claim link issued (shown in the UI; no mailer configured):", link);
	const url = new URL("/write", site);
	if (!mailed) url.searchParams.set("claim", result.token);
	else url.searchParams.set("mailed", cleanHandle);
	return Response.redirect(url, 303);
};
var GET = () => Response.redirect("/write#handle", 303);
//#endregion
//#region \0virtual:astro:page:src/pages/api/claim@_@ts
var page = () => claim_exports;
//#endregion
export { page };
