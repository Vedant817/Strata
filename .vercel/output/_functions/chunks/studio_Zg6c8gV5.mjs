import { t as __exportAll } from "./rolldown-runtime_8H4AJuhK.mjs";
import { a as Fragment, d as renderTemplate, f as maybeRenderHead, i as renderComponent, m as addAttribute, w as createAstro } from "./server_DKu4icSC.mjs";
import { t as createComponent } from "./compiler_DeGWR9rg.mjs";
import { u as resolvePrefs } from "./prefs_CLygXapP.mjs";
import { t as $$Base } from "./Base_BucALmBf.mjs";
import { r as plural, t as ago } from "./format_D0bVmvvo.mjs";
import { t as $$StatusBadge } from "./StatusBadge_wg3zFwEI.mjs";
import { o as getListShareToken, p as myReadingLists, x as getCollaborators } from "./taxonomy_CiJ526xn.mjs";
import { f as getReportedNotes, t as getIdentity } from "./auth_BCgGryh8.mjs";
import { n as getDigestSubscribers, t as buildDigest } from "./digest_Sua1Myrr.mjs";
import { l as getPostById, w as blockToPlainText, y as suggestLinks } from "./posts_DKPEGog2.mjs";
import { c as synthesizeInbox, i as myPostHealth, n as getOpenAsks, r as listCaptures } from "./studio_B88tlfqA.mjs";
import { n as featuresOfBlocks, r as readVoice, t as driftScore } from "./voice_J-TKh2RN.mjs";
//#region src/lib/lint.ts
/**
* Citation-presence lint, §7.
*
* A claim that asserts a number, a percentage, or a date with nothing to
* point at is the thing that makes technical writing decay — and it is the
* cheapest thing in the whole product to catch, because the lint is
* mechanical. It is deliberately *not* a fact-checker: it never claims a
* claim is wrong, only that nothing in the post supports it, and every hit is
* phrased as a question a writer can dismiss in one click.
*
* Two passes, because the two failure modes look nothing alike:
*   - hard claims (numbers, percentages, durations) with no citation
*   - claims with a citation to *this* post's own vocabulary but no link
*
* The false-positive rate is the whole design risk, so every rule is
* conservative and the findings are advisory. A lint that cries wolf gets
* deleted, and then nothing is checked at all.
*/
/** Words that introduce a quantified assertion. Deliberately short list. */
var QUANTIFIERS = [
	/\d+\s*%/,
	/\b\d{2,}\s?(?:ms|s|kb|mb|gb|tb|x)\b/i,
	/\b(?:in|within|after|about|roughly|approximately)\s+\d+\s*(?:ms|s|m|h|d|min|hour|day|week|month|year)/i,
	/\b\d+\s*(?:times|×)\b/i
];
/** Universals, but only where they assert something about the world rather
*  than describing code or using ordinary prose. "every subsequent get" is a
*  statement about a function; "nobody can now state what the system is
*  allowed to do" is a claim about a team. Without this distinction the
*  absolute rule fires on almost every paragraph and the lint gets deleted. */
var UNIVERSALS = /\b(?:always|never|everyone|nobody|no one)\b/i;
/** Definitions of the term being introduced, not assertions about the world.
*  "A p99 is the value that 99% of requests came in under" needs no citation
*  — it *is* the citation. */
var DEFINITION = /\bis (?:the|a|an|just|exactly)\b[^.]{0,60}\b(?:value|term|means|refers|denotes)\b/i;
var DEFINITION_PREFIX = /^(?:a|an|the)\s+[a-z0-9-]{1,20}\s+is\s+/i;
/** A source is present if the post links out, or cites a prior revision of itself. */
var CITATION = /\[([^\]]*)\]\(https?:\/\/[^)]+\)|https?:\/\/\S+|@cite|footnote/i;
function lintCitations(body) {
	const findings = [];
	let claimsChecked = 0;
	let citationsFound = 0;
	body.forEach((block, index) => {
		if ([
			"heading",
			"code",
			"figure",
			"table",
			"tldr",
			"primer"
		].includes(block.type)) return;
		const raw = blockToPlainText(block);
		if (!raw.trim()) return;
		const text = raw.replace(/`[^`]*`/g, " ").replace(/\s+/g, " ").trim();
		if (!text) return;
		const hasCitation = CITATION.test(text);
		if (hasCitation) citationsFound++;
		const isDefinition = DEFINITION.test(text) || DEFINITION_PREFIX.test(text);
		for (const rule of QUANTIFIERS) {
			if (isDefinition) break;
			const match = text.match(rule);
			if (!match) continue;
			claimsChecked++;
			if (hasCitation) break;
			findings.push({
				blockId: block.id,
				blockIndex: index,
				kind: "uncited_number",
				severity: "advisory",
				quote: excerpt(text, match.index ?? 0, match[0].length),
				detail: "A number with no source in this post. If it came from a benchmark, say which."
			});
			break;
		}
		if (!hasCitation && !isDefinition) {
			const universal = text.match(UNIVERSALS);
			if (universal) {
				claimsChecked++;
				findings.push({
					blockId: block.id,
					blockIndex: index,
					kind: "absolute_claim",
					severity: "advisory",
					quote: excerpt(text, universal.index ?? 0, universal[0].length),
					detail: "An absolute claim with nothing to point at. Either soften it or cite what supports it."
				});
			}
		}
	});
	return {
		findings,
		claimsChecked,
		citationsFound
	};
}
function excerpt(text, at, len) {
	const from = Math.max(0, at - 40);
	const to = Math.min(text.length, at + len + 40);
	return `${from > 0 ? "…" : ""}${text.slice(from, to).replace(/\s+/g, " ").trim()}${to < text.length ? "…" : ""}`;
}
//#endregion
//#region src/pages/studio.astro
var studio_exports = /* @__PURE__ */ __exportAll({
	default: () => $$Studio,
	file: () => $$file,
	url: () => $$url
});
createAstro("http://localhost:4321");
var $$Studio = createComponent(async ($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$Studio;
	const anonId = Astro.cookies.get("strata_anon")?.value ?? crypto.randomUUID();
	const prefs = resolvePrefs(Astro.cookies, anonId);
	const identity = await getIdentity(Astro.cookies);
	const studioError = Astro.url.searchParams.get("studioError");
	const captures = identity.userId ? await listCaptures(identity.userId, "inbox") : [];
	const seeds = identity.userId ? await listCaptures(identity.userId, "seed") : [];
	const health = identity.userId ? await myPostHealth(identity.userId) : [];
	const lintByPost = /* @__PURE__ */ new Map();
	if (identity.userId) for (const post of health) {
		const full = await getPostById(post.id);
		if (full) lintByPost.set(post.id, lintCitations(full.blocks));
	}
	const openAsksByPost = /* @__PURE__ */ new Map();
	if (identity.userId) for (const post of health.filter((p) => p.openAsks > 0).slice(0, 5)) openAsksByPost.set(post.id, await getOpenAsks(post.id, identity.userId));
	const flagged = identity.userId ? await getReportedNotes(identity.userId) : [];
	const digestPreview = identity.userId ? {
		...await buildDigest(Date.now() - 6048e5),
		subscribers: (await getDigestSubscribers()).length
	} : {
		items: [],
		subscribers: 0
	};
	const ownedLists = identity.userId ? await myReadingLists(identity.userId) : [];
	const collaboratorsByList = {};
	for (const list of ownedLists.filter((l) => l.isOwner)) collaboratorsByList[list.id] = await getCollaborators(list.id);
	const linkSuggestions = /* @__PURE__ */ new Map();
	if (identity.userId) for (const post of health.slice(0, 10)) {
		const suggestions = await suggestLinks(post.id, identity.userId, 3);
		if (suggestions.length > 0) linkSuggestions.set(post.id, suggestions);
	}
	const sharedListId = Astro.url.searchParams.get("shared");
	let sharedLink = null;
	if (identity.userId && sharedListId) {
		const token = await getListShareToken(sharedListId, identity.userId);
		if (token) {
			const target = ownedLists.find((l) => l.id === sharedListId);
			if (target) sharedLink = `/lists/${target.slug}?key=${token}`;
		}
	}
	let voice = null;
	let voiceDrift = null;
	let voiceLatestSlug = null;
	if (identity.userId) {
		const { users } = await import("./db_NRbr6ekn.mjs").then((n) => n.O);
		const { readyDb } = await import("./db_NRbr6ekn.mjs").then((n) => n.t);
		const { eq } = await import("drizzle-orm");
		const [row] = await (await readyDb()).select({ toneVector: users.toneVector }).from(users).where(eq(users.id, identity.userId)).limit(1);
		voice = readVoice(row?.toneVector ?? null);
		const newest = health[0];
		if (voice && newest) {
			const full = await getPostById(newest.id);
			if (full) {
				voiceDrift = driftScore(voice, featuresOfBlocks(full.blocks));
				voiceLatestSlug = newest.slug;
			}
		}
	}
	const synthGroups = identity.userId && captures.length >= 2 ? synthesizeInbox(captures.map((c) => ({
		id: c.id,
		body: c.body
	}))) : [];
	const SOURCES = [
		"scratchpad",
		"clip",
		"share",
		"voice",
		"screenshot"
	];
	return renderTemplate`${renderComponent($$result, "Base", $$Base, {
		"title": "Studio",
		"description": "Capture fragments, graduate them to posts, and see which writing needs attention.",
		"prefs": prefs
	}, { "default": ($$result) => renderTemplate`${maybeRenderHead($$result)}<header class="shell border-b border-rule py-12"><div class="max-w-2xl"><p class="meta">Writer studio</p><h1 class="mt-3 text-3xl">Studio</h1>${!identity.userId && renderTemplate`<p class="mt-4 text-[1.0625rem] leading-relaxed text-ink-2">Studio belongs to a named writer — it holds your fragments, your drafts and your readers' unanswered questions, and none of that has anywhere to live until you${" "}<a href="/write#handle" class="text-ink no-underline hover:text-accent">claim a handle →</a></p>`}${identity.userId && renderTemplate`<p class="mt-4 text-[1.0625rem] leading-relaxed text-ink-2">Writing as <strong class="font-medium">@${identity.handle}</strong>. Capture first, publish when it earns it.</p>`}</div></header>${identity.userId && renderTemplate`<div class="shell py-12"><div class="max-w-2xl space-y-14">${studioError && renderTemplate`<div class="border border-danger px-4 py-3" role="alert"><p class="text-[0.9375rem] text-danger">${studioError}</p><p class="meta mt-1">Nothing was changed.</p></div>`}<section aria-labelledby="loom-heading"><h2 id="loom-heading" class="text-xl">First loom</h2><p class="mt-2 text-[0.9375rem] leading-relaxed text-ink-2">The loop the whole product is about, as a checklist. Each item is computed from what actually happened — nothing here can be checked off by visiting a page, because a tour completed is not a thing learned.</p><ol class="mt-4 space-y-3">${(() => {
		const published = health.length > 0;
		const revised = health.some((p) => p.versionCount > 1);
		const noted = health.some((p) => p.notes > 0);
		const first = health[0];
		const steps = [
			{
				done: published,
				title: "Publish something",
				detail: published ? `${plural(health.length, "post")} live.` : "Grow a fragment above, import an archive, or fork a post you wish existed.",
				href: published ? void 0 : "#capture-heading"
			},
			{
				done: revised,
				title: "Revise it",
				detail: revised ? "At least one post has a post-publish revision. That is the maintenance flywheel turning." : first ? "Open your newest post in the editor, change a sentence, and publish with a summary." : "Needs a published post first.",
				href: !revised && first ? `/studio/edit/${first.slug}` : void 0
			},
			{
				done: noted,
				title: "Earn a margin note",
				detail: noted ? "A reader argued with a specific sentence. Reply from the margin." : "Cannot be forced — but posts with a live diff and an honest dek get read, and read posts get argued with.",
				href: void 0
			}
		];
		const doneCount = steps.filter((s) => s.done).length;
		return renderTemplate`${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`<p class="meta mb-1" role="status">${doneCount} of ${steps.length} woven${doneCount === steps.length ? " — loom complete." : ""}</p>${steps.map((s) => renderTemplate`<li class="flex items-start gap-3 border border-rule p-3"><span aria-hidden="true" class="mt-0.5 font-mono text-[0.875rem]">${s.done ? "✓" : "○"}</span><div class="min-w-0"><p class="text-[0.9375rem] font-medium">${s.title}</p><p class="mt-0.5 text-[0.875rem] leading-relaxed text-ink-2">${s.detail}</p>${s.href && !s.done && renderTemplate`<p class="meta mt-1.5"><a${addAttribute(s.href, "href")} class="no-underline hover:text-ink">Start →</a></p>`}</div></li>`)}` })}`;
	})()}</ol></section><section aria-labelledby="capture-heading"><h2 id="capture-heading" class="text-xl">Capture</h2><p class="mt-2 text-[0.9375rem] leading-relaxed text-ink-2">The bottleneck is noticing, not publishing. Get the fragment down in seconds; decide what it becomes later.</p><form method="post" action="/api/studio" class="mt-4 border border-rule p-4"><input type="hidden" name="action" value="capture"><label class="meta" for="capture-body">New fragment</label><textarea id="capture-body" name="body"${addAttribute(3, "rows")}${addAttribute(4e3, "maxlength")} required placeholder="The sentence you do not want to lose…" class="mt-1.5 w-full resize-y border border-rule bg-paper px-3 py-2 text-[0.9375rem] leading-relaxed focus:border-accent focus:outline-none"></textarea><div class="mt-3 flex flex-wrap items-center justify-between gap-3"><label class="meta flex items-center gap-2">Source<select name="source" class="border border-rule bg-paper px-2 py-1 text-[0.75rem] focus:border-accent focus:outline-none">${SOURCES.map((s) => renderTemplate`<option${addAttribute(s, "value")}>${s}</option>`)}</select></label><button type="submit" class="border border-ink bg-ink px-3 py-1.5 text-[0.875rem] text-paper transition-colors hover:border-accent hover:bg-accent">Capture it</button></div></form>${captures.length === 0 && seeds.length === 0 ? renderTemplate`<p class="mt-4 border-l-2 border-rule-strong pl-3 text-[0.9375rem] text-ink-2">Inbox empty. The first fragment is the hardest; after that this list is the reason the next post starts itself.</p>` : renderTemplate`<ol class="mt-4 space-y-3">${[...seeds, ...captures].map((c) => renderTemplate`<li class="border border-rule p-3"><p class="text-[0.9375rem] leading-relaxed">${c.body}</p><div class="meta mt-2 flex flex-wrap items-center gap-x-3 gap-y-1"><span>${c.source}</span><span aria-hidden="true">·</span><span>${ago(c.capturedAt)}</span>${c.state === "seed" && renderTemplate`<span aria-hidden="true">·</span>`}${c.state === "seed" && renderTemplate`<span class="text-pine">seed</span>`}<span class="ml-auto flex items-center gap-2">${c.state === "inbox" && renderTemplate`<form method="post" action="/api/studio" class="contents"><input type="hidden" name="action" value="state"><input type="hidden" name="id"${addAttribute(c.id, "value")}><input type="hidden" name="to" value="seed"><button type="submit" class="hover:text-ink">keep</button></form>`}<form method="post" action="/api/studio" class="contents"><input type="hidden" name="action" value="promote"><input type="hidden" name="id"${addAttribute(c.id, "value")}><button type="submit" class="hover:text-ink">${c.promotedPostId ? "open draft →" : "grow into a seedling →"}</button></form><form method="post" action="/api/studio" class="contents"><input type="hidden" name="action" value="state"><input type="hidden" name="id"${addAttribute(c.id, "value")}><input type="hidden" name="to" value="discarded"><button type="submit" class="hover:text-danger">discard</button></form></span></div></li>`)}</ol>`}</section>${synthGroups.length > 0 && renderTemplate`<section aria-labelledby="synthesis-heading"><h2 id="synthesis-heading" class="text-xl">Taking shape</h2><p class="mt-2 text-[0.9375rem] leading-relaxed text-ink-2">Fragments using the same unusual words are usually two halves of one post trying to happen. Grow a group when it earns it; leave the rest — forcing unrelated fragments together is how synthesis becomes slop.</p><ol class="mt-4 space-y-4">${synthGroups.map((g, gi) => renderTemplate`<li class="border border-rule p-4"><p class="meta">${g.ids.length} fragments · on ${g.shared.join(", ")}</p><ul class="mt-2 space-y-1.5">${g.bodies.map((b, bi) => renderTemplate`<li class="border-l-2 border-rule-strong pl-2 text-[0.875rem] leading-relaxed text-ink-2">${b.length > 220 ? `${b.slice(0, 220)}…` : b}${bi < g.bodies.length - 1 && renderTemplate`<span class="sr-only">;</span>`}</li>`)}</ul><form method="post" action="/api/studio" class="mt-3"><input type="hidden" name="action" value="grow"><input type="hidden" name="ids"${addAttribute(g.ids.join(","), "value")}><button type="submit" class="border border-ink bg-ink px-3 py-1.5 text-[0.875rem] text-paper transition-colors hover:border-accent hover:bg-accent">Grow group ${gi + 1} into a seedling →</button></form></li>`)}</ol></section>`}<section aria-labelledby="attention-heading"><h2 id="attention-heading" class="text-xl">Needs attention</h2><p class="mt-2 text-[0.9375rem] leading-relaxed text-ink-2">Ordered by neglect: unanswered reader questions first, then stalest review. Maintenance is the product, so this list is the homepage.</p>${health.length === 0 ? renderTemplate`<p class="mt-4 border-l-2 border-rule-strong pl-3 text-[0.9375rem] text-ink-2">No posts yet. Grow something from the inbox above.</p>` : renderTemplate`<ol class="mt-4 space-y-4">${health.map((post) => renderTemplate`<li class="border border-rule p-4"><div class="flex flex-wrap items-center gap-x-3 gap-y-1">${renderComponent($$result, "StatusBadge", $$StatusBadge, { "status": post.status })}${post.openAsks > 0 && renderTemplate`<span class="meta text-ochre">${plural(post.openAsks, "unanswered question")}</span>`}</div><h3 class="mt-2 text-lg"><a${addAttribute(`/w/${post.slug}`, "href")} class="no-underline hover:text-accent">${post.title}</a></h3><p class="meta mt-1.5">${post.versionCount} ${post.versionCount === 1 ? "version" : "versions"} ·${" "}${plural(post.notes, "note")} ·${" "}${post.staleDays === null ? "never reviewed" : post.staleDays === 0 ? "reviewed today" : `reviewed ${post.staleDays}d ago`}</p>${post.staleDays !== null && renderTemplate`<p class="mt-1.5"><a${addAttribute(`/studio/readers/${post.slug}`, "href")} class="meta no-underline text-ink-3 hover:text-ink">where readers get to →</a></p>`}${lintByPost.get(post.id).findings.length > 0 && renderTemplate`<details class="note-disclosure mt-2"><summary class="meta cursor-pointer text-ink-3 hover:text-ink">${lintByPost.get(post.id).findings.length} claim${lintByPost.get(post.id).findings.length === 1 ? "" : "s"} without a source</summary><ul class="mt-2 space-y-2">${lintByPost.get(post.id).findings.map((f) => renderTemplate`<li class="border-l-2 border-ochre pl-2"><p class="text-[0.875rem] leading-relaxed text-ink-2">${f.quote}</p><p class="meta mt-1">${f.detail}</p></li>`)}</ul><p class="meta mt-2">${lintByPost.get(post.id).claimsChecked} claims checked ·${lintByPost.get(post.id).citationsFound} with sources. Advisory, not a fact-check.</p></details>`}${(openAsksByPost.get(post.id) ?? []).length > 0 && renderTemplate`<ul class="mt-3 space-y-2 border-t border-rule pt-3">${(openAsksByPost.get(post.id) ?? []).map((q) => renderTemplate`<li class="text-[0.875rem] leading-relaxed text-ink-2"><span class="text-ochre">“${q.question}”</span>${" "}<span class="meta">· asked ${ago(q.createdAt)}</span></li>`)}</ul>`}<div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-rule pt-3"><form method="post" action="/api/studio" class="contents"><input type="hidden" name="action" value="reviewed"><input type="hidden" name="postId"${addAttribute(post.id, "value")}><button type="submit" class="meta text-ink-3 hover:text-ink">Mark reviewed — still true</button></form>${post.status !== "evergreen" && renderTemplate`<form method="post" action="/api/studio" class="contents"><input type="hidden" name="action" value="reviewed"><input type="hidden" name="postId"${addAttribute(post.id, "value")}><input type="hidden" name="status"${addAttribute(post.status === "seedling" ? "budding" : "evergreen", "value")}><button type="submit" class="meta text-pine hover:text-ink">Graduate to ${post.status === "seedling" ? "budding" : "evergreen"}</button></form>`}<details class="note-disclosure"><summary class="meta cursor-pointer text-ink-3 hover:text-ink">Link</summary><form method="post" action="/api/studio" class="mt-2 flex flex-wrap items-center gap-2"><input type="hidden" name="action" value="link"><input type="hidden" name="fromPostId"${addAttribute(post.id, "value")}><label class="sr-only"${addAttribute(`link-to-${post.id}`, "for")}>Link to post slug</label><input${addAttribute(`link-to-${post.id}`, "id")} name="toSlug" required${addAttribute(120, "maxlength")} placeholder="other-post-slug" class="min-w-0 flex-1 border border-rule bg-paper px-2 py-1 text-[0.8125rem] focus:border-accent focus:outline-none"><select name="type" aria-label="Link type" class="border border-rule bg-paper px-2 py-1 text-[0.8125rem] focus:border-accent focus:outline-none"><option value="cites">cites</option><option value="extends">extends</option><option value="contradicts">contradicts</option><option value="mentions">mentions</option></select><button type="submit" class="border border-ink bg-ink px-2 py-1 text-[0.8125rem] text-paper transition-colors hover:border-accent hover:bg-accent">Add</button></form></details></div></li>`)}</ol>`}</section><section aria-labelledby="voice-heading"><h2 id="voice-heading" class="text-xl">Voice</h2>${!voice ? renderTemplate`${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`<p class="mt-2 text-[0.9375rem] leading-relaxed text-ink-2">No fingerprint yet. It learns from published posts — sentence length, vocabulary range, how often you ask, how often you show code — so there has to be something published first.</p><form method="post" action="/api/studio" class="mt-3"><input type="hidden" name="action" value="voice"><button type="submit" class="border border-ink bg-ink px-3 py-1.5 text-[0.875rem] text-paper transition-colors hover:border-accent hover:bg-accent">Learn my voice</button></form>` })}` : renderTemplate`${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`<p class="mt-2 text-[0.9375rem] leading-relaxed text-ink-2">Learned from ${plural(voice.postCount, "published post")}. Not stylometry and not a model — sentence length, vocabulary range, asking, code density. Numbers that cannot explain themselves would be worse than none.</p><dl class="mt-3 grid grid-cols-2 gap-x-8 gap-y-2 border border-rule p-4 sm:grid-cols-3"><div><dt class="meta">Sentences / post</dt><dd class="mt-1 font-mono text-[0.9375rem] tabular-nums">${Math.round(voice.features.sentences)}</dd></div><div><dt class="meta">Words / sentence</dt><dd class="mt-1 font-mono text-[0.9375rem] tabular-nums">${voice.features.meanSentenceWords.toFixed(1)}</dd></div><div><dt class="meta">Vocabulary range</dt><dd class="mt-1 font-mono text-[0.9375rem] tabular-nums">${(voice.features.typeTokenRatio * 100).toFixed(0)}%</dd></div></dl>${voiceDrift && voiceLatestSlug && renderTemplate`<p class="mt-3 border-l-2 border-rule-strong pl-3 text-[0.9375rem] leading-relaxed text-ink-2">Latest post reads${" "}${voiceDrift.score < .15 ? renderTemplate`${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`like you.` })}` : voiceDrift.score < .35 ? renderTemplate`${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`a little off your fingerprint${voiceDrift.moved.length > 0 && renderTemplate`${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate` — ${voiceDrift.moved.join(", ")} moved` })}`}:` })}` : renderTemplate`${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`nothing like your other ${plural(voice.postCount, "post")}${voiceDrift.moved.length > 0 && renderTemplate`${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate` — ${voiceDrift.moved.join(", ")} moved` })}`}:` })}`}${" "}<a${addAttribute(`/w/${voiceLatestSlug}`, "href")} class="text-ink no-underline hover:text-accent">read it →</a></p>`}<form method="post" action="/api/studio" class="mt-3"><input type="hidden" name="action" value="voice"><button type="submit" class="meta text-ink-3 hover:text-ink">Re-learn from current posts</button></form>` })}`}</section><section aria-labelledby="digest-heading"><h2 id="digest-heading" class="text-xl">Weekly digest</h2><p class="mt-2 text-[0.9375rem] leading-relaxed text-ink-2">What Monday's send would contain — same function the sender calls, so the preview cannot drift from what goes out. Empty weeks send nothing.</p>${digestPreview.items.length === 0 ? renderTemplate`<p class="mt-3 border-l-2 border-rule-strong pl-3 text-[0.9375rem] text-ink-2">Quiet week: nothing new or revised in the last seven days.${digestPreview.subscribers === 0 ? " Nobody subscribed yet, either." : ` ${digestPreview.subscribers} ${digestPreview.subscribers === 1 ? "subscriber" : "subscribers"} waiting.`}</p>` : renderTemplate`${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`<ol class="mt-4 space-y-3">${digestPreview.items.map((item, i) => renderTemplate`<li class="border border-rule p-3"><p class="meta">${i + 1} · ${item.kind === "new" ? "new" : "revised"}</p><p class="mt-1 font-medium"><a${addAttribute(`/w/${item.slug}`, "href")} class="no-underline hover:text-accent">${item.title}</a></p><p class="mt-1 text-[0.875rem] text-ink-2">${item.detail}</p></li>`)}</ol><p class="meta mt-3">${digestPreview.subscribers} ${digestPreview.subscribers === 1 ? "subscriber" : "subscribers"} · sends Monday 09:00 UTC when DEPLOY_URL and CRON_SECRET are set</p>` })}`}</section><section aria-labelledby="lists-heading"><h2 id="lists-heading" class="text-xl">Reading lists</h2><p class="mt-2 text-[0.9375rem] leading-relaxed text-ink-2">Curate in the open, or keep a list private and share it by link. Private lists answer 404 to everyone else — even confirming one exists would leak that it does.</p><form method="post" action="/api/lists" class="mt-4 border border-rule p-4"><input type="hidden" name="action" value="create"><div class="grid gap-3 sm:grid-cols-2"><label class="block"><span class="meta">Name</span><input name="title" required${addAttribute(3, "minlength")}${addAttribute(120, "maxlength")} placeholder="Before the argument" class="mt-1 w-full border border-rule bg-paper px-3 py-2 text-[0.9375rem] focus:border-accent focus:outline-none"></label><label class="block"><span class="meta">Visibility</span><select name="isPublic" class="mt-1 w-full border border-rule bg-paper px-3 py-2 text-[0.9375rem] focus:border-accent focus:outline-none"><option value="public">Public — listed with the others</option><option value="private">Private — only you, until shared</option></select></label></div><label class="meta mt-3 block" for="list-desc">Description</label><input id="list-desc" name="description"${addAttribute(500, "maxlength")} placeholder="Why these, in this order" class="mt-1 w-full border border-rule bg-paper px-3 py-2 text-[0.9375rem] focus:border-accent focus:outline-none"><button type="submit" class="mt-3 border border-ink bg-ink px-3 py-1.5 text-[0.875rem] text-paper transition-colors hover:border-accent hover:bg-accent">New list</button></form>${sharedLink && renderTemplate`<p class="meta mt-3 border border-pine px-3 py-2 text-pine" role="status">Share link: <code class="border border-rule bg-sunken px-1">${sharedLink}</code> — anyone holding it can read the list. Rotating replaces it.</p>`}${ownedLists.length > 0 && renderTemplate`<ol class="mt-4 space-y-3">${ownedLists.map((list) => renderTemplate`<li class="border border-rule p-4"><div class="flex flex-wrap items-baseline gap-x-3 gap-y-1"><a${addAttribute(`/lists/${list.slug}`, "href")} class="font-medium no-underline hover:text-accent">${list.title}</a><span class="meta">${list.items} ${list.items === 1 ? "post" : "posts"} ·${" "}${list.isPublic ? "public" : "private"}${!list.isPublic && list.hasShareLink ? " · shared by link" : ""}${!list.isOwner ? " · with you" : ""}</span>${list.isOwner && renderTemplate`<span class="ml-auto flex items-center gap-2"><form method="post" action="/api/lists" class="contents"><input type="hidden" name="action" value="visibility"><input type="hidden" name="listId"${addAttribute(list.id, "value")}><input type="hidden" name="isPublic"${addAttribute(list.isPublic ? "private" : "public", "value")}><button type="submit" class="meta text-ink-3 hover:text-ink">Make ${list.isPublic ? "private" : "public"}</button></form>${!list.isPublic && (list.hasShareLink ? renderTemplate`<form method="post" action="/api/lists" class="contents"><input type="hidden" name="action" value="revoke"><input type="hidden" name="listId"${addAttribute(list.id, "value")}><button type="submit" class="meta text-ink-3 hover:text-danger">Revoke link</button></form>` : renderTemplate`<form method="post" action="/api/lists" class="contents"><input type="hidden" name="action" value="share"><input type="hidden" name="listId"${addAttribute(list.id, "value")}><button type="submit" class="meta text-ink-3 hover:text-ink">Get share link</button></form>`)}</span>`}</div>${list.isOwner && renderTemplate`<div class="mt-3 border-t border-rule pt-3">${(collaboratorsByList[list.id] ?? []).filter((c) => !c.isOwner).length > 0 && renderTemplate`<ul class="mb-2 space-y-1">${(collaboratorsByList[list.id] ?? []).filter((c) => !c.isOwner).map((c) => renderTemplate`<li class="flex items-center gap-2 text-[0.875rem]"><span>@${c.handle}</span><span class="meta">${c.role}</span><form method="post" action="/api/lists" class="ml-auto contents"><input type="hidden" name="action" value="remove-collaborator"><input type="hidden" name="listId"${addAttribute(list.id, "value")}><input type="hidden" name="handle"${addAttribute(c.handle, "value")}><button type="submit" class="meta text-ink-3 hover:text-danger">Remove</button></form></li>`)}</ul>`}<form method="post" action="/api/lists" class="flex flex-wrap items-end gap-2"><input type="hidden" name="action" value="add-collaborator"><input type="hidden" name="listId"${addAttribute(list.id, "value")}><div class="min-w-0 flex-1"><label class="meta block"${addAttribute(`collab-handle-${list.id}`, "for")}>Add a collaborator</label><input${addAttribute(`collab-handle-${list.id}`, "id")} name="handle" required placeholder="handle" class="mt-1 w-full border border-rule bg-paper px-2 py-1 text-[0.875rem] focus:border-accent focus:outline-none"></div><div><label class="meta block"${addAttribute(`collab-role-${list.id}`, "for")}>Role</label><select${addAttribute(`collab-role-${list.id}`, "id")} name="role" class="mt-1 border border-rule bg-paper px-2 py-1 text-[0.875rem]"><option value="viewer">Viewer (read)</option><option value="editor">Editor (add/remove)</option></select></div><button type="submit" class="border border-ink bg-ink px-2 py-1 text-[0.875rem] text-paper transition-colors hover:border-accent hover:bg-accent">Add</button></form></div>`}</li>`)}</ol>`}</section>${linkSuggestions.size > 0 && renderTemplate`<section aria-labelledby="links-heading"><h2 id="links-heading" class="text-xl">Connect the archive</h2><p class="mt-2 text-[0.9375rem] leading-relaxed text-ink-2">Posts sharing vocabulary that are not linked yet. Shared words can mean a real relationship or a coincidence — you decide the type, or leave them be.</p><ol class="mt-4 space-y-4">${health.filter((post) => linkSuggestions.has(post.id)).map((post) => renderTemplate`<li class="border border-rule p-4"><p class="meta">From${" "}<a${addAttribute(`/w/${post.slug}`, "href")} class="no-underline hover:text-ink">${post.title}</a></p><ul class="mt-2 space-y-3">${(linkSuggestions.get(post.id) ?? []).map((s) => renderTemplate`<li class="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-rule pt-3 first:border-t-0 first:pt-0"><div class="min-w-0 flex-1"><a${addAttribute(`/w/${s.slug}`, "href")} class="no-underline hover:text-accent">${s.title}</a><p class="meta mt-1">shares: ${s.shared.join(", ")}</p></div><form method="post" action="/api/studio" class="flex items-center gap-2"><input type="hidden" name="action" value="link"><input type="hidden" name="fromPostId"${addAttribute(post.id, "value")}><input type="hidden" name="toSlug"${addAttribute(s.slug, "value")}><select name="type"${addAttribute(`Link type from ${post.title} to ${s.title}`, "aria-label")} class="border border-rule bg-paper px-2 py-1 text-[0.8125rem] focus:border-accent focus:outline-none"><option value="mentions">mentions</option><option value="cites">cites</option><option value="extends">extends</option><option value="contradicts">contradicts</option></select><button type="submit" class="border border-ink bg-ink px-2 py-1 text-[0.8125rem] text-paper transition-colors hover:border-accent hover:bg-accent">Link</button></form></li>`)}</ul></li>`)}</ol></section>`}${flagged.length > 0 && renderTemplate`<section aria-labelledby="flagged-heading"><h2 id="flagged-heading" class="text-xl">Flagged <span class="meta">· by your readers, for you to judge</span></h2><p class="mt-2 text-[0.9375rem] leading-relaxed text-ink-2">A report hides nothing by itself. Read the reason; hide what does not belong, dismiss the rest by leaving it visible.</p><ol class="mt-4 space-y-3">${flagged.map((note) => renderTemplate`<li class="border border-rule p-4"><p class="meta">${note.kind} · ${plural(note.reports, "report")} · on${" "}<a${addAttribute(`/w/${note.postSlug}`, "href")} class="no-underline hover:text-ink">${note.postTitle}</a>${note.status === "hidden" && renderTemplate`<span aria-hidden="true"> · </span>`}${note.status === "hidden" && renderTemplate`<span class="text-ochre">hidden</span>`}</p><p class="mt-1.5 text-[0.875rem] leading-relaxed text-ink-2">${note.body}</p><p class="mt-1.5 border-l-2 border-rule-strong pl-2 text-[0.8125rem] italic text-ink-3">“${note.latestReason}”</p><form method="post" action="/api/notes" class="mt-2"><input type="hidden" name="action" value="visibility"><input type="hidden" name="noteId"${addAttribute(note.id, "value")}><input type="hidden" name="status"${addAttribute(note.status === "hidden" ? "visible" : "hidden", "value")}><input type="hidden" name="returnTo" value="/studio"><button type="submit"${addAttribute(["meta hover:text-ink", note.status === "hidden" ? "text-pine" : "text-ink-3 hover:text-danger"], "class:list")}>${note.status === "hidden" ? "Restore" : "Hide"}</button></form></li>`)}</ol></section>`}</div></div>`}` })}`;
}, "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/pages/studio.astro", void 0);
var $$file = "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/pages/studio.astro";
var $$url = "/studio";
//#endregion
//#region \0virtual:astro:page:src/pages/studio@_@astro
var page = () => studio_exports;
//#endregion
export { page };
