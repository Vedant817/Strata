import { t as __exportAll } from "./rolldown-runtime_8H4AJuhK.mjs";
import { A as topics, M as users, T as readingLists, _ as postLinks, h as listCollaborators, n as readyDb, s as annotations, w as readingListItems, y as posts } from "./db_NRbr6ekn.mjs";
import { t as nanoid } from "./ids_TtqtpDCt.mjs";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
//#region src/lib/repo/collaborators.ts
/** The viewer's effective role on a list, or null if they have no access. */
async function roleFor(listId, viewerUserId) {
	if (!viewerUserId) return null;
	const [row] = await (await readyDb()).select({
		ownerId: readingLists.ownerId,
		role: listCollaborators.role
	}).from(readingLists).leftJoin(listCollaborators, and(eq(listCollaborators.listId, readingLists.id), eq(listCollaborators.userId, viewerUserId))).where(eq(readingLists.id, listId)).limit(1);
	if (!row) return null;
	if (row.ownerId === viewerUserId) return "editor";
	return row.role ?? null;
}
/** Can this viewer add or remove items on the list? */
async function canEdit(listId, viewerUserId) {
	return await roleFor(listId, viewerUserId) === "editor";
}
/** A lighter existence check than `roleFor`, for access gates that only need
*  "is this person attached to the list at all". */
async function isListCollaborator(listId, viewerUserId) {
	const [row] = await (await readyDb()).select({ userId: listCollaborators.userId }).from(listCollaborators).where(and(eq(listCollaborators.listId, listId), eq(listCollaborators.userId, viewerUserId))).limit(1);
	return row !== void 0;
}
async function isOwner(listId, userId) {
	const [row] = await (await readyDb()).select({ ownerId: readingLists.ownerId }).from(readingLists).where(eq(readingLists.id, listId)).limit(1);
	return row?.ownerId === userId;
}
async function getCollaborators(listId) {
	const database = await readyDb();
	const [list] = await database.select({ ownerId: readingLists.ownerId }).from(readingLists).where(eq(readingLists.id, listId)).limit(1);
	if (!list) return [];
	const out = [];
	const [owner] = await database.select({
		handle: users.handle,
		displayName: users.displayName
	}).from(users).where(eq(users.id, list.ownerId)).limit(1);
	if (owner) out.push({
		handle: owner.handle,
		displayName: owner.displayName,
		role: "editor",
		isOwner: true
	});
	const rows = await database.select({
		handle: users.handle,
		displayName: users.displayName,
		role: listCollaborators.role
	}).from(listCollaborators).innerJoin(users, eq(listCollaborators.userId, users.id)).where(eq(listCollaborators.listId, listId));
	for (const r of rows) out.push({
		handle: r.handle,
		displayName: r.displayName,
		role: r.role,
		isOwner: false
	});
	return out;
}
async function addCollaborator(listId, ownerId, handle, role) {
	const database = await readyDb();
	const [list] = await database.select({ ownerId: readingLists.ownerId }).from(readingLists).where(and(eq(readingLists.id, listId), eq(readingLists.ownerId, ownerId))).limit(1);
	if (!list) return {
		ok: false,
		error: "That list is not yours."
	};
	const [target] = await database.select({
		id: users.id,
		handle: users.handle
	}).from(users).where(eq(users.handle, handle.trim().toLowerCase())).limit(1);
	if (!target) return {
		ok: false,
		error: `No account with the handle @${handle}.`
	};
	if (target.id === ownerId) return {
		ok: false,
		error: "You already own this list."
	};
	await database.insert(listCollaborators).values({
		listId,
		userId: target.id,
		role,
		addedById: ownerId
	}).onConflictDoUpdate({
		target: [listCollaborators.listId, listCollaborators.userId],
		set: { role }
	});
	return {
		ok: true,
		handle: target.handle
	};
}
async function removeCollaborator(listId, ownerId, handle) {
	const database = await readyDb();
	if (!await isOwner(listId, ownerId)) return false;
	const [target] = await database.select({ id: users.id }).from(users).where(eq(users.handle, handle.trim().toLowerCase())).limit(1);
	if (!target || target.id === ownerId) return false;
	return ((await database.delete(listCollaborators).where(and(eq(listCollaborators.listId, listId), eq(listCollaborators.userId, target.id)))).rowsAffected ?? 0) > 0;
}
//#endregion
//#region src/lib/repo/taxonomy.ts
var taxonomy_exports = /* @__PURE__ */ __exportAll({
	addListItem: () => addListItem,
	createReadingList: () => createReadingList,
	getAccessibleList: () => getAccessibleList,
	getAuthor: () => getAuthor,
	getGraph: () => getGraph,
	getListShareToken: () => getListShareToken,
	getReadingList: () => getReadingList,
	getStatusCounts: () => getStatusCounts,
	listAll: () => listAll,
	listAuthors: () => listAuthors,
	listReadingLists: () => listReadingLists,
	listTopics: () => listTopics,
	myReadingLists: () => myReadingLists,
	removeListItem: () => removeListItem,
	revokeListShareToken: () => revokeListShareToken,
	rotateListShareToken: () => rotateListShareToken,
	setListVisibility: () => setListVisibility
});
var versionCount = sql`(select count(*) from post_versions where post_versions.post_id = ${posts.id})`;
var annotationTotal = sql`(
  select count(*) from ${annotations}
  where ${annotations.postId} = ${posts.id}
    and ${annotations.status} = 'visible' and ${annotations.isPrivate} = 0
)`;
/**
* Reading time, as a correlated subquery against the post's current version.
*
* Written as a subquery rather than a join so it can be dropped into any
* select that has `posts` in scope. An earlier version joined `post_versions`
* and read `post_versions.body` directly, which failed in the two queries that
* did not need the join. `v` is the only table inside the subquery, so there is
* nothing for the outer reference to be ambiguous with.
*/
var readingMinutes = sql`(
  select max(1, round((length(v.body) / 4.6) / 220))
  from post_versions v
  where v.id = posts.current_version_id
)`;
var baseSelect = {
	id: posts.id,
	slug: posts.slug,
	title: posts.title,
	dek: posts.dek,
	status: posts.status,
	publishedAt: posts.publishedAt,
	updatedAt: posts.updatedAt,
	createdAt: posts.createdAt,
	lastReviewedAt: posts.lastReviewedAt,
	topicId: posts.topicId,
	authorId: posts.authorId,
	annotationTotal,
	versionCount,
	readingMinutes,
	authorHandle: users.handle,
	authorName: users.displayName,
	topicName: topics.name
};
async function listAll(options = {}) {
	const database = await readyDb();
	const statuses = options.includeSeedlings ? [
		"seedling",
		"budding",
		"evergreen",
		"archived"
	] : [
		"seedling",
		"budding",
		"evergreen"
	];
	return database.select(baseSelect).from(posts).innerJoin(users, eq(posts.authorId, users.id)).leftJoin(topics, eq(posts.topicId, topics.id)).where(and(inArray(posts.status, [...statuses]), eq(posts.visibility, "public"))).orderBy(desc(posts.publishedAt));
}
async function listTopics() {
	return await (await readyDb()).select({
		id: topics.id,
		slug: topics.slug,
		name: topics.name,
		blurb: topics.blurb,
		total: sql`(
        select count(*) from posts
        where posts.topic_id = "topics"."id" and posts.visibility = 'public'
      )`
	}).from(topics).orderBy(asc(topics.name));
}
async function listAuthors() {
	return await (await readyDb()).select({
		id: users.id,
		handle: users.handle,
		displayName: users.displayName,
		bio: users.bio,
		total: sql`(
        select count(*) from posts
        where posts.author_id = "users"."id" and posts.visibility = 'public'
      )`,
		revisions: sql`(
        select count(*) from post_versions pv
        join posts p on p.current_version_id = pv.id
        where p.author_id = "users"."id"
      )`
	}).from(users).where(sql`${users.role} in ('author', 'editor')`).orderBy(asc(users.displayName));
}
async function getAuthor(handle) {
	return (await (await readyDb()).select().from(users).where(eq(users.handle, handle)).limit(1))[0] ?? null;
}
async function listReadingLists() {
	const database = await readyDb();
	const lists = await database.select({
		id: readingLists.id,
		slug: readingLists.slug,
		title: readingLists.title,
		description: readingLists.description,
		ownerHandle: users.handle,
		ownerId: readingLists.ownerId,
		isPublic: readingLists.isPublic,
		shareToken: readingLists.shareToken
	}).from(readingLists).innerJoin(users, eq(readingLists.ownerId, users.id)).where(eq(readingLists.isPublic, true)).orderBy(readingLists.createdAt);
	const out = [];
	for (const list of lists) {
		const items = (await database.select({
			ordinal: readingListItems.ordinal,
			note: readingListItems.note,
			slug: posts.slug,
			title: posts.title,
			dek: posts.dek,
			status: posts.status,
			publishedAt: posts.publishedAt,
			readingMinutes,
			authorName: users.displayName
		}).from(readingListItems).innerJoin(posts, eq(readingListItems.postId, posts.id)).innerJoin(users, eq(posts.authorId, users.id)).where(eq(readingListItems.listId, list.id)).orderBy(readingListItems.ordinal)).map((r) => ({
			ordinal: r.ordinal,
			note: r.note,
			post: {
				slug: r.slug,
				title: r.title,
				dek: r.dek,
				status: r.status,
				publishedAt: r.publishedAt,
				readingMinutes: Number(r.readingMinutes ?? 1),
				authorName: r.authorName
			}
		}));
		out.push({
			...list,
			isPublic: Boolean(list.isPublic),
			hasShareLink: Boolean(list.shareToken),
			items
		});
	}
	return out;
}
/**
* One list, with access control.
*
* Public lists open to everyone. A private list opens to exactly two parties:
* its owner, and anyone holding the unguessable `?key=` link. Anything else
* gets null — and the page answers 404, because confirming that a private
* list *exists* would already leak that it does.
*/ async function getAccessibleList(slug, viewerUserId, key) {
	const database = await readyDb();
	const [row] = await database.select({
		id: readingLists.id,
		slug: readingLists.slug,
		title: readingLists.title,
		description: readingLists.description,
		ownerHandle: users.handle,
		ownerId: readingLists.ownerId,
		isPublic: readingLists.isPublic,
		shareToken: readingLists.shareToken
	}).from(readingLists).innerJoin(users, eq(readingLists.ownerId, users.id)).where(eq(readingLists.slug, slug)).limit(1);
	if (!row) return null;
	const collaborator = viewerUserId ? await isListCollaborator(row.id, viewerUserId) : false;
	if (!(row.isPublic || viewerUserId !== null && row.ownerId === viewerUserId || collaborator || key !== null && key !== "" && row.shareToken !== null && key === row.shareToken)) return null;
	const itemRows = await database.select({
		ordinal: readingListItems.ordinal,
		note: readingListItems.note,
		slug: posts.slug,
		title: posts.title,
		dek: posts.dek,
		status: posts.status,
		publishedAt: posts.publishedAt,
		readingMinutes,
		authorName: users.displayName
	}).from(readingListItems).innerJoin(posts, eq(readingListItems.postId, posts.id)).innerJoin(users, eq(posts.authorId, users.id)).where(eq(readingListItems.listId, row.id)).orderBy(readingListItems.ordinal);
	return {
		id: row.id,
		slug: row.slug,
		title: row.title,
		description: row.description,
		ownerHandle: row.ownerHandle,
		ownerId: row.ownerId,
		isPublic: Boolean(row.isPublic),
		hasShareLink: Boolean(row.shareToken),
		items: itemRows.map((r) => ({
			ordinal: r.ordinal,
			note: r.note,
			post: {
				slug: r.slug,
				title: r.title,
				dek: r.dek,
				status: r.status,
				publishedAt: r.publishedAt,
				readingMinutes: Number(r.readingMinutes ?? 1),
				authorName: r.authorName
			}
		}))
	};
}
async function getReadingList(slug) {
	return (await listReadingLists()).find((l) => l.slug === slug) ?? null;
}
async function getGraph() {
	const database = await readyDb();
	const postRows = await database.select({
		id: posts.id,
		slug: posts.slug,
		title: posts.title,
		status: posts.status,
		publishedAt: posts.publishedAt,
		authorHandle: users.handle,
		authorName: users.displayName,
		versionCount,
		forkedFromId: posts.forkedFromId
	}).from(posts).innerJoin(users, eq(posts.authorId, users.id)).where(eq(posts.visibility, "public")).orderBy(asc(posts.publishedAt));
	const linkRows = await database.select().from(postLinks);
	const nodes = postRows.map((p) => ({
		id: p.id,
		slug: p.slug,
		title: p.title,
		status: p.status,
		authorHandle: p.authorHandle,
		authorName: p.authorName,
		publishedAt: p.publishedAt,
		versionCount: Number(p.versionCount ?? 1),
		forks: p.forkedFromId ? 1 : 0
	}));
	const index = new Map(nodes.map((n, i) => [n.id, i]));
	const edges = [];
	for (const l of linkRows) {
		const from = index.get(l.fromPostId);
		const to = index.get(l.toPostId);
		if (from === void 0 || to === void 0) continue;
		edges.push({
			from: l.fromPostId,
			to: l.toPostId,
			type: l.type,
			fromIndex: from,
			toIndex: to
		});
	}
	for (const n of nodes) {
		const parent = postRows.find((p) => p.id === n.id)?.forkedFromId;
		if (!parent) continue;
		const to = index.get(parent);
		if (to === void 0) continue;
		edges.push({
			from: n.id,
			to: parent,
			type: "fork_of",
			fromIndex: index.get(n.id),
			toIndex: to
		});
	}
	return {
		nodes,
		edges
	};
}
/** Status counts, for the front page. */
async function getStatusCounts() {
	const rows = await (await readyDb()).select({
		status: posts.status,
		n: count()
	}).from(posts).where(eq(posts.visibility, "public")).groupBy(posts.status);
	const out = {
		seedling: 0,
		budding: 0,
		evergreen: 0,
		archived: 0
	};
	for (const r of rows) out[r.status] = r.n;
	return out;
}
function listSlugify(title) {
	return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "list";
}
async function createReadingList(ownerId, title, description, isPublic) {
	const clean = title.trim().slice(0, 120);
	if (clean.length < 3) return {
		ok: false,
		error: "Name the list — at least three characters."
	};
	const database = await readyDb();
	const slugBase = listSlugify(clean);
	let slug = slugBase;
	for (let attempt = 0; attempt < 10; attempt++) {
		if ((await database.select({ id: readingLists.id }).from(readingLists).where(eq(readingLists.slug, slug)).limit(1)).length === 0) break;
		slug = `${slugBase}-${nanoid().slice(0, 6)}`;
	}
	const id = nanoid();
	await database.insert(readingLists).values({
		id,
		ownerId,
		slug,
		title: clean,
		description: description.trim().slice(0, 500),
		isPublic
	});
	return {
		ok: true,
		id,
		slug
	};
}
async function setListVisibility(listId, ownerId, isPublic) {
	return (await (await readyDb()).update(readingLists).set({ isPublic }).where(and(eq(readingLists.id, listId), eq(readingLists.ownerId, ownerId))).returning({ id: readingLists.id })).length > 0;
}
/** Issue (or rotate) the share link. Returns the full `?key=` URL path. */
async function rotateListShareToken(listId, ownerId) {
	const database = await readyDb();
	const token = `${nanoid()}${nanoid()}`;
	return (await database.update(readingLists).set({ shareToken: token }).where(and(eq(readingLists.id, listId), eq(readingLists.ownerId, ownerId))).returning({ id: readingLists.id })).length > 0 ? token : null;
}
async function revokeListShareToken(listId, ownerId) {
	return (await (await readyDb()).update(readingLists).set({ shareToken: null }).where(and(eq(readingLists.id, listId), eq(readingLists.ownerId, ownerId))).returning({ id: readingLists.id })).length > 0;
}
async function addListItem(listId, viewerUserId, postId, note) {
	const database = await readyDb();
	if (!await canEdit(listId, viewerUserId)) return {
		ok: false,
		error: "You do not have edit access to that list."
	};
	const [post] = await database.select({ id: posts.id }).from(posts).where(eq(posts.id, postId)).limit(1);
	if (!post) return {
		ok: false,
		error: "That post does not exist."
	};
	if ((await database.select({ id: readingListItems.id }).from(readingListItems).where(and(eq(readingListItems.listId, listId), eq(readingListItems.postId, postId))).limit(1)).length > 0) return {
		ok: false,
		error: "Already on that list."
	};
	const [max] = await database.select({ m: sql`coalesce(max(${readingListItems.ordinal}), -1)` }).from(readingListItems).where(eq(readingListItems.listId, listId));
	await database.insert(readingListItems).values({
		id: nanoid(),
		listId,
		postId,
		ordinal: Number(max?.m ?? -1) + 1,
		note: note.trim().slice(0, 300)
	});
	return { ok: true };
}
async function removeListItem(listId, viewerUserId, postSlug) {
	const database = await readyDb();
	if (!await canEdit(listId, viewerUserId)) return false;
	const [post] = await database.select({ id: posts.id }).from(posts).where(eq(posts.slug, postSlug)).limit(1);
	if (!post) return false;
	await database.delete(readingListItems).where(and(eq(readingListItems.listId, listId), eq(readingListItems.postId, post.id)));
	return true;
}
/** The share token for display, owner only. Null when no link is issued. */
async function getListShareToken(listId, ownerId) {
	const [row] = await (await readyDb()).select({ shareToken: readingLists.shareToken }).from(readingLists).where(and(eq(readingLists.id, listId), eq(readingLists.ownerId, ownerId))).limit(1);
	return row?.shareToken ?? null;
}
/**
* Every list this user can reach from Studio: the ones they own plus the ones
* they were added to as a collaborator. Owned lists keep their management
* controls; a collaborated list is marked so the UI can show the right thing
* and hide the wrong one.
*/
async function myReadingLists(ownerId) {
	const database = await readyDb();
	const lists = await database.select({
		id: readingLists.id,
		slug: readingLists.slug,
		title: readingLists.title,
		isPublic: readingLists.isPublic,
		hasShareLink: sql`${readingLists.shareToken} is not null`,
		isOwner: sql`true`
	}).from(readingLists).where(eq(readingLists.ownerId, ownerId)).orderBy(readingLists.createdAt);
	const shared = await database.select({
		id: readingLists.id,
		slug: readingLists.slug,
		title: readingLists.title,
		isPublic: readingLists.isPublic,
		hasShareLink: sql`${readingLists.shareToken} is not null`,
		isOwner: sql`false`
	}).from(listCollaborators).innerJoin(readingLists, eq(listCollaborators.listId, readingLists.id)).where(eq(listCollaborators.userId, ownerId)).orderBy(readingLists.createdAt);
	const all = [...lists, ...shared];
	const out = [];
	for (const list of all) {
		const [count] = await database.select({ n: sql`count(*)` }).from(readingListItems).where(eq(readingListItems.listId, list.id));
		out.push({
			...list,
			isPublic: Boolean(list.isPublic),
			hasShareLink: Boolean(list.hasShareLink),
			items: Number(count?.n ?? 0)
		});
	}
	return out;
}
//#endregion
export { roleFor as C, removeCollaborator as S, setListVisibility as _, getGraph as a, canEdit as b, getStatusCounts as c, listReadingLists as d, listTopics as f, rotateListShareToken as g, revokeListShareToken as h, getAuthor as i, listAll as l, removeListItem as m, createReadingList as n, getListShareToken as o, myReadingLists as p, getAccessibleList as r, getReadingList as s, addListItem as t, listAuthors as u, taxonomy_exports as v, getCollaborators as x, addCollaborator as y };
