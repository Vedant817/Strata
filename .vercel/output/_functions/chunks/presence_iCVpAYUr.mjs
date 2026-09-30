import { t as __exportAll } from "./rolldown-runtime_8H4AJuhK.mjs";
import { l as ensureAnonId } from "./prefs_CLygXapP.mjs";
import { b as presenceHeartbeats, n as readyDb } from "./db_NRbr6ekn.mjs";
import { t as getIdentity } from "./auth_BCgGryh8.mjs";
import { i as memoryKeyFor } from "./reader_BL_CGxBC.mjs";
import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
//#region src/lib/repo/presence.ts
/**
* Live presence without Realtime.
*
* §5's "3 people are reading this right now" assumed Supabase Realtime, which
* this stack traded away with the SQLite decision. The replacement is
* deliberately the dumbest thing that works: the open page heartbeats every
* 30 seconds, the count endpoint counts heartbeats fresher than 90 seconds,
* and a periodic delete prunes the rest. No profiles, no followers, no DMs,
* no per-reader anything — the count is the whole feature, and a count can
* never identify anyone. Ambient, not social.
*/
var PRESENCE_TTL_MS = 9e4;
async function heartbeat(anonKey, postId) {
	await (await readyDb()).insert(presenceHeartbeats).values({
		anonKey,
		postId,
		lastSeen: Date.now()
	}).onConflictDoUpdate({
		target: [presenceHeartbeats.anonKey, presenceHeartbeats.postId],
		set: { lastSeen: Date.now() }
	});
}
async function readersNow(postId) {
	const [row] = await (await readyDb()).select({ n: sql`count(*)` }).from(presenceHeartbeats).where(and(eq(presenceHeartbeats.postId, postId), gt(presenceHeartbeats.lastSeen, Date.now() - PRESENCE_TTL_MS)));
	return Number(row?.n ?? 0);
}
async function prunePresence() {
	const database = await readyDb();
	const [row] = await database.select({ n: sql`count(*)` }).from(presenceHeartbeats).where(sql`${presenceHeartbeats.lastSeen} <= ${Date.now() - PRESENCE_TTL_MS}`);
	await database.delete(presenceHeartbeats).where(sql`${presenceHeartbeats.lastSeen} <= ${Date.now() - PRESENCE_TTL_MS}`);
	return Number(row?.n ?? 0);
}
//#endregion
//#region src/pages/api/presence.ts
var presence_exports = /* @__PURE__ */ __exportAll({
	GET: () => GET,
	POST: () => POST
});
/**
* Presence: heartbeat in, count out.
*
* POST records that this browser has this post open; GET returns how many
* browsers do right now. Both anonymous-first — the key is the browser until
* claimed. Failures are silent by design: presence is ambient decoration, and
* a beacon that errors loudly would be worse than one that quietly stops.
*/
var postSchema = z.object({ postId: z.string().min(1).max(100) });
var POST = async ({ request, cookies }) => {
	const identity = await getIdentity(cookies);
	const anonId = ensureAnonId(cookies) || identity.anonId;
	if (!anonId) return new Response(null, { status: 204 });
	let body = null;
	try {
		body = await request.json();
	} catch {
		return new Response(null, { status: 204 });
	}
	const parsed = postSchema.safeParse(body);
	if (!parsed.success) return new Response(null, { status: 204 });
	try {
		await heartbeat(memoryKeyFor(identity.userId, anonId), parsed.data.postId);
		if (Math.random() < .05) prunePresence().catch(() => {});
	} catch {}
	return new Response(null, { status: 204 });
};
var GET = async ({ url }) => {
	const postId = url.searchParams.get("postId") ?? "";
	if (!postId) return new Response(JSON.stringify({ error: "postId required." }), {
		status: 400,
		headers: { "content-type": "application/json" }
	});
	const count = await readersNow(postId).catch(() => 0);
	return new Response(JSON.stringify({ readers: count }), { headers: {
		"content-type": "application/json",
		"cache-control": "no-store"
	} });
};
//#endregion
//#region \0virtual:astro:page:src/pages/api/presence@_@ts
var page = () => presence_exports;
//#endregion
export { page };
