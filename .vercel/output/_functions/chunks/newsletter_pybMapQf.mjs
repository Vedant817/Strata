import { t as __exportAll } from "./rolldown-runtime_8H4AJuhK.mjs";
import { g as newsletterSubscribers, n as readyDb } from "./db_NRbr6ekn.mjs";
import { t as nanoid } from "./ids_TtqtpDCt.mjs";
import { r as safeReturnTo } from "./note-actions_CI6lMVYb.mjs";
import { eq } from "drizzle-orm";
import { z } from "zod";
//#region src/pages/api/newsletter.ts
var newsletter_exports = /* @__PURE__ */ __exportAll({
	GET: () => GET,
	POST: () => POST
});
/**
* Newsletter signup. Single opt-in, deduplicated, no theatrics.
*
* What this is: a list of inboxes that asked for the weekly digest. What it
* is not: a sender — delivery needs a scheduler that does not exist here yet,
* and the footer says "one email a week" rather than promising a date. When
* the digest sends, it sends to exactly this table.
*/
var schema = z.object({
	email: z.string().trim().toLowerCase().max(320).refine((v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "That does not look like an email address."),
	returnTo: z.string().optional()
});
var POST = async ({ request, redirect, url }) => {
	const form = await request.formData().catch(() => null);
	const back = safeReturnTo(form?.get("returnTo"), "/");
	const target = new URL(back, url);
	target.searchParams.delete("newsletter");
	const parsed = schema.safeParse(form ? Object.fromEntries(form) : null);
	if (!parsed.success) {
		target.searchParams.set("newsletter", "error");
		return redirect(target.pathname + target.search, 303);
	}
	const database = await readyDb();
	if ((await database.select({ id: newsletterSubscribers.id }).from(newsletterSubscribers).where(eq(newsletterSubscribers.email, parsed.data.email)).limit(1)).length === 0) await database.insert(newsletterSubscribers).values({
		id: nanoid(),
		email: parsed.data.email
	});
	target.searchParams.set("newsletter", "done");
	return redirect(target.pathname + target.search, 303);
};
var GET = () => Response.redirect("/", 303);
//#endregion
//#region \0virtual:astro:page:src/pages/api/newsletter@_@ts
var page = () => newsletter_exports;
//#endregion
export { page };
