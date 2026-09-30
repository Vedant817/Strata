import { M as users, g as newsletterSubscribers, n as readyDb, v as postVersions, y as posts } from "./db_NRbr6ekn.mjs";
import { and, desc, eq, gt, sql } from "drizzle-orm";
//#region src/lib/repo/digest.ts
/**
* The weekly digest, §10.4's return hook.
*
* Three posts with a human-written reason each is the aspiration; what ships
* is three posts with an *honest* reason each — "new from @handle" or
* "revised 3×, latest: <summary>". A generated reason that pretends a human
* wrote it would be the engagement-bait §1.1 refuses, so the lines say what
* happened and nothing more. Empty weeks send nothing: "you have 0 new
* posts" is the notification the plan explicitly bans.
*/
async function buildDigest(sinceMs) {
	const database = await readyDb();
	const items = [];
	const fresh = await database.select({
		slug: posts.slug,
		title: posts.title,
		dek: posts.dek,
		authorName: users.displayName,
		publishedAt: posts.publishedAt
	}).from(posts).innerJoin(users, eq(posts.authorId, users.id)).where(and(eq(posts.visibility, "public"), sql`${posts.publishedAt} is not null`, gt(posts.publishedAt, sinceMs))).orderBy(desc(posts.publishedAt)).limit(10);
	for (const p of fresh) items.push({
		slug: p.slug,
		title: p.title,
		dek: p.dek,
		authorName: p.authorName,
		kind: "new",
		detail: `New from ${p.authorName}.`
	});
	const revised = await database.select({
		slug: posts.slug,
		title: posts.title,
		dek: posts.dek,
		authorName: users.displayName,
		versionNumber: postVersions.versionNumber,
		changeSummary: postVersions.changeSummary,
		createdAt: postVersions.createdAt
	}).from(postVersions).innerJoin(posts, eq(postVersions.postId, posts.id)).innerJoin(users, eq(posts.authorId, users.id)).where(and(eq(posts.visibility, "public"), gt(postVersions.versionNumber, 1), gt(postVersions.createdAt, sinceMs))).orderBy(desc(postVersions.createdAt)).limit(10);
	const seen = new Set(items.map((i) => i.slug));
	for (const r of revised) {
		if (seen.has(r.slug)) continue;
		seen.add(r.slug);
		items.push({
			slug: r.slug,
			title: r.title,
			dek: r.dek,
			authorName: r.authorName,
			kind: "revised",
			detail: `Revised to v${r.versionNumber} — ${r.changeSummary}`
		});
	}
	return {
		since: sinceMs,
		items: items.slice(0, 10)
	};
}
function renderDigestText(digest, site) {
	const lines = digest.items.flatMap((item, i) => [
		`${i + 1}. ${item.title} — ${item.detail}`,
		`   ${site}/w/${item.slug}`,
		""
	]);
	return {
		subject: `Strata weekly: ${digest.items.length} ${digest.items.length === 1 ? "post moved" : "posts moved"}`,
		text: [
			"What changed this week on Strata.",
			"",
			...lines,
			"Unsubscribe anytime — reply STOP."
		].join("\n")
	};
}
async function getDigestSubscribers() {
	const rows = await (await readyDb()).select({ email: newsletterSubscribers.email }).from(newsletterSubscribers).orderBy(newsletterSubscribers.createdAt);
	return [...new Set(rows.map((r) => r.email.toLowerCase()))];
}
//#endregion
export { getDigestSubscribers as n, renderDigestText as r, buildDigest as t };
