import { t as __exportAll } from "./rolldown-runtime_8H4AJuhK.mjs";
import { A as topics, D as savedPosts, S as readReceipts, f as follows, n as readyDb, s as annotations, v as postVersions, y as posts } from "./db_NRbr6ekn.mjs";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
//#region src/lib/repo/reader.ts
var reader_exports = /* @__PURE__ */ __exportAll({
	claimAnonMemory: () => claimAnonMemory,
	getFollowedAuthors: () => getFollowedAuthors,
	getReaderMemory: () => getReaderMemory,
	getSaved: () => getSaved,
	isFollowing: () => isFollowing,
	isSaved: () => isSaved,
	memoryKeyFor: () => memoryKeyFor,
	toggleFollow: () => toggleFollow,
	toggleSaved: () => toggleSaved
});
/**
* Your reading memory, keyed by whoever this browser is.
*
* No account, no gate: the page reads the same anonymous receipts the "changed
* since you read it" banner reads. A claimed handle merges both keys so
* nothing is lost at the moment of claiming — the same promise the margin
* notes already keep. Topics come from what was actually read, not from a
* form, because interest stated on a form is aspiration and interest revealed
* by reading is data.
*/
async function getReaderMemory(anonId, userId) {
	const database = await readyDb();
	const who = userId ? or(eq(readReceipts.anonId, anonId), eq(readReceipts.userId, userId)) : eq(readReceipts.anonId, anonId);
	const reads = await database.select({
		postId: readReceipts.postId,
		versionId: readReceipts.versionId,
		readAt: readReceipts.readAt,
		slug: posts.slug,
		title: posts.title
	}).from(readReceipts).innerJoin(posts, eq(readReceipts.postId, posts.id)).where(who).orderBy(desc(readReceipts.readAt)).limit(50);
	const latest = /* @__PURE__ */ new Map();
	for (const r of reads) if (!latest.has(r.postId)) latest.set(r.postId, r);
	const entries = [];
	for (const r of latest.values()) {
		const [version] = await database.select({ versionNumber: postVersions.versionNumber }).from(postVersions).where(eq(postVersions.id, r.versionId)).limit(1);
		const [current] = await database.select({ n: postVersions.versionNumber }).from(postVersions).where(eq(postVersions.postId, r.postId)).orderBy(desc(postVersions.versionNumber)).limit(1);
		entries.push({
			slug: r.slug,
			title: r.title,
			versionNumber: version?.versionNumber ?? 1,
			currentVersionNumber: current?.n ?? 1,
			behind: (current?.n ?? 1) > (version?.versionNumber ?? 1),
			readAt: r.readAt
		});
	}
	const noteWho = userId ? or(eq(annotations.anonId, anonId), eq(annotations.authorId, userId)) : and(eq(annotations.anonId, anonId), isNull(annotations.authorId));
	return {
		entries,
		notes: await database.select({
			id: annotations.id,
			kind: annotations.kind,
			body: annotations.body,
			isPrivate: annotations.isPrivate,
			createdAt: annotations.createdAt,
			postSlug: posts.slug,
			postTitle: posts.title
		}).from(annotations).innerJoin(posts, eq(annotations.postId, posts.id)).where(and(eq(annotations.status, "visible"), noteWho)).orderBy(desc(annotations.createdAt)).limit(50),
		topics: await database.select({
			name: topics.name,
			slug: topics.slug
		}).from(topics).innerJoin(posts, eq(posts.topicId, topics.id)).innerJoin(readReceipts, eq(readReceipts.postId, posts.id)).where(who).groupBy(topics.id).orderBy(desc(sql`count(*)`)).limit(10),
		saved: await getSaved(memoryKeyFor(userId, anonId)),
		followed: await getFollowedAuthors(memoryKeyFor(userId, anonId))
	};
}
/** The same key convention as reactions: claimed account, else this browser. */
function memoryKeyFor(authorId, anonId) {
	return authorId ? `u:${authorId}` : `a:${anonId}`;
}
async function isFollowing(followerKey, authorId) {
	return (await (await readyDb()).select({ followerKey: follows.followerKey }).from(follows).where(and(eq(follows.followerKey, followerKey), eq(follows.authorId, authorId))).limit(1)).length > 0;
}
async function toggleFollow(followerKey, authorId) {
	const database = await readyDb();
	if (await isFollowing(followerKey, authorId)) {
		await database.delete(follows).where(and(eq(follows.followerKey, followerKey), eq(follows.authorId, authorId)));
		return false;
	}
	await database.insert(follows).values({
		followerKey,
		authorId
	}).onConflictDoNothing();
	return true;
}
async function isSaved(saverKey, postId) {
	return (await (await readyDb()).select({ saverKey: savedPosts.saverKey }).from(savedPosts).where(and(eq(savedPosts.saverKey, saverKey), eq(savedPosts.postId, postId))).limit(1)).length > 0;
}
async function toggleSaved(saverKey, postId) {
	const database = await readyDb();
	if (await isSaved(saverKey, postId)) {
		await database.delete(savedPosts).where(and(eq(savedPosts.saverKey, saverKey), eq(savedPosts.postId, postId)));
		return false;
	}
	await database.insert(savedPosts).values({
		saverKey,
		postId
	}).onConflictDoNothing();
	return true;
}
async function getSaved(saverKey) {
	return (await readyDb()).select({
		slug: posts.slug,
		title: posts.title,
		savedAt: savedPosts.createdAt
	}).from(savedPosts).innerJoin(posts, eq(savedPosts.postId, posts.id)).where(eq(savedPosts.saverKey, saverKey)).orderBy(desc(savedPosts.createdAt)).limit(50);
}
async function getFollowedAuthors(followerKey) {
	const database = await readyDb();
	const { users } = await import("./db_NRbr6ekn.mjs").then((n) => n.O);
	return database.select({
		handle: users.handle,
		displayName: users.displayName
	}).from(follows).innerJoin(users, eq(follows.authorId, users.id)).where(eq(follows.followerKey, followerKey)).orderBy(desc(follows.createdAt)).limit(50);
}
/** Claiming keeps everything: notes, reactions, follows and saves move to the account. */
async function claimAnonMemory(anonId, authorId) {
	const database = await readyDb();
	const from = `a:${anonId}`;
	const to = `u:${authorId}`;
	await database.run(sql`UPDATE OR IGNORE annotation_reactions SET voter_key = ${to} WHERE voter_key = ${from}`);
	await database.run(sql`UPDATE OR IGNORE follows SET follower_key = ${to} WHERE follower_key = ${from}`);
	await database.run(sql`UPDATE OR IGNORE saved_posts SET saver_key = ${to} WHERE saver_key = ${from}`);
}
//#endregion
export { reader_exports as a, memoryKeyFor as i, isFollowing as n, toggleFollow as o, isSaved as r, toggleSaved as s, getReaderMemory as t };
