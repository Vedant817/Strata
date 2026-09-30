import { E as revisionSubscriptions, M as users, n as readyDb, v as postVersions, y as posts } from "./db_NRbr6ekn.mjs";
import { t as nanoid } from "./ids_TtqtpDCt.mjs";
import { and, desc, eq, sql } from "drizzle-orm";
//#region src/lib/repo/subscriptions.ts
/**
* Revision subscriptions: the maintenance flywheel.
*
* The thesis of the product is that a post is not finished when it is
* published, it is maintained — and a maintained post only earns its second
* life if the people who read the first version find out that it changed. So
* this is the loop closing: a reader subscribes to a post with just an email,
* and when a *major* revision lands they hear about it, once.
*
* Two deliberate constraints:
*
* 1. Only major revisions notify. A typo fix is not news, and a subscriber
*    who learns to ignore the email stops reading it, which kills the channel
*    for the one update that mattered.
* 2. One send per version. Idempotency lives in the data — each row remembers
*    the version it was last told about — so re-running the send, or two
*    instances running it at once, cannot double-email.
*/
var EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
function isEmail(v) {
	return v.length > 3 && v.length <= 320 && EMAIL_RE.test(v);
}
async function subscribe(postId, email) {
	await (await readyDb()).insert(revisionSubscriptions).values({
		id: nanoid(),
		postId,
		email: email.trim().toLowerCase()
	}).onConflictDoNothing();
}
async function unsubscribe(postId, email) {
	await (await readyDb()).delete(revisionSubscriptions).where(and(eq(revisionSubscriptions.postId, postId), eq(revisionSubscriptions.email, email.trim().toLowerCase())));
}
/**
* Posts whose *current* version is a recent major revision, and whose
* subscribers have not been told about it yet.
*
* The current-version filter is the important one: revise a post three times
* and notify once, on the version readers are actually looking at. The
* `notified_version_id` guard then makes this re-runnable.
*/
async function pendingNotices(sinceMs) {
	const rows = await (await readyDb()).select({
		postId: posts.id,
		slug: posts.slug,
		title: posts.title,
		authorName: users.displayName,
		versionNumber: postVersions.versionNumber,
		versionId: postVersions.id,
		changeSummary: postVersions.changeSummary,
		createdAt: postVersions.createdAt,
		email: revisionSubscriptions.email,
		notifiedVersionId: revisionSubscriptions.notifiedVersionId
	}).from(revisionSubscriptions).innerJoin(posts, eq(revisionSubscriptions.postId, posts.id)).innerJoin(users, eq(posts.authorId, users.id)).innerJoin(postVersions, eq(posts.currentVersionId, postVersions.id)).where(and(eq(posts.visibility, "public"), eq(postVersions.isMajor, true), sql`${postVersions.versionNumber} > 1`, sql`${postVersions.createdAt} >= ${sinceMs}`, sql`(${revisionSubscriptions.notifiedVersionId} is null or ${revisionSubscriptions.notifiedVersionId} != ${postVersions.id})`)).orderBy(desc(postVersions.createdAt));
	const byPost = /* @__PURE__ */ new Map();
	for (const r of rows) {
		const existing = byPost.get(r.postId);
		if (existing) {
			existing.emails.push(r.email);
			continue;
		}
		byPost.set(r.postId, {
			postId: r.postId,
			slug: r.slug,
			title: r.title,
			authorName: r.authorName,
			versionId: r.versionId,
			versionNumber: r.versionNumber,
			changeSummary: r.changeSummary,
			createdAt: r.createdAt,
			emails: [r.email]
		});
	}
	return [...byPost.values()];
}
/**
* Mark everyone on a post as told about a version. Called only after a
* successful send, so a mailer outage retries next run instead of silently
* consuming the notice.
*/
async function markNotified(postId, versionId) {
	return (await (await readyDb()).update(revisionSubscriptions).set({ notifiedVersionId: versionId }).where(and(eq(revisionSubscriptions.postId, postId), sql`(${revisionSubscriptions.notifiedVersionId} is null or ${revisionSubscriptions.notifiedVersionId} != ${versionId})`))).rowsAffected ?? 0;
}
//#endregion
export { unsubscribe as a, subscribe as i, markNotified as n, pendingNotices as r, isEmail as t };
