import { t as __exportAll } from "./rolldown-runtime_8H4AJuhK.mjs";
import { n as readyDb, r as ANNOTATION_KINDS, u as blocks, v as postVersions, y as posts } from "./db_NRbr6ekn.mjs";
import { i as stripInline } from "./inline_YMPn7sV2.mjs";
import { c as createAnnotation, m as makeAnchor, t as getIdentity, v as resolveAnchor } from "./auth_BCgGryh8.mjs";
import { and, eq } from "drizzle-orm";
//#region src/pages/api/annotations.ts
var annotations_exports = /* @__PURE__ */ __exportAll({
	GET: () => GET,
	PATCH: () => PATCH,
	POST: () => POST
});
var MAX_BODY = 4e3;
/** The plain text of one block within one version, or null if it is not there. */
async function blockTextFor(postId, versionId, blockId) {
	return (await (await readyDb()).select({ text: blocks.text }).from(blocks).innerJoin(postVersions, eq(blocks.versionId, postVersions.id)).innerJoin(posts, eq(postVersions.postId, posts.id)).where(and(eq(posts.id, postId), eq(postVersions.id, versionId), eq(blocks.blockId, blockId))).limit(1))[0]?.text ?? null;
}
function bad(message, status = 400) {
	return new Response(JSON.stringify({ error: message }), {
		status,
		headers: { "content-type": "application/json" }
	});
}
async function postOwns(authorId, postId) {
	if (!authorId) return false;
	return (await (await readyDb()).select({ id: posts.id }).from(posts).where(and(eq(posts.id, postId), eq(posts.authorId, authorId))).limit(1)).length > 0;
}
/**
* Create a note. No account required — this is the whole point.
*
* The client sends the *selected text*, not character offsets. The rendered DOM
* has already consumed its inline markup, so DOM offsets and source offsets do
* not correspond, and a client-computed offset would be wrong the moment a
* paragraph contained a code span. The quote-plus-context anchor resolves the
* position server-side against the real block text, which is both correct and
* the reason the anchor stores context at all.
*/
var POST = async ({ request, cookies }) => {
	let payload;
	try {
		payload = await request.json();
	} catch {
		return bad("Expected a JSON body.");
	}
	const postId = typeof payload.postId === "string" ? payload.postId : "";
	const versionId = typeof payload.versionId === "string" ? payload.versionId : "";
	const blockId = typeof payload.blockId === "string" ? payload.blockId : "";
	const body = typeof payload.body === "string" ? payload.body.trim() : "";
	const kind = ANNOTATION_KINDS.includes(payload.kind) ? payload.kind : "comment";
	const quote = typeof payload.quote === "string" ? payload.quote.trim() : "";
	const prefixHint = typeof payload.prefixHint === "string" ? payload.prefixHint : "";
	const suffixHint = typeof payload.suffixHint === "string" ? payload.suffixHint : "";
	const guestName = typeof payload.guestName === "string" ? payload.guestName.trim().slice(0, 40) : null;
	if (!postId || !versionId || !blockId) return bad("Missing post, version or block.");
	if (!body) return bad("A note needs some text.");
	if (body.length > MAX_BODY) return bad(`Keep notes under ${MAX_BODY} characters.`);
	if (quote.length < 2) return bad("Select a sentence to attach the note to.");
	if (quote.length > 600) return bad("That selection is too long. Anchor a sentence, not a section.");
	const identity = await getIdentity(cookies);
	if (!identity.anonId) return bad("No reader session.", 409);
	const blockText = await blockTextFor(postId, versionId, blockId);
	if (blockText === null) return bad("That block is not part of this version of the post.", 409);
	const resolved = resolveAnchor({
		blockId,
		start: 0,
		end: 0,
		quote,
		prefix: prefixHint,
		suffix: suffixHint
	}, stripInline(blockText));
	if (resolved.status === "lost") return bad("That sentence is no longer in this paragraph — it was probably edited. Reload and try again.", 409);
	const anchor = makeAnchor(blockId, blockText, resolved.start, resolved.end);
	if (kind === "author_note" && !await postOwns(identity.userId, postId)) return bad("Only the author of this post can leave an author note.", 403);
	const created = await createAnnotation({
		postId,
		versionId,
		blockId,
		anchor,
		body,
		kind,
		anonId: identity.anonId,
		authorId: identity.userId,
		guestName: guestName || null,
		isPrivate: payload.isPrivate === true
	});
	return new Response(JSON.stringify({
		id: created.id,
		createdAt: created.createdAt,
		anchor: {
			start: resolved.start,
			end: resolved.end
		}
	}), {
		status: 201,
		headers: { "content-type": "application/json" }
	});
};
/** Edit, delete and accept moved to Astro actions in `src/actions/index.ts`.
*
*  They were implemented here first and had no way to be reached: a JSON PATCH
*  endpoint that no server-rendered form pointed at, and no island called
*  either. Being a form action means they work with JavaScript off, which is
*  the only reason a reader can use them at all. */
var PATCH = () => new Response(JSON.stringify({ error: "Use the note actions. They are form posts, so they work without JavaScript." }), {
	status: 405,
	headers: {
		"content-type": "application/json",
		allow: "POST"
	}
});
var GET = () => new Response(JSON.stringify({ error: "POST to create a note." }), {
	status: 405,
	headers: {
		"content-type": "application/json",
		allow: "POST"
	}
});
//#endregion
//#region \0virtual:astro:page:src/pages/api/annotations@_@ts
var page = () => annotations_exports;
//#endregion
export { page };
