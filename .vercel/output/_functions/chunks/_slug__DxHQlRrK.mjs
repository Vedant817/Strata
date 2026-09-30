import { t as __exportAll } from "./rolldown-runtime_8H4AJuhK.mjs";
import { d as renderTemplate, f as maybeRenderHead, i as renderComponent, m as addAttribute, w as createAstro } from "./server_DKu4icSC.mjs";
import { t as createComponent } from "./compiler_DeGWR9rg.mjs";
import { u as resolvePrefs } from "./prefs_CLygXapP.mjs";
import { t as $$Base } from "./Base_BucALmBf.mjs";
import { t as $$PostRow } from "./PostRow_B0WJeZNZ.mjs";
import { C as roleFor, b as canEdit, r as getAccessibleList } from "./taxonomy_CiJ526xn.mjs";
import { t as getIdentity } from "./auth_BCgGryh8.mjs";
//#region src/pages/lists/[slug].astro
var _slug__exports = /* @__PURE__ */ __exportAll({
	default: () => $$Slug,
	file: () => $$file,
	url: () => $$url
});
createAstro("http://localhost:4321");
var $$Slug = createComponent(async ($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$Slug;
	const { slug } = Astro.params;
	const identity = await getIdentity(Astro.cookies);
	const key = Astro.url.searchParams.get("key");
	const list = slug ? await getAccessibleList(slug, identity.userId, key) : null;
	if (!list) return new Response(null, {
		status: 404,
		statusText: "Not found"
	});
	const anonId = Astro.cookies.get("strata_anon")?.value ?? crypto.randomUUID();
	const prefs = resolvePrefs(Astro.cookies, anonId);
	const total = list.items.reduce((sum, i) => sum + (i.post.readingMinutes ?? 0), 0);
	const isOwner = identity.userId !== null && identity.userId === list.ownerId;
	const canEdit$1 = await canEdit(list.id, identity.userId);
	const viewerRole = identity.userId ? await roleFor(list.id, identity.userId) : null;
	return renderTemplate`${renderComponent($$result, "Base", $$Base, {
		"title": list.title,
		"description": list.description,
		"prefs": prefs
	}, { "default": ($$result) => renderTemplate`${maybeRenderHead($$result)}<header class="shell border-b border-rule py-12"><div class="max-w-2xl"><p class="meta">Reading list · ${list.ownerHandle}</p><h1 class="mt-3 text-3xl">${list.title}</h1>${!list.isPublic && renderTemplate`<p class="meta mt-2 inline-block border border-ochre px-2 py-0.5 text-ochre">Private${list.hasShareLink ? " · shared by link" : " · only you"}</p>`}${!isOwner && viewerRole && renderTemplate`<p class="meta mt-2 inline-block border border-rule px-2 py-0.5 text-ink-2">You are a collaborator here (${viewerRole})</p>`}<p class="mt-4 text-[1.0625rem] leading-relaxed text-ink-2">${list.description}</p><p class="meta mt-4">${list.items.length} posts · about ${total} minutes end to end</p></div></header><div class="shell py-12"><ol class="max-w-3xl">${list.items.map((item, i) => renderTemplate`<li>${renderComponent($$result, "PostRow", $$PostRow, {
		"slug": item.post.slug,
		"title": item.post.title,
		"dek": item.post.dek,
		"status": item.post.status,
		"publishedAt": item.post.publishedAt,
		"readingMinutes": item.post.readingMinutes,
		"authorName": item.post.authorName,
		"note": item.note,
		"ordinal": i + 1
	})}${canEdit$1 && renderTemplate`<form method="post" action="/api/lists" class="mb-4 ml-1"><input type="hidden" name="action" value="remove"><input type="hidden" name="listId"${addAttribute(list.id, "value")}><input type="hidden" name="postSlug"${addAttribute(item.post.slug, "value")}><input type="hidden" name="returnTo"${addAttribute(`/lists/${list.slug}`, "value")}><button type="submit" class="meta text-ink-3 hover:text-danger">Remove from list</button></form>`}</li>`)}</ol><p class="mt-12 max-w-2xl border-t border-rule pt-6 text-[0.9375rem] text-ink-2">Reading lists are the primary unit of discovery here. Want to make one?${" "}<a href="/write" class="text-ink no-underline hover:text-accent">Write here →</a></p></div>` })}`;
}, "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/pages/lists/[slug].astro", void 0);
var $$file = "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/pages/lists/[slug].astro";
var $$url = "/lists/[slug]";
//#endregion
//#region \0virtual:astro:page:src/pages/lists/[slug]@_@astro
var page = () => _slug__exports;
//#endregion
export { page };
