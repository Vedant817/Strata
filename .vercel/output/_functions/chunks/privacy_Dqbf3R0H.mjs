import { t as __exportAll } from "./rolldown-runtime_8H4AJuhK.mjs";
import { d as renderTemplate, f as maybeRenderHead, i as renderComponent, m as addAttribute, w as createAstro } from "./server_DKu4icSC.mjs";
import { t as createComponent } from "./compiler_DeGWR9rg.mjs";
import { u as resolvePrefs } from "./prefs_CLygXapP.mjs";
import { t as $$Base } from "./Base_BucALmBf.mjs";
//#region src/pages/privacy.astro
var privacy_exports = /* @__PURE__ */ __exportAll({
	default: () => $$Privacy,
	file: () => $$file,
	url: () => $$url
});
createAstro("http://localhost:4321");
var $$Privacy = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$Privacy;
	const anonId = Astro.cookies.get("strata_anon")?.value ?? crypto.randomUUID();
	const prefs = resolvePrefs(Astro.cookies, anonId);
	const forgotten = Astro.url.searchParams.get("forgotten") === "1";
	return renderTemplate`${renderComponent($$result, "Base", $$Base, {
		"title": "Privacy",
		"description": "What Strata records, and how to erase it.",
		"prefs": prefs
	}, { "default": ($$result) => renderTemplate`${maybeRenderHead($$result)}<header class="shell border-b border-rule py-12"><div class="max-w-2xl"><h1 class="text-3xl">Privacy</h1><p class="mt-4 text-[1.0625rem] leading-relaxed text-ink-2">This is short because there is not much to disclose. The interesting commitments here are negative ones: things a publication like this normally does that we do not.</p></div></header><div class="shell py-12"><div class="max-w-2xl space-y-12"><section><h2 class="text-xl">What we do not do</h2><ul class="mt-4 space-y-3 border-l border-rule pl-4 text-[1.0625rem] leading-relaxed text-ink-2"><li>No third-party analytics scripts of any kind.</li><li>No advertising technology, and therefore no ad cookies.</li><li>No browser fingerprinting.</li><li>No cross-site tracking pixels, share widgets, or embedded third-party players.</li><li>No selling or brokering of anything about you.</li></ul><p class="mt-4 text-[0.9375rem] leading-relaxed text-ink-2">Because there is no third-party script, there is no consent banner either. Nothing to dismiss.</p></section><section><h2 class="text-xl">What we do record</h2><ul class="mt-4 space-y-3 border-l border-rule pl-4 text-[1.0625rem] leading-relaxed text-ink-2"><li>A random identifier in a first-party cookie, so we can tell you which revision of a post you last read.</li><li>Reading events — that you reached a point in a post, not who you are — used to tell authors where readers struggle.</li><li>Your reading depth, density and theme preferences, which stay in your browser.</li></ul><p class="mt-4 text-[0.9375rem] leading-relaxed text-ink-2">This telemetry is aggregate-only. It is never shown to a writer for a group smaller than twenty readers, and an individual reader is never surfaced to a writer in any form. We do not have a per-reader view of a post for authors to browse, because we think building that product is the wrong thing to do even if it is a good business.</p></section><section id="forget" class="scroll-mt-24"><h2 class="text-xl">Erase everything</h2><p class="mt-3 text-[1.0625rem] leading-relaxed text-ink-2">You can delete every record we hold about your reading — history, receipts and events — in one action. This issues a real database delete; it is not a setting that hides things from you while we keep them.</p>${forgotten ? renderTemplate`<p class="mt-5 border border-pine px-4 py-3 text-[0.9375rem]">Done. Every reading record associated with your browser has been deleted. Your preferences have been reset too, so the next page will use the defaults.</p>` : renderTemplate`<form method="post" action="/api/forget" class="mt-5"><input type="hidden" name="anon"${addAttribute(anonId, "value")}><button type="submit" class="border border-danger px-4 py-2 text-[0.9375rem] text-danger transition-colors hover:bg-danger hover:text-paper">Forget my reading history</button></form>`}</section><section><h2 class="text-xl">Why this is a product decision</h2><p class="mt-3 text-[1.0625rem] leading-relaxed text-ink-2">A publication that wants to show you more of what you read needs a memory of you. The temptation with that memory is to make it a behaviour-tracking instrument, because that is what the ad industry trained everyone to build. We are trying to build the other thing: a record of what you understood, held in a form you can read, correct and delete.</p><p class="mt-3 text-[0.9375rem] leading-relaxed text-ink-2">The way to hold us to that is to keep the delete button working. If it ever stops working, treat that as the most important bug on the site and tell us.</p></section></div></div>` })}`;
}, "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/pages/privacy.astro", void 0);
var $$file = "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/pages/privacy.astro";
var $$url = "/privacy";
//#endregion
//#region \0virtual:astro:page:src/pages/privacy@_@astro
var page = () => privacy_exports;
//#endregion
export { page };
