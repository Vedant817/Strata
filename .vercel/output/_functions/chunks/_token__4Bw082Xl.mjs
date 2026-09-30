import { t as __exportAll } from "./rolldown-runtime_8H4AJuhK.mjs";
import { a as Fragment, d as renderTemplate, f as maybeRenderHead, i as renderComponent, m as addAttribute, w as createAstro } from "./server_DKu4icSC.mjs";
import { t as createComponent } from "./compiler_DeGWR9rg.mjs";
import { u as resolvePrefs } from "./prefs_CLygXapP.mjs";
import { t as $$Base } from "./Base_BucALmBf.mjs";
import { r as plural } from "./format_D0bVmvvo.mjs";
import { i as redeemHandleClaim, t as getIdentity } from "./auth_BCgGryh8.mjs";
//#region src/pages/claim/[token].astro
var _token__exports = /* @__PURE__ */ __exportAll({
	default: () => $$Token,
	file: () => $$file,
	url: () => $$url
});
createAstro("http://localhost:4321");
var $$Token = createComponent(async ($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$Token;
	const { token } = Astro.params;
	const anonId = Astro.cookies.get("strata_anon")?.value ?? crypto.randomUUID();
	const prefs = resolvePrefs(Astro.cookies, anonId);
	let handle = "";
	let notesClaimed = 0;
	let error = "";
	let ok = false;
	if (token) {
		const result = await redeemHandleClaim(token, Astro.cookies);
		if (result.ok) {
			ok = true;
			handle = result.handle;
			notesClaimed = result.notesClaimed;
		} else error = result.error;
	}
	const identity = await getIdentity(Astro.cookies);
	return renderTemplate`${renderComponent($$result, "Base", $$Base, {
		"title": ok ? "Handle claimed" : "Claim that handle",
		"prefs": prefs
	}, { "default": ($$result) => renderTemplate`${maybeRenderHead($$result)}<div class="shell py-16"><div class="max-w-xl">${ok ? renderTemplate`${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`<p class="meta">@${handle}</p><h1 class="mt-3 text-3xl">Handle claimed</h1><p class="mt-5 text-[1.0625rem] leading-relaxed text-ink-2">${notesClaimed > 0 ? `Every note you had written from this browser — ${plural(notesClaimed, "note")} — is now attributed to @${handle}. Nothing was recreated and nothing was orphaned.` : `You are now writing as @${handle}. There were no anonymous notes to attach, which is fine.`}</p><ul class="mt-8 space-y-2"><li><a href="/writing" class="text-ink no-underline hover:text-accent">Read the writing →</a></li><li><a${addAttribute(`/a/${handle}`, "href")} class="text-ink no-underline hover:text-accent">Your author page →</a></li></ul>` })}` : renderTemplate`${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`<h1 class="text-3xl">That link did not work</h1><p class="mt-5 text-[1.0625rem] leading-relaxed text-ink-2">${error}</p><p class="mt-5 text-[0.9375rem] leading-relaxed text-ink-2">${identity.handle ? `You already write as @${identity.handle} on this browser.` : "You can request a fresh one from the write page."}</p><a href="/write#handle" class="mt-6 inline-block border border-ink bg-ink px-3 py-1.5 text-[0.9375rem] text-paper no-underline transition-colors hover:border-accent hover:bg-accent">Back to claiming a handle</a>` })}`}</div></div>` })}`;
}, "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/pages/claim/[token].astro", void 0);
var $$file = "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/pages/claim/[token].astro";
var $$url = "/claim/[token]";
//#endregion
//#region \0virtual:astro:page:src/pages/claim/[token]@_@astro
var page = () => _token__exports;
//#endregion
export { page };
