import { a as DEPTH_COOKIE, r as DENSITY_COOKIE } from "./prefs_CLygXapP.mjs";
import { M as users, a as annotationReactions, i as AUTHOR_ONLY_KINDS, k as sessions, n as readyDb, o as annotationReports, p as handleClaims, s as annotations, y as posts } from "./db_NRbr6ekn.mjs";
import { t as nanoid } from "./ids_TtqtpDCt.mjs";
import { i as stripInline } from "./inline_YMPn7sV2.mjs";
import { and, asc, desc, eq, gt, inArray as inArray$1, isNull, lt, sql } from "drizzle-orm";
//#region src/lib/repo/annotations.ts
/**
* Marginalia.
*
* Two rules govern everything here:
*
*  1. A note stores the quoted text with its surrounding context, not a bare
*     character offset. Offsets break silently on the first revision.
*  2. A note is pinned to the version it was written against. If the sentence
*     it argues with has changed, the note says so and links to the version it
*     belongs to — it never silently re-attaches to different prose.
*/
var CONTEXT = 64;
function makeAnchor(blockId, text, start, end) {
	return {
		blockId,
		start,
		end,
		quote: text.slice(start, end),
		prefix: text.slice(Math.max(0, start - CONTEXT), start),
		suffix: text.slice(end, end + CONTEXT)
	};
}
function resolveAnchor(anchor, text) {
	const { quote, prefix, suffix, start, end } = anchor;
	if (!quote) return {
		status: "lost",
		start: 0,
		end: 0
	};
	if (start >= 0 && end <= text.length && text.slice(start, end) === quote) return {
		status: "exact",
		start,
		end
	};
	const haystack = text;
	const hits = [];
	let from = 0;
	for (;;) {
		const at = haystack.indexOf(quote, from);
		if (at === -1) break;
		hits.push(at);
		from = at + 1;
	}
	if (hits.length === 0) return {
		status: "lost",
		start: 0,
		end: 0
	};
	if (hits.length === 1) return {
		status: "moved",
		start: hits[0],
		end: hits[0] + quote.length
	};
	const scored = hits.map((at) => {
		const before = text.slice(Math.max(0, at - prefix.length), at);
		const after = text.slice(at + quote.length, at + quote.length + suffix.length);
		let score = 0;
		for (let i = 1; i <= Math.min(before.length, prefix.length); i++) if (prefix[prefix.length - i] === before[before.length - i]) score++;
		else break;
		for (let i = 0; i < Math.min(after.length, suffix.length); i++) if (suffix[i] === after[i]) score++;
		else break;
		return {
			at,
			score
		};
	}).sort((a, b) => b.score - a.score);
	return {
		status: "moved",
		start: scored[0].at,
		end: scored[0].at + quote.length
	};
}
var reactionCounts = sql`
  (select coalesce(json_group_object(kind, n), '{}') from (
     select kind, count(*) as n from annotation_reactions
     where annotation_id = ${annotations.id} group by kind
   ))`;
var replyCounts = sql`
  (select count(*) from annotations r
   where r.parent_id = ${annotations.id} and r.status = 'visible')`;
/**
* All public notes on a post, newest first, with anchors resolved against the
* given block texts. Replies are attached to their parent in the caller.
*/
async function listAnnotations(postId, blockTexts, opts = { currentVersionId: "" }) {
	return (await (await readyDb()).select({
		note: annotations,
		authorHandle: users.handle,
		authorName: users.displayName,
		pinnedVersion: sql`(
        select version_number from post_versions pv where pv.id = ${annotations.versionId}
      )`,
		reactions: reactionCounts,
		replies: replyCounts
	}).from(annotations).leftJoin(users, eq(annotations.authorId, users.id)).where(and(eq(annotations.postId, postId), eq(annotations.status, "visible"), eq(annotations.isPrivate, false))).orderBy(asc(annotations.createdAt))).map((row) => {
		const parsed = safeAnchor(row.note.anchor);
		const text = stripInline(blockTexts.get(row.note.blockId) ?? "");
		const resolved = parsed ? resolveAnchor(parsed, text) : {
			status: "lost",
			start: 0,
			end: 0
		};
		const isAuthor = Boolean(row.note.authorId && row.note.authorId === opts.authorId);
		const isAuthorOnly = AUTHOR_ONLY_KINDS.includes(row.note.kind);
		return {
			id: row.note.id,
			postId: row.note.postId,
			blockId: row.note.blockId,
			kind: row.note.kind,
			body: row.note.body,
			anchor: parsed ?? {
				blockId: row.note.blockId,
				start: 0,
				end: 0,
				quote: "",
				prefix: "",
				suffix: ""
			},
			resolved,
			onOlderRevision: row.note.versionId !== opts.currentVersionId && resolved.status !== "lost",
			isAccepted: row.note.isAccepted,
			isResolved: row.note.isResolved,
			isPrivate: row.note.isPrivate,
			createdAt: row.note.createdAt,
			editedAt: row.note.editedAt,
			parentId: row.note.parentId,
			authorId: row.note.authorId,
			authorName: isAuthorOnly && !row.note.authorId ? "Anonymous" : row.authorName ?? row.note.guestName ?? "Anonymous",
			authorHandle: row.authorHandle,
			isAuthor,
			isMine: Boolean(row.note.authorId && opts.authorId && row.note.authorId === opts.authorId || row.note.anonId && opts.anonId && row.note.anonId === opts.anonId),
			versionNumber: Number(row.pinnedVersion ?? 1),
			reactions: {
				useful: 0,
				insightful: 0,
				source: 0,
				...row.reactions ?? {}
			},
			replies: Number(row.replies ?? 0)
		};
	}).filter((n) => {
		if (AUTHOR_ONLY_KINDS.includes(n.kind) && !n.isAuthor) return false;
		return true;
	});
}
function safeAnchor(json) {
	try {
		const parsed = JSON.parse(json);
		if (typeof parsed.quote !== "string" || typeof parsed.blockId !== "string") return null;
		return {
			blockId: parsed.blockId,
			start: parsed.start ?? 0,
			end: parsed.end ?? 0,
			quote: parsed.quote,
			prefix: parsed.prefix ?? "",
			suffix: parsed.suffix ?? ""
		};
	} catch {
		return null;
	}
}
async function getAnnotation(id) {
	return (await (await readyDb()).select().from(annotations).where(eq(annotations.id, id)).limit(1))[0] ?? null;
}
async function createAnnotation(input) {
	const database = await readyDb();
	const row = {
		id: nanoid(),
		postId: input.postId,
		versionId: input.versionId,
		blockId: input.blockId,
		anchor: JSON.stringify(input.anchor),
		body: input.body,
		kind: input.kind,
		parentId: input.parentId ?? null,
		authorId: input.authorId ?? null,
		anonId: input.anonId ?? null,
		guestName: input.guestName ?? null,
		isPrivate: input.isPrivate ?? false,
		createdAt: Date.now()
	};
	await database.insert(annotations).values(row);
	return row;
}
async function editAnnotation(id, body, authorId, anonId) {
	const database = await readyDb();
	const existing = await getAnnotation(id);
	if (!existing) return false;
	if (!(authorId && existing.authorId === authorId || !authorId && existing.anonId === anonId)) return false;
	await database.update(annotations).set({
		body,
		editedAt: Date.now()
	}).where(eq(annotations.id, id));
	return true;
}
async function deleteAnnotation(id, opts) {
	const database = await readyDb();
	const existing = await getAnnotation(id);
	if (!existing) return false;
	if (!(opts.authorId && existing.authorId === opts.authorId || !opts.authorId && existing.anonId === opts.anonId)) return false;
	await database.update(annotations).set({ status: "deleted" }).where(eq(annotations.id, id));
	return true;
}
/** Author accepts a note; it is folded into the post's history as an amendment.
*
*  Authorization is the caller's job, because only the caller knows which post
*  the note belongs to. This used to re-check `note.authorId === postAuthorId`,
*  which is the wrong question entirely: it asked whether the *note's* author is
*  the *post's* author, so the only note an author could ever accept was one of
*  their own — precisely the case acceptance exists to exclude. */
async function acceptAnnotation(id) {
	const database = await readyDb();
	if (!await getAnnotation(id)) return false;
	await database.update(annotations).set({
		isAccepted: true,
		isResolved: true
	}).where(eq(annotations.id, id));
	return true;
}
/** A reply to an existing note.
*
*  The reply inherits its parent's anchor rather than carrying one of its own.
*  A reply is a response to that specific sentence, not a fresh claim about the
*  post, and a second anchor would let a thread drift away from the prose it is
*  arguing about — which is the one thing the margin rail exists to prevent. */
async function replyToAnnotation(input) {
	const parent = await getAnnotation(input.parentId);
	if (!parent || parent.status !== "visible") return {
		ok: false,
		error: "The note you replied to is gone."
	};
	const anchor = safeAnchor(parent.anchor);
	if (!anchor) return {
		ok: false,
		error: "That note has lost its anchor, so it cannot be replied to."
	};
	return {
		ok: true,
		id: (await createAnnotation({
			postId: parent.postId,
			versionId: parent.versionId,
			blockId: parent.blockId,
			anchor,
			body: input.body,
			kind: "comment",
			anonId: input.anonId,
			authorId: input.authorId,
			parentId: input.parentId
		})).id
	};
}
/** A stable key for whoever is reacting: the claimed account if there is one,
*  otherwise this browser's anonymous id. */
function voterKeyFor(authorId, anonId) {
	return authorId ? `u:${authorId}` : `a:${anonId}`;
}
async function toggleReaction(annotationId, voterKey, kind) {
	const database = await readyDb();
	if ((await database.select().from(annotationReactions).where(and(eq(annotationReactions.annotationId, annotationId), eq(annotationReactions.voterKey, voterKey), eq(annotationReactions.kind, kind))).limit(1)).length > 0) {
		await database.delete(annotationReactions).where(and(eq(annotationReactions.annotationId, annotationId), eq(annotationReactions.voterKey, voterKey), eq(annotationReactions.kind, kind)));
		return false;
	}
	await database.insert(annotationReactions).values({
		annotationId,
		voterKey,
		kind
	}).onConflictDoNothing();
	return true;
}
/** Which of the three reactions this reader has already given, per note. */ async function myReactions(voterKey, noteIds) {
	if (noteIds.length === 0) return /* @__PURE__ */ new Set();
	const rows = await (await readyDb()).select({
		annotationId: annotationReactions.annotationId,
		kind: annotationReactions.kind
	}).from(annotationReactions).where(and(eq(annotationReactions.voterKey, voterKey), inArray$1(annotationReactions.annotationId, noteIds)));
	return new Set(rows.map((r) => `${r.annotationId}:${r.kind}`));
}
/** Attach every anonymous note from this browser to a claimed account. */
async function claimAnonNotes(anonId, authorId) {
	const database = await readyDb();
	const before = await database.select({ id: annotations.id }).from(annotations).where(and(eq(annotations.anonId, anonId), isNull(annotations.authorId)));
	await database.update(annotations).set({ authorId }).where(and(eq(annotations.anonId, anonId), isNull(annotations.authorId)));
	return before.length;
}
/** Distinct note authors, for the "N people are arguing here" line. */
async function countParticipants(postId) {
	const [row] = await (await readyDb()).select({ n: sql`count(distinct coalesce(annotations.author_id, annotations.anon_id))` }).from(annotations).where(and(eq(annotations.postId, postId), eq(annotations.status, "visible"), eq(annotations.isPrivate, false)));
	return Number(row?.n ?? 0);
}
/** File a report. One per reporter per note — piling on is not moderation. */
async function reportAnnotation(noteId, reporterKey, reason) {
	const clean = reason.trim().slice(0, 500);
	if (!clean) return {
		ok: false,
		error: "Say why, in a few words."
	};
	const database = await readyDb();
	const note = await getAnnotation(noteId);
	if (!note || note.status !== "visible") return {
		ok: false,
		error: "That note is gone."
	};
	if ((await database.select({ id: annotationReports.id }).from(annotationReports).where(and(eq(annotationReports.annotationId, noteId), eq(annotationReports.reporterKey, reporterKey))).limit(1)).length === 0) await database.insert(annotationReports).values({
		id: nanoid(),
		annotationId: noteId,
		reporterKey,
		reason: clean
	});
	return { ok: true };
}
/** Notes on this author's posts that readers flagged, most-reported first. */
async function getReportedNotes(authorId) {
	return (await (await readyDb()).select({
		id: annotations.id,
		postId: annotations.postId,
		postSlug: posts.slug,
		postTitle: posts.title,
		body: annotations.body,
		kind: annotations.kind,
		status: annotations.status,
		reports: sql`count(${annotationReports.id})`,
		latestReason: sql`max(${annotationReports.reason})`
	}).from(annotations).innerJoin(posts, eq(annotations.postId, posts.id)).innerJoin(annotationReports, eq(annotationReports.annotationId, annotations.id)).where(eq(posts.authorId, authorId)).groupBy(annotations.id).orderBy(sql`count(${annotationReports.id}) DESC`)).map((r) => ({
		...r,
		reports: Number(r.reports)
	}));
}
/** Hide or restore a note. Only the post's author — checked here, not trusted. */
async function setNoteStatus(noteId, authorId, status) {
	const database = await readyDb();
	const note = await getAnnotation(noteId);
	if (!note) return false;
	const [post] = await database.select({ authorId: posts.authorId }).from(posts).where(eq(posts.id, note.postId)).limit(1);
	if (!post || post.authorId !== authorId) return false;
	await database.update(annotations).set({ status }).where(eq(annotations.id, noteId));
	return true;
}
//#endregion
//#region src/lib/repo/auth.ts
/**
* Identity, anonymous-first.
*
* The reading loop never asks for an account. A random first-party id is enough
* to read, to set your depth, and to write a margin note — the note is signed by
* the browser, not by a login. Claiming a handle is a separate, deferred action
* that upgrades existing anonymous notes to an attributed identity.
*
* There are no passwords. A handle is a name you attach to your notes, not a
* credential, which means it cannot be phished and cannot be used to take over
* an account.
*/
var SESSION_COOKIE = "strata_session";
var SESSION_DAYS = 30;
var CLAIM_MINUTES = 20;
var EMPTY = {
	userId: null,
	handle: null,
	displayName: null,
	isAuthor: false
};
async function getIdentity(cookies) {
	const anonId = cookies.get("strata_anon")?.value ?? "";
	const token = cookies.get(SESSION_COOKIE)?.value;
	if (!token) return {
		anonId,
		...EMPTY
	};
	const database = await readyDb();
	const row = (await database.select({
		userId: users.id,
		handle: users.handle,
		displayName: users.displayName,
		role: users.role,
		expiresAt: sessions.expiresAt
	}).from(sessions).innerJoin(users, eq(sessions.userId, users.id)).where(eq(sessions.token, token)).limit(1))[0];
	if (!row) return {
		anonId,
		...EMPTY
	};
	if (row.expiresAt < Date.now()) {
		await database.delete(sessions).where(eq(sessions.token, token));
		return {
			anonId,
			...EMPTY
		};
	}
	return {
		anonId,
		userId: row.userId,
		handle: row.handle,
		displayName: row.displayName,
		isAuthor: row.role === "author" || row.role === "editor"
	};
}
async function createSession(userId, cookies) {
	const database = await readyDb();
	const token = nanoid() + nanoid();
	const expiresAt = Date.now() + SESSION_DAYS * 864e5;
	await database.insert(sessions).values({
		token,
		userId,
		expiresAt,
		createdAt: Date.now()
	});
	cookies.set(SESSION_COOKIE, token, {
		path: "/",
		httpOnly: true,
		sameSite: "lax",
		maxAge: SESSION_DAYS * 86400
	});
	return token;
}
var HANDLE_RE = /^[a-z0-9][a-z0-9_-]{2,23}$/i;
async function requestHandleClaim(input) {
	const database = await readyDb();
	const handle = input.handle.trim().toLowerCase();
	if (!HANDLE_RE.test(handle)) return {
		ok: false,
		error: "A handle is 3 to 24 characters: letters, numbers, dash or underscore."
	};
	if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email.trim())) return {
		ok: false,
		error: "That does not look like an email address."
	};
	if (!input.anonId) return {
		ok: false,
		error: "No browser session to attach these notes to."
	};
	if ((await database.select({ id: users.id }).from(users).where(eq(users.handle, handle)).limit(1)).length > 0) return {
		ok: false,
		error: `The handle "${handle}" is already taken.`
	};
	const token = `${nanoid()}${nanoid()}`;
	const expiresAt = Date.now() + CLAIM_MINUTES * 6e4;
	await database.insert(handleClaims).values({
		id: nanoid(),
		handle,
		email: input.email.trim().toLowerCase(),
		anonId: input.anonId,
		token,
		expiresAt,
		createdAt: Date.now()
	});
	return {
		ok: true,
		token,
		expiresAt,
		existing: false
	};
}
async function redeemHandleClaim(token, cookies) {
	const database = await readyDb();
	const claim = (await database.select().from(handleClaims).where(and(eq(handleClaims.token, token), isNull(handleClaims.redeemedAt))).limit(1))[0];
	if (!claim) return {
		ok: false,
		error: "That link has already been used, or never existed."
	};
	if (claim.expiresAt < Date.now()) return {
		ok: false,
		error: "That link has expired. Request a new one."
	};
	const now = Date.now();
	let userId = (await database.select().from(users).where(eq(users.handle, claim.handle)).limit(1))[0]?.id;
	if (!userId) {
		userId = `u_${claim.handle}`;
		try {
			await database.insert(users).values({
				id: userId,
				email: claim.email,
				handle: claim.handle,
				displayName: claim.handle,
				bio: "",
				role: "reader",
				createdAt: now
			});
		} catch {
			const taken = (await database.select({ handle: users.handle }).from(users).where(eq(users.email, claim.email)).limit(1))[0]?.handle;
			return {
				ok: false,
				error: taken ? `That email already has the handle @${taken}. Claim from a browser signed in as them, or use a different email.` : "That handle could not be created. Ask for a new link and try again."
			};
		}
	}
	const notesClaimed = await claimAnonNotes(claim.anonId, userId);
	const { claimAnonMemory } = await import("./reader_BL_CGxBC.mjs").then((n) => n.a);
	await claimAnonMemory(claim.anonId, userId);
	await database.update(handleClaims).set({ redeemedAt: now }).where(eq(handleClaims.id, claim.id));
	await createSession(userId, cookies);
	const depth = cookies.get(DEPTH_COOKIE)?.value;
	const density = cookies.get(DENSITY_COOKIE)?.value;
	if (depth || density) {
		const { saveProfile } = await import("./readerProfile_BXIp8Gwr.mjs").then((n) => n.n);
		await saveProfile(userId, {
			...depth ? { depth } : {},
			...density ? { density } : {}
		});
	}
	return {
		ok: true,
		handle: claim.handle,
		notesClaimed
	};
}
/** A pending claim for this browser, if any — used to show a reminder. */
async function getPendingClaim(anonId) {
	if (!anonId) return null;
	return (await (await readyDb()).select().from(handleClaims).where(and(eq(handleClaims.anonId, anonId), isNull(handleClaims.redeemedAt), gt(handleClaims.expiresAt, Date.now()))).orderBy(desc(handleClaims.createdAt)).limit(1))[0] ?? null;
}
/** Housekeeping: drop expired claims. Called opportunistically, not on a cron. */
async function pruneClaims() {
	await (await readyDb()).delete(handleClaims).where(lt(handleClaims.expiresAt, Date.now() - 864e5));
}
//#endregion
export { reportAnnotation as _, requestHandleClaim as a, toggleReaction as b, createAnnotation as c, getAnnotation as d, getReportedNotes as f, replyToAnnotation as g, myReactions as h, redeemHandleClaim as i, deleteAnnotation as l, makeAnchor as m, getPendingClaim as n, acceptAnnotation as o, listAnnotations as p, pruneClaims as r, countParticipants as s, getIdentity as t, editAnnotation as u, resolveAnchor as v, voterKeyFor as x, setNoteStatus as y };
