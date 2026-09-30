import { t as __exportAll } from "./rolldown-runtime_8H4AJuhK.mjs";
import { a as Fragment, d as renderTemplate, f as maybeRenderHead, i as renderComponent, m as addAttribute, w as createAstro } from "./server_DKu4icSC.mjs";
import { t as createComponent } from "./compiler_DeGWR9rg.mjs";
import { a as DEPTH_COOKIE, i as DEPTHS, n as DENSITIES, o as DEPTH_HINT, r as DENSITY_COOKIE, s as DEPTH_LABEL, u as resolvePrefs } from "./prefs_CLygXapP.mjs";
import { t as $$Base } from "./Base_BucALmBf.mjs";
import { t as getIdentity } from "./auth_BCgGryh8.mjs";
import { l as isByokEnabled, n as listKeys, s as PROVIDERS } from "./providerKeys_Dw83htch.mjs";
import { t as getProfile } from "./readerProfile_BXIp8Gwr.mjs";
//#region src/pages/settings.astro
var settings_exports = /* @__PURE__ */ __exportAll({
	default: () => $$Settings,
	file: () => $$file,
	url: () => $$url
});
createAstro("http://localhost:4321");
var $$Settings = createComponent(async ($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$Settings;
	const identity = await getIdentity(Astro.cookies);
	const anonId = Astro.cookies.get("strata_anon")?.value ?? crypto.randomUUID();
	const cookiePrefs = resolvePrefs(Astro.cookies, anonId);
	const localDepth = Astro.cookies.get(DEPTH_COOKIE)?.value;
	const localDensity = Astro.cookies.get(DENSITY_COOKIE)?.value;
	const profile = identity.userId ? await getProfile(identity.userId) : null;
	const depth = localDepth ?? profile?.depth ?? "understand";
	const density = localDensity ?? profile?.density ?? "comfortable";
	const saved = Astro.url.searchParams.get("saved") === "1";
	const error = Astro.url.searchParams.get("settingsError");
	const keysError = Astro.url.searchParams.get("keysError");
	const keysDone = Astro.url.searchParams.get("keysDone");
	const byokEnabled = isByokEnabled();
	const myKeys = identity.userId ? await listKeys(identity.userId) : [];
	const keyByProvider = new Map(myKeys.map((k) => [k.providerId, k]));
	return renderTemplate`${renderComponent($$result, "Base", $$Base, {
		"title": "Reading settings",
		"description": "How Strata reads to you.",
		"prefs": cookiePrefs
	}, { "default": ($$result) => renderTemplate`${maybeRenderHead($$result)}<div class="shell py-16"><div class="max-w-xl"><p class="meta">Settings</p><h1 class="mt-3 text-3xl">Reading settings</h1><p class="mt-4 text-[1.0625rem] leading-relaxed text-ink-2">These change how every post here renders. They follow you to a new device once you have a handle; without one they stay in this browser.</p>${saved && renderTemplate`<p class="mt-6 border-l-2 border-pine pl-3 text-[0.9375rem] text-pine" role="status">Saved. This device and your account now agree.</p>`}${error && renderTemplate`<p class="mt-6 border border-danger px-3 py-2 text-[0.9375rem] text-danger" role="alert">${error}</p>`}${identity.userId ? renderTemplate`<form method="post" action="/api/settings" class="mt-8 space-y-8"><input type="hidden" name="returnTo" value="/settings"><fieldset><legend class="text-[1.0625rem] font-medium">How deep should I read?</legend><p class="mt-1 text-[0.9375rem] leading-relaxed text-ink-2">The same on every post. You can still change depth per post from the dial on the article.</p><div class="mt-3 space-y-2">${DEPTHS.map((d) => renderTemplate`<label class="flex cursor-pointer items-start gap-3 border border-rule p-3"><input type="radio" name="depth"${addAttribute(d, "value")}${addAttribute(depth === d, "checked")} class="mt-1 accent-[var(--accent)]"><span><span class="block font-medium">${DEPTH_LABEL[d]}</span><span class="mt-0.5 block text-[0.875rem] text-ink-2">${DEPTH_HINT[d]}</span></span></label>`)}</div></fieldset><fieldset><legend class="text-[1.0625rem] font-medium">How much space?</legend><p class="mt-1 text-[0.9375rem] leading-relaxed text-ink-2">Line height and measure. Compact fits more of a long argument on a screen.</p><div class="mt-3 flex flex-wrap gap-2">${DENSITIES.map((d) => renderTemplate`<label class="flex cursor-pointer items-center gap-2 border border-rule px-3 py-2"><input type="radio" name="density"${addAttribute(d, "value")}${addAttribute(density === d, "checked")} class="accent-[var(--accent)]"><span class="text-[0.9375rem] capitalize">${d}</span></label>`)}</div></fieldset><button type="submit" class="border border-ink bg-ink px-4 py-2 text-[0.9375rem] text-paper transition-colors hover:border-accent hover:bg-accent">Save settings</button></form>` : renderTemplate`<div class="mt-8 border border-rule p-4"><p class="text-[0.9375rem] leading-relaxed text-ink-2">You are reading anonymously, which is fine — your settings live in this browser. Claim a handle and they will follow you to the next device.</p><p class="mt-3"><a href="/write" class="text-[0.9375rem] text-ink no-underline hover:text-accent">Set your depth once →</a></p></div>`}<section class="mt-14 border-t border-rule pt-8" aria-labelledby="keys-heading"><h2 id="keys-heading" class="text-xl">Your own model keys</h2><p class="mt-2 text-[0.9375rem] leading-relaxed text-ink-2">Ask is extractive by default and needs no key at all — the answer is always quotes from the post, which cannot hallucinate and costs nothing. Add a key and a model summarizes those same quotes. Your key is encrypted before it is stored, never shown again, and used only for your own questions.</p><p class="meta mt-2">A ChatGPT Plus subscription is not an API key — OpenAI bills API usage separately. Use a platform key.</p>${!identity.userId && renderTemplate`<p class="mt-4 border border-rule p-4 text-[0.9375rem] text-ink-2"><a href="/write" class="text-ink no-underline hover:text-accent">Claim a handle →</a>${" "}to store a key. Keys are tied to an account so they can be revoked.</p>`}${identity.userId && !byokEnabled && renderTemplate`<p class="mt-4 border border-ochre p-4 text-[0.9375rem] text-ochre" role="alert">Bring-your-own-key is switched off: this server has no KEY_ENCRYPTION_SECRET, so a key cannot be stored safely. Ask still works, extractively.</p>`}${keysError && renderTemplate`<p class="mt-4 border border-danger px-3 py-2 text-[0.9375rem] text-danger" role="alert">${keysError}</p>`}${keysDone && renderTemplate`<p class="mt-4 border-l-2 border-pine pl-3 text-[0.9375rem] text-pine" role="status">${keysDone}</p>`}${identity.userId && byokEnabled && renderTemplate`<ul class="mt-6 space-y-4">${PROVIDERS.map((p) => {
		const stored = keyByProvider.get(p.id);
		return renderTemplate`<li class="border border-rule p-4"><div class="flex flex-wrap items-baseline gap-x-3 gap-y-1"><span class="font-medium">${p.label}</span>${stored ? renderTemplate`<span class="meta">key ending ${stored.hint} · fingerprint ${stored.fingerprint.slice(0, 8)}${stored.model ? ` · ${stored.model}` : ""}</span>` : renderTemplate`<span class="meta">no key</span>`}</div><p class="mt-1.5 text-[0.875rem] leading-relaxed text-ink-2">${p.note}</p><form method="post" action="/api/keys" class="mt-3 flex flex-wrap items-end gap-2"><input type="hidden" name="returnTo" value="/settings">${stored ? renderTemplate`${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`<input type="hidden" name="action" value="remove"><input type="hidden" name="providerId"${addAttribute(p.id, "value")}><button type="submit" class="border border-rule px-3 py-2 text-[0.875rem] text-ink-2 transition-colors hover:border-danger hover:text-danger">Delete key</button>` })}` : renderTemplate`${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`<input type="hidden" name="action" value="add"><input type="hidden" name="providerId"${addAttribute(p.id, "value")}><div class="min-w-0 flex-1"><label class="meta block"${addAttribute(`key-${p.id}`, "for")}>API key</label><input${addAttribute(`key-${p.id}`, "id")} name="apiKey" type="password" required autocomplete="off"${addAttribute(false, "spellcheck")} placeholder="paste your key" class="mt-1 w-full border border-rule bg-paper px-3 py-2 font-mono text-[0.8125rem] focus:border-accent focus:outline-none"></div><button type="submit" class="shrink-0 border border-ink bg-ink px-3 py-2 text-[0.875rem] text-paper transition-colors hover:border-accent hover:bg-accent">Save</button>` })}`}</form></li>`;
	})}</ul>`}</section></div></div>` })}`;
}, "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/pages/settings.astro", void 0);
var $$file = "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/pages/settings.astro";
var $$url = "/settings";
//#endregion
//#region \0virtual:astro:page:src/pages/settings@_@astro
var page = () => settings_exports;
//#endregion
export { page };
