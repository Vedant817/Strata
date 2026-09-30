import { t as __exportAll } from "./rolldown-runtime_8H4AJuhK.mjs";
import { a as Fragment, d as renderTemplate, f as maybeRenderHead, i as renderComponent, m as addAttribute, w as createAstro } from "./server_DKu4icSC.mjs";
import { t as createComponent } from "./compiler_DeGWR9rg.mjs";
import { u as resolvePrefs } from "./prefs_CLygXapP.mjs";
import { t as $$Base } from "./Base_BucALmBf.mjs";
import { r as plural, t as ago } from "./format_D0bVmvvo.mjs";
import { t as $$PostRow } from "./PostRow_B0WJeZNZ.mjs";
import { i as getAuthor, l as listAll } from "./taxonomy_CiJ526xn.mjs";
import { t as getIdentity } from "./auth_BCgGryh8.mjs";
import { i as memoryKeyFor, n as isFollowing } from "./reader_BL_CGxBC.mjs";
//#region src/pages/a/[handle].astro
var _handle__exports = /* @__PURE__ */ __exportAll({
	default: () => $$Handle,
	file: () => $$file,
	url: () => $$url
});
createAstro("http://localhost:4321");
var $$Handle = createComponent(async ($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$Handle;
	const { handle } = Astro.params;
	const author = handle ? await getAuthor(handle) : null;
	if (!author) return new Response(null, {
		status: 404,
		statusText: "Not found"
	});
	const anonId = Astro.cookies.get("strata_anon")?.value ?? crypto.randomUUID();
	const prefs = resolvePrefs(Astro.cookies, anonId);
	const identity = await getIdentity(Astro.cookies);
	const following = await isFollowing(memoryKeyFor(identity.userId, anonId), author.id);
	const isSelf = identity.userId === author.id;
	const mine = (await listAll({ includeSeedlings: true })).filter((p) => p.authorId === author.id);
	const totalRevisions = mine.reduce((sum, p) => sum + p.versionCount, 0);
	const revised = mine.filter((p) => p.versionCount > 1);
	const stale = mine.filter((p) => {
		if (!p.lastReviewedAt) return false;
		return Date.now() - p.lastReviewedAt > 15552e6;
	});
	const groups = [
		{
			key: "evergreen",
			label: "Evergreen"
		},
		{
			key: "budding",
			label: "Budding"
		},
		{
			key: "seedling",
			label: "Seedlings"
		},
		{
			key: "archived",
			label: "Archived"
		}
	];
	const jsonLd = [{
		"@type": "Person",
		name: author.displayName,
		description: author.bio
	}, {
		"@type": "ProfilePage",
		mainEntity: {
			"@type": "Person",
			name: author.displayName,
			url: `/a/${author.handle}`
		}
	}];
	return renderTemplate`${renderComponent($$result, "Base", $$Base, {
		"title": author.displayName,
		"description": author.bio || `${author.displayName} writes on Strata.`,
		"prefs": prefs,
		"jsonLd": jsonLd
	}, { "default": ($$result) => renderTemplate`${maybeRenderHead($$result)}<header class="shell border-b border-rule py-12"><div class="max-w-2xl"><p class="meta">Author</p><h1 class="mt-3 text-3xl">${author.displayName}</h1><p class="mt-2 text-[0.9375rem] text-ink-3">@${author.handle}</p>${!isSelf && renderTemplate`<form method="post" action="/api/memory" class="mt-4"><input type="hidden" name="action" value="follow"><input type="hidden" name="authorId"${addAttribute(author.id, "value")}><input type="hidden" name="returnTo"${addAttribute(`/a/${author.handle}`, "value")}><button type="submit"${addAttribute(following, "aria-pressed")}${addAttribute(["border px-3 py-1.5 text-[0.875rem] transition-colors", following ? "border-accent text-accent" : "border-ink bg-ink text-paper hover:border-accent hover:bg-accent"], "class:list")}>${following ? "Following ✓" : "Follow"}</button></form>`}${author.bio && renderTemplate`<p class="mt-5 text-[1.0625rem] leading-relaxed text-ink-2">${author.bio}</p>`}<dl class="mt-8 grid grid-cols-2 gap-x-8 gap-y-5 border-t border-rule pt-6 sm:grid-cols-4"><div><dt class="meta">Published</dt><dd class="mt-1 font-serif text-2xl tabular-nums">${mine.length}</dd></div><div><dt class="meta">Revisions</dt><dd class="mt-1 font-serif text-2xl tabular-nums">${totalRevisions}</dd></div><div><dt class="meta">Revised since</dt><dd class="mt-1 font-serif text-2xl tabular-nums">${revised.length}</dd></div><div><dt class="meta">Not reviewed in 6mo+</dt><dd${addAttribute(["mt-1 font-serif text-2xl tabular-nums", stale.length > 0 && "text-ochre"], "class:list")}>${stale.length}</dd></div></dl><p class="mt-5 text-[0.9375rem] leading-relaxed text-ink-2">The revision count is the point. A follower count measures how many people looked; this measures how many times the author was wrong in public and fixed it, which is the only credibility signal on this site that cannot be faked.${stale.length > 0 && renderTemplate`<span class="text-ochre">${" "}The ochre number is a standing reminder, not a punishment — a post nobody has touched in six months is probably wrong somewhere.</span>`}</p></div></header><div class="shell py-12"><div class="max-w-3xl">${groups.map((group) => {
		const items = mine.filter((p) => p.status === group.key);
		if (items.length === 0) return null;
		return renderTemplate`<section${addAttribute(group.key, "id")} class="mb-12 scroll-mt-24 last:mb-0"><div class="flex flex-wrap items-baseline justify-between gap-3 border-b border-rule pb-3"><h2 class="text-xl">${group.label}</h2><p class="meta">${plural(items.length, "post")}</p></div><div class="mt-5">${items.map((p) => renderTemplate`${renderComponent($$result, "PostRow", $$PostRow, {
			"slug": p.slug,
			"title": p.title,
			"dek": p.dek,
			"status": p.status,
			"publishedAt": p.publishedAt,
			"updatedAt": p.updatedAt,
			"readingMinutes": p.readingMinutes,
			"versionCount": p.versionCount,
			"annotationTotal": p.annotationTotal,
			"topicName": p.topicName
		})}`)}</div></section>`;
	})}${mine.length === 0 && renderTemplate`<p class="text-[0.9375rem] text-ink-3">Nothing published yet. Seedlings count, so this author has not posted anything.</p>`}<p class="mt-12 border-t border-rule pt-6 text-[0.9375rem] text-ink-2">Joined ${ago(author.createdAt)}.${" "}${author.role !== "reader" && renderTemplate`${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`<a href="/write" class="text-ink no-underline hover:text-accent">Writes here →</a>` })}`}</p></div></div>` })}`;
}, "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/pages/a/[handle].astro", void 0);
var $$file = "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/pages/a/[handle].astro";
var $$url = "/a/[handle]";
//#endregion
//#region \0virtual:astro:page:src/pages/a/[handle]@_@astro
var page = () => _handle__exports;
//#endregion
export { page };
