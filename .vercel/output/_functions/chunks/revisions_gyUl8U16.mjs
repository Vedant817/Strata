import { t as __exportAll } from "./rolldown-runtime_8H4AJuhK.mjs";
import { n as sendMail, t as isMailConfigured } from "./mail_DxMsbSXU.mjs";
import { n as markNotified, r as pendingNotices } from "./subscriptions_BILT-nEZ.mjs";
//#region src/pages/api/cron/revisions.ts
var revisions_exports = /* @__PURE__ */ __exportAll({
	GET: () => GET,
	POST: () => POST
});
/**
* Send revision notices. The maintenance flywheel's delivery step.
*
* Same secret-gated shape as the digest: a scheduler has no browser and no
* handle, so this is a POST with a bearer token, and without CRON_SECRET it
* 401s rather than running open.
*
* Two rules, from the plan:
*   - Only a *major* revision notifies (handled in the query). A typo fix is
*     not news, and a subscriber who learns to ignore the mail stops reading.
*   - The send is idempotent per (post, version), enforced in the data. If the
*     mailer is down, `markNotified` is never reached, so the notice is
*     retried next run instead of being silently consumed.
*/
function authorized(request) {
	const secret = process.env.CRON_SECRET;
	if (!secret) return false;
	const header = request.headers.get("authorization") ?? "";
	const query = new URL(request.url).searchParams.get("secret") ?? "";
	return header === `Bearer ${secret}` || query !== "" && query === secret;
}
function render(n, site) {
	return {
		subject: `Revised: ${n.title}`,
		text: [
			`${n.authorName} revised "${n.title}" — ${n.changeSummary}`,
			"",
			`${site}/w/${n.slug}`,
			"",
			"You asked to hear when this post changed. This is that.",
			"To stop hearing about it, unsubscribe from the post page."
		].join("\n")
	};
}
var POST = async ({ request }) => {
	if (!authorized(request)) return new Response(JSON.stringify({ error: "Unauthorized." }), {
		status: 401,
		headers: { "content-type": "application/json" }
	});
	const since = Date.now() - 12096e5;
	const notices = await pendingNotices(since);
	if (notices.length === 0) return new Response(JSON.stringify({
		sent: 0,
		posts: 0,
		reason: "No un-notified major revisions."
	}), { headers: { "content-type": "application/json" } });
	if (!isMailConfigured()) return new Response(JSON.stringify({
		sent: 0,
		posts: notices.length,
		reason: "No RESEND_API_KEY configured. Notices built but not sent.",
		pending: notices.map((n) => n.slug)
	}), { headers: { "content-type": "application/json" } });
	const site = new URL(request.url).origin;
	let sent = 0;
	const done = [];
	for (const n of notices) {
		const { subject, text } = render(n, site);
		let allOk = true;
		for (const to of n.emails) if ((await sendMail({
			to,
			subject,
			text
		})).ok) sent++;
		else allOk = false;
		if (allOk) {
			await markNotified(n.postId, n.versionId);
			done.push(n.slug);
		}
	}
	return new Response(JSON.stringify({
		sent,
		posts: done.length,
		slugs: done
	}), { headers: { "content-type": "application/json" } });
};
var GET = () => new Response(JSON.stringify({ error: "POST with the cron secret." }), {
	status: 405,
	headers: {
		"content-type": "application/json",
		allow: "POST"
	}
});
//#endregion
//#region \0virtual:astro:page:src/pages/api/cron/revisions@_@ts
var page = () => revisions_exports;
//#endregion
export { page };
