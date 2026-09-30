import { t as __exportAll } from "./rolldown-runtime_8H4AJuhK.mjs";
import { A as topics, M as users, n as readyDb, y as posts } from "./db_NRbr6ekn.mjs";
import { and, eq, sql } from "drizzle-orm";
//#region src/pages/api/search-index.ts
var search_index_exports = /* @__PURE__ */ __exportAll({ GET: () => GET });
/**
* The command-palette index.
*
* The palette filters locally in the browser so every keystroke answers in
* under a frame — no per-keystroke request, no debounce dance, no spinner.
* That only works if the index is small enough to fetch once and forget, so
* this endpoint returns the minimum a result row needs: where to go, what to
* call it, and one line of context. Full-text depth stays on /search, which
* the palette links out to.
*
* Cacheable for five minutes. A publish inside that window shows up on the
* next fetch; a stale title for 300 seconds is not worth revalidating on
* every keystroke, and the palette refetches once per page load anyway.
*/
var GET = async () => {
	const rows = await (await readyDb()).select({
		slug: posts.slug,
		title: posts.title,
		dek: posts.dek,
		topic: topics.name,
		minutes: sql`(
        select max(1, round((length(v.body) / 4.6) / 220))
        from post_versions v
        where v.id = posts.current_version_id
      )`
	}).from(posts).innerJoin(users, eq(posts.authorId, users.id)).leftJoin(topics, eq(posts.topicId, topics.id)).where(and(eq(posts.visibility, "public"))).orderBy(posts.publishedAt);
	const payload = {
		v: 1,
		builtAt: Date.now(),
		posts: rows.map((r) => ({
			slug: r.slug,
			title: r.title,
			dek: (r.dek ?? "").replace(/\s+/g, " ").trim().slice(0, 140),
			topic: r.topic ?? null,
			minutes: Number(r.minutes ?? 0)
		}))
	};
	return new Response(JSON.stringify(payload), { headers: {
		"content-type": "application/json",
		"cache-control": "public, max-age=300"
	} });
};
//#endregion
//#region \0virtual:astro:page:src/pages/api/search-index@_@ts
var page = () => search_index_exports;
//#endregion
export { page };
