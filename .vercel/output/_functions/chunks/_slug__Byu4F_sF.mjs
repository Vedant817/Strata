import { t as __exportAll } from "./rolldown-runtime_8H4AJuhK.mjs";
import { a as Fragment, d as renderTemplate, f as maybeRenderHead, i as renderComponent, m as addAttribute, w as createAstro } from "./server_DKu4icSC.mjs";
import { t as createComponent } from "./compiler_DeGWR9rg.mjs";
import { u as resolvePrefs } from "./prefs_CLygXapP.mjs";
import { t as $$Base } from "./Base_BucALmBf.mjs";
import { t as getIdentity } from "./auth_BCgGryh8.mjs";
import { u as getPostBySlug, w as blockToPlainText } from "./posts_DKPEGog2.mjs";
import { r as normaliseLang, t as CODE_LANGUAGES } from "./highlight_Bx2_emM9.mjs";
import { r as getDraft, t as draftFromPublished } from "./drafts_DfY_BAiM.mjs";
//#region src/pages/studio/edit/[slug].astro
var _slug__exports = /* @__PURE__ */ __exportAll({
	default: () => $$Slug,
	file: () => $$file,
	url: () => $$url
});
createAstro("http://localhost:4321");
var $$Slug = createComponent(async ($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$Slug;
	const anonId = Astro.cookies.get("strata_anon")?.value ?? crypto.randomUUID();
	const prefs = resolvePrefs(Astro.cookies, anonId);
	const identity = await getIdentity(Astro.cookies);
	const { slug } = Astro.params;
	const post = slug ? await getPostBySlug(slug) : null;
	if (!post || !identity.userId || post.authorId !== identity.userId) return new Response(null, {
		status: 404,
		statusText: "Not found"
	});
	const existing = await getDraft(post.id, identity.userId);
	const seeded = existing ?? await draftFromPublished(post.id, identity.userId);
	if (!seeded) return new Response(null, {
		status: 404,
		statusText: "Not found"
	});
	const doc = seeded;
	const hasDraft = Boolean(existing);
	const studioError = Astro.url.searchParams.get("studioError");
	const saved = Astro.url.searchParams.get("saved") === "1";
	const LAYERS = [
		"core",
		"understand",
		"master"
	];
	const ADDABLE = [
		"paragraph",
		"heading",
		"quote",
		"code",
		"list",
		"callout"
	];
	function blockText(b) {
		if (b.type === "code") return b.code;
		if (b.type === "list") return b.items.join("\n");
		if ("text" in b) return b.text;
		return blockToPlainText(b);
	}
	return renderTemplate`${renderComponent($$result, "Base", $$Base, {
		"title": `Editing · ${doc.title}`,
		"description": `Editing ${doc.title}.`,
		"prefs": prefs,
		"noindex": true
	}, { "default": ($$result) => renderTemplate`${maybeRenderHead($$result)}<header class="shell border-b border-rule py-12"><div class="max-w-2xl"><p class="meta"><a href="/studio" class="no-underline hover:text-ink">Studio</a> · Editing</p><h1 class="mt-3 text-3xl">First loom</h1><ol class="mt-4 space-y-1.5 text-[0.9375rem] leading-relaxed text-ink-2"><li><strong class="font-medium text-ink">1. Change something below</strong> — a sentence, a layer tag, the order.</li><li><strong class="font-medium text-ink">2. Publish with a summary</strong> — one sentence saying what moved and why.</li><li><strong class="font-medium text-ink">3. Read the diff</strong> — publish lands on it. That view is the product.</li></ol>${hasDraft ? renderTemplate`<p class="meta mt-4 text-ochre">Unsaved work from an earlier visit is loaded.</p>` : renderTemplate`<p class="meta mt-4">Showing the published version. Nothing is changed until you save.</p>`}</div></header><div class="shell py-12"><div class="max-w-2xl space-y-14">${studioError && renderTemplate`<div class="border border-danger px-4 py-3" role="alert"><p class="text-[0.9375rem] text-danger">${studioError}</p><p class="meta mt-1">Nothing was changed.</p></div>`}${saved && renderTemplate`<p class="meta border border-pine px-3 py-2 text-pine" role="status">Draft saved. Still private — publish when it earns it.</p>`}<form method="post" action="/api/studio"><input type="hidden" name="action" value="save-draft"><input type="hidden" name="postId"${addAttribute(post.id, "value")}><input type="hidden" name="count"${addAttribute(doc.blocks.length, "value")}><label class="meta" for="ed-title">Title</label><input id="ed-title" name="title"${addAttribute(doc.title, "value")} required${addAttribute(200, "maxlength")} class="mt-1.5 w-full border border-rule bg-paper px-3 py-2 font-serif text-xl focus:border-accent focus:outline-none"><label class="meta mt-4 block" for="ed-dek">Dek</label><input id="ed-dek" name="dek"${addAttribute(doc.dek, "value")}${addAttribute(500, "maxlength")} class="mt-1.5 w-full border border-rule bg-paper px-3 py-2 text-[0.9375rem] focus:border-accent focus:outline-none"><ol class="mt-8 space-y-6">${doc.blocks.map((b, i) => renderTemplate`<li class="border border-rule p-4"><input type="hidden"${addAttribute(`b_${i}_id`, "name")}${addAttribute(b.id, "value")}><div class="flex flex-wrap items-center gap-2"><span class="meta">${i + 1} · ${b.type}</span><span class="ml-auto flex items-center gap-2"><label class="meta"${addAttribute(`b_${i}_order`, "for")}>Order</label><input${addAttribute(`b_${i}_order`, "id")}${addAttribute(`b_${i}_order`, "name")} type="number"${addAttribute(i, "value")}${addAttribute(0, "min")}${addAttribute(doc.blocks.length + 5, "max")} class="w-16 border border-rule bg-paper px-2 py-1 text-[0.8125rem] tabular-nums focus:border-accent focus:outline-none"><label class="meta"${addAttribute(`b_${i}_layer`, "for")}>Layer</label><select${addAttribute(`b_${i}_layer`, "id")}${addAttribute(`b_${i}_layer`, "name")}${addAttribute(b.type === "tldr" || b.type === "primer", "disabled")} class="border border-rule bg-paper px-2 py-1 text-[0.8125rem] focus:border-accent focus:outline-none disabled:opacity-60">${LAYERS.map((l) => renderTemplate`<option${addAttribute(l, "value")}${addAttribute(b.layer === l, "selected")}>${l}</option>`)}</select><label class="meta flex cursor-pointer items-center gap-1.5 text-danger"><input type="checkbox"${addAttribute(`b_${i}_del`, "name")} value="1" class="h-3.5 w-3.5">Delete</label></span></div>${b.type === "paragraph" || b.type === "tldr" ? renderTemplate`<textarea${addAttribute(`b_${i}_text`, "name")}${addAttribute(Math.min(12, Math.max(3, Math.ceil(blockText(b).length / 90))), "rows")}${addAttribute(2e4, "maxlength")} class="mt-2 w-full resize-y border border-rule bg-paper px-3 py-2 text-[0.9375rem] leading-relaxed focus:border-accent focus:outline-none">
                  ${blockText(b)}
                </textarea>` : b.type === "heading" ? renderTemplate`<div class="mt-2 flex gap-2"><select${addAttribute(`b_${i}_level`, "name")} aria-label="Heading level" class="border border-rule bg-paper px-2 py-2 text-[0.875rem] focus:border-accent focus:outline-none"><option value="2"${addAttribute(b.level === 2, "selected")}>H2</option><option value="3"${addAttribute(b.level === 3, "selected")}>H3</option></select><input${addAttribute(`b_${i}_text`, "name")}${addAttribute(b.text, "value")}${addAttribute(500, "maxlength")} class="min-w-0 flex-1 border border-rule bg-paper px-3 py-2 text-[0.9375rem] focus:border-accent focus:outline-none"></div>` : b.type === "quote" ? renderTemplate`${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`<textarea${addAttribute(`b_${i}_text`, "name")}${addAttribute(3, "rows")}${addAttribute(2e4, "maxlength")} class="mt-2 w-full resize-y border border-rule bg-paper px-3 py-2 text-[0.9375rem] leading-relaxed italic focus:border-accent focus:outline-none">
                    ${b.text}
                  </textarea><input${addAttribute(`b_${i}_attr`, "name")}${addAttribute(b.attribution, "value")}${addAttribute(200, "maxlength")} placeholder="Attribution (optional)" aria-label="Quote attribution" class="mt-2 w-full border border-rule bg-paper px-3 py-2 text-[0.875rem] focus:border-accent focus:outline-none">` })}` : b.type === "callout" ? renderTemplate`${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`<div class="mt-2 flex gap-2"><select${addAttribute(`b_${i}_tone`, "name")} aria-label="Callout tone" class="border border-rule bg-paper px-2 py-2 text-[0.875rem] focus:border-accent focus:outline-none"><option value="note"${addAttribute(b.tone === "note", "selected")}>note</option><option value="warn"${addAttribute(b.tone === "warn", "selected")}>warn</option><option value="correction"${addAttribute(b.tone === "correction", "selected")}>correction</option></select><input${addAttribute(`b_${i}_ctitle`, "name")}${addAttribute(b.title, "value")}${addAttribute(300, "maxlength")} placeholder="Title (optional)" aria-label="Callout title" class="min-w-0 flex-1 border border-rule bg-paper px-3 py-2 text-[0.875rem] focus:border-accent focus:outline-none"></div><textarea${addAttribute(`b_${i}_text`, "name")}${addAttribute(3, "rows")}${addAttribute(2e4, "maxlength")} class="mt-2 w-full resize-y border border-rule bg-paper px-3 py-2 text-[0.9375rem] leading-relaxed focus:border-accent focus:outline-none">
                    ${b.text}
                  </textarea>` })}` : b.type === "code" ? renderTemplate`${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${(() => {
		const shownLang = normaliseLang(b.lang);
		return renderTemplate`<div class="mt-2 flex flex-wrap items-end gap-2"><div><label class="meta block"${addAttribute(`b_${i}_lang`, "for")}>Language</label><select${addAttribute(`b_${i}_lang`, "id")}${addAttribute(`b_${i}_lang`, "name")} class="mt-1 w-44 border border-rule bg-paper px-2 py-2 font-mono text-[0.8125rem] focus:border-accent focus:outline-none">${!CODE_LANGUAGES.some((l) => l.value === shownLang) && renderTemplate`<option${addAttribute(shownLang, "value")} selected>${shownLang} (unknown)</option>`}${CODE_LANGUAGES.map((l) => renderTemplate`<option${addAttribute(l.value, "value")}${addAttribute(l.value === shownLang, "selected")}>${l.label}</option>`)}</select></div><p class="meta pb-2">Syntax highlighting is applied when the post is published.</p></div>`;
	})()}<textarea${addAttribute(`b_${i}_code`, "name")}${addAttribute(Math.min(16, Math.max(4, b.code.split("\n").length + 1)), "rows")}${addAttribute(6e4, "maxlength")}${addAttribute(false, "spellcheck")} class="mt-2 w-full resize-y border border-rule bg-paper px-3 py-2 font-mono text-[0.8125rem] leading-relaxed focus:border-accent focus:outline-none">
                    ${b.code}
                  </textarea><input${addAttribute(`b_${i}_caption`, "name")}${addAttribute(b.caption, "value")}${addAttribute(300, "maxlength")} placeholder="Caption (optional)" aria-label="Code caption" class="mt-2 w-full border border-rule bg-paper px-3 py-2 text-[0.875rem] focus:border-accent focus:outline-none">` })}` : b.type === "list" ? renderTemplate`${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`<textarea${addAttribute(`b_${i}_items`, "name")}${addAttribute(Math.min(12, Math.max(2, b.items.length + 1)), "rows")}${addAttribute(2e4, "maxlength")} aria-label="List items, one per line" class="mt-2 w-full resize-y border border-rule bg-paper px-3 py-2 text-[0.9375rem] leading-relaxed focus:border-accent focus:outline-none">
                    ${b.items.join("\n")}
                  </textarea><p class="meta mt-1">One item per line.${b.ordered ? " Ordered." : ""}</p>` })}` : b.type === "primer" ? renderTemplate`${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`<input${addAttribute(`b_${i}_term`, "name")}${addAttribute(b.term, "value")}${addAttribute(200, "maxlength")} aria-label="Primer term" class="mt-2 w-full border border-rule bg-paper px-3 py-2 text-[0.875rem] focus:border-accent focus:outline-none"><textarea${addAttribute(`b_${i}_text`, "name")}${addAttribute(3, "rows")}${addAttribute(2e4, "maxlength")} class="mt-2 w-full resize-y border border-rule bg-paper px-3 py-2 text-[0.9375rem] leading-relaxed focus:border-accent focus:outline-none">
                    ${b.text}
                  </textarea>` })}` : renderTemplate`<p class="mt-2 border-l-2 border-rule-strong pl-3 text-[0.875rem] text-ink-3">${b.type} blocks are preserved as-is for now — this editor edits prose, headings, quotes, callouts, code, lists and primers. ${blockText(b).slice(0, 140)}${blockText(b).length > 140 ? "…" : ""}</p>`}</li>`)}</ol><div class="sticky bottom-0 mt-8 border border-rule-strong bg-surface p-4"><button type="submit" class="w-full border border-ink bg-ink px-3 py-2 text-[0.9375rem] text-paper transition-colors hover:border-accent hover:bg-accent sm:w-auto sm:px-6">Save draft</button><p class="meta mt-2">Private until published. Saving never touches the live post.</p></div></form><section aria-labelledby="add-heading" class="border-t border-rule pt-6"><h2 id="add-heading" class="text-xl">Add a block</h2><form method="post" action="/api/studio" class="mt-3 flex max-w-md gap-2"><input type="hidden" name="action" value="add-block"><input type="hidden" name="postId"${addAttribute(post.id, "value")}><label class="sr-only" for="add-type">Block type</label><select id="add-type" name="blockType" class="min-w-0 flex-1 border border-rule bg-paper px-3 py-2 text-[0.9375rem] focus:border-accent focus:outline-none">${ADDABLE.map((t) => renderTemplate`<option${addAttribute(t, "value")}>${t}</option>`)}</select><button type="submit" class="shrink-0 border border-ink bg-ink px-4 py-2 text-[0.9375rem] text-paper transition-colors hover:border-accent hover:bg-accent">Add</button></form></section><section aria-labelledby="publish-heading" class="border-t border-rule pt-6"><h2 id="publish-heading" class="text-xl">Publish</h2><p class="mt-2 max-w-xl text-[0.9375rem] leading-relaxed text-ink-2">Publishing freezes this draft as a new revision and clears it. The summary is required — it is the entry future readers see in the history, and a revision without one is a gap in the record.</p><form method="post" action="/api/studio" class="mt-4 max-w-xl"><input type="hidden" name="action" value="publish"><input type="hidden" name="postId"${addAttribute(post.id, "value")}><label class="meta" for="pub-summary">What changed, and why</label><input id="pub-summary" name="changeSummary" required${addAttribute(10, "minlength")}${addAttribute(500, "maxlength")} placeholder="Fixed the benchmark — was measuring p50, not p99." class="mt-1.5 w-full border border-rule bg-paper px-3 py-2 text-[0.9375rem] focus:border-accent focus:outline-none"><div class="mt-3 flex flex-wrap items-center gap-3"><label class="meta flex cursor-pointer items-center gap-2"><input type="checkbox" name="isMajor" value="1" class="h-3.5 w-3.5 accent-[var(--accent)]">Major revision</label><button type="submit" class="border border-accent bg-accent px-4 py-2 text-[0.9375rem] text-paper transition-colors hover:opacity-90">Publish revision →</button></div><p class="meta mt-2">Lands on the diff view. That is step three of the loom.</p></form></section></div></div>` })}`;
}, "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/pages/studio/edit/[slug].astro", void 0);
var $$file = "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/pages/studio/edit/[slug].astro";
var $$url = "/studio/edit/[slug]";
//#endregion
//#region \0virtual:astro:page:src/pages/studio/edit/[slug]@_@astro
var page = () => _slug__exports;
//#endregion
export { page };
