import { t as __exportAll } from "./rolldown-runtime_8H4AJuhK.mjs";
import { a as Fragment, d as renderTemplate, f as maybeRenderHead, i as renderComponent, m as addAttribute, w as createAstro } from "./server_DKu4icSC.mjs";
import { t as createComponent } from "./compiler_DeGWR9rg.mjs";
import { u as resolvePrefs } from "./prefs_CLygXapP.mjs";
import { t as $$Base } from "./Base_BucALmBf.mjs";
import { n as longDate, r as plural } from "./format_D0bVmvvo.mjs";
import { t as $$PostRow } from "./PostRow_B0WJeZNZ.mjs";
import { a as getGraph, l as listAll } from "./taxonomy_CiJ526xn.mjs";
import { c as getLineage } from "./posts_DKPEGog2.mjs";
//#region src/components/ArcGraph.astro
createAstro("http://localhost:4321");
var $$ArcGraph = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$ArcGraph;
	const { nodes, edges } = Astro.props;
	const ROW = 62;
	const LABEL_X = 0;
	const AXIS_X = 200;
	const W = 640;
	const H = nodes.length * ROW + 40;
	const ARC_W = 300;
	const y = (i) => 28 + i * ROW;
	const arc = (a, b) => {
		const from = y(a);
		const to = y(b);
		const span = Math.abs(to - from);
		const reach = Math.min(ARC_W, 26 + span * .55);
		return `M ${AXIS_X} ${from} C ${AXIS_X + reach} ${from}, ${AXIS_X + reach} ${to}, ${AXIS_X} ${to}`;
	};
	const stroke = {
		fork_of: "var(--pine)",
		contradicts: "var(--danger)",
		extends: "var(--accent)",
		cites: "var(--rule-strong)",
		mentions: "var(--rule)"
	};
	const TITLES = {
		fork_of: "forked from",
		contradicts: "contradicts",
		extends: "extends",
		cites: "cites",
		mentions: "mentions"
	};
	return renderTemplate`${maybeRenderHead($$result)}<div class="overflow-x-auto border border-rule bg-surface"><svg${addAttribute(`0 0 ${W} ${H}`, "viewBox")} class="w-full min-w-[36rem]" role="img"${addAttribute(`Constellation diagram: ${nodes.length} posts and ${edges.length} links between them.`, "aria-label")}><line${addAttribute(AXIS_X, "x1")}${addAttribute(AXIS_X, "x2")} y1="16"${addAttribute(H - 24, "y2")} stroke="var(--rule)" stroke-width="1"></line>${edges.map((e) => renderTemplate`<path${addAttribute(arc(e.fromIndex, e.toIndex), "d")} fill="none"${addAttribute(stroke[e.type], "stroke")}${addAttribute(e.type === "fork_of" ? 1.5 : 1, "stroke-width")}${addAttribute(e.type === "mentions" ? "2 3" : void 0, "stroke-dasharray")}${addAttribute(e.type === "cites" || e.type === "mentions" ? .6 : 1, "opacity")}><title>${`${nodes[e.fromIndex]?.title} ${TITLES[e.type]} ${nodes[e.toIndex]?.title}`}</title></path>`)}${nodes.map((n, i) => renderTemplate`<g><a${addAttribute(`/w/${n.slug}`, "href")} class="no-underline"><rect${addAttribute(LABEL_X, "x")}${addAttribute(y(i) - 20, "y")}${addAttribute(212, "width")}${addAttribute(54, "height")} fill="transparent"></rect><text${addAttribute(LABEL_X, "x")}${addAttribute(y(i) + 4, "y")} font-size="12" fill="var(--ink)" font-family="var(--font-serif)">${n.title.length > 34 ? `${n.title.slice(0, 33)}…` : n.title}</text><line${addAttribute(195, "x1")}${addAttribute(205, "x2")}${addAttribute(y(i), "y1")}${addAttribute(y(i), "y2")}${addAttribute(n.versionCount > 1 ? "var(--accent)" : "var(--ink-3)", "stroke")}${addAttribute(n.versionCount > 1 ? 2 : 1.25, "stroke-width")}></line><text${addAttribute(214, "x")}${addAttribute(y(i) + 4, "y")} font-size="10" fill="var(--ink-3)" font-family="var(--font-mono)">${n.versionCount > 1 ? `${n.versionCount}×` : n.authorHandle}</text><title>${`${n.title} — ${n.authorName}, ${n.versionCount} revision${n.versionCount === 1 ? "" : "s"}`}</title></a></g>`)}</svg></div><ul class="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">${[
		"extends",
		"contradicts",
		"cites",
		"fork_of",
		"mentions"
	].map((t) => renderTemplate`<li class="meta flex items-center gap-2"><span class="inline-block h-px w-5"${addAttribute(`background: ${stroke[t]}`, "style")} aria-hidden="true"></span>${TITLES[t]}</li>`)}</ul>`;
}, "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/components/ArcGraph.astro", void 0);
//#endregion
//#region src/pages/constellations/index.astro
var constellations_exports = /* @__PURE__ */ __exportAll({
	default: () => $$Index,
	file: () => $$file,
	url: () => $$url
});
createAstro("http://localhost:4321");
var $$Index = createComponent(async ($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$Index;
	const anonId = Astro.cookies.get("strata_anon")?.value ?? crypto.randomUUID();
	const prefs = resolvePrefs(Astro.cookies, anonId);
	const { nodes, edges } = await getGraph();
	const all = await listAll();
	const forked = all.filter((p) => nodes.find((n) => n.slug === p.slug)?.forks === 1);
	const withLineage = [];
	for (const p of forked.slice(0, 6)) {
		const node = nodes.find((n) => n.slug === p.slug);
		if (!node) continue;
		withLineage.push({
			post: p,
			lineage: await getLineage(node.id)
		});
	}
	const unlinked = nodes.filter((n) => !edges.some((e) => e.fromIndex === nodes.indexOf(n) || e.toIndex === nodes.indexOf(n)));
	return renderTemplate`${renderComponent($$result, "Base", $$Base, {
		"title": "Constellations",
		"description": "How the writing here connects: what cites what, what contradicts what, and where the thinking branches.",
		"prefs": prefs
	}, { "default": ($$result) => renderTemplate`${maybeRenderHead($$result)}<header class="shell border-b border-rule py-12"><div class="max-w-2xl"><h1 class="text-3xl">Constellations</h1><p class="mt-4 text-[1.0625rem] leading-relaxed text-ink-2">Posts are not an archive. They are a body of work, and the interesting structure is which idea leaned on which, which one contradicts another, and where a thought got picked up and carried somewhere else entirely.</p><p class="mt-3 text-[1.0625rem] leading-relaxed text-ink-2">This is drawn as arcs over publication order rather than as a force-directed graph, because a hairball is unreadable past a dozen nodes and time is usually the axis that matters. The mark on the spine is rust where a post has been revised more than once.</p></div></header><div class="shell py-12"><div class="flex flex-wrap items-baseline justify-between gap-4 border-b border-rule pb-3"><h2 class="text-xl">The whole body of work</h2><p class="meta">${plural(nodes.length, "post")} · ${plural(edges.length, "link")}</p></div><div class="mt-6">${renderComponent($$result, "ArcGraph", $$ArcGraph, {
		"nodes": nodes,
		"edges": edges
	})}</div>${unlinked.length > 0 && renderTemplate`<p class="mt-6 max-w-2xl text-[0.9375rem] leading-relaxed text-ink-2"><span class="text-ochre">${plural(unlinked.length, "post")}</span>${" "}${unlinked.length === 1 ? "connects" : "connect"} to nothing else here yet. On a graph this small that is worth noticing: it is usually a post that could be linked to, or a post that should not have been published in isolation.</p>`}<section class="mt-16" aria-labelledby="lineage-heading"><div class="flex flex-wrap items-baseline justify-between gap-4 border-b border-rule pb-3"><h2 id="lineage-heading" class="text-xl">Branches</h2><p class="meta">a fork credits its ancestor permanently</p></div><p class="mt-3 max-w-2xl text-[0.9375rem] leading-relaxed text-ink-2">Forking takes a post and writes your own version of it, keeping the chain traversable in both directions. It is the most honest form of citation there is, because the lineage stays visible instead of becoming a footnote.</p>${withLineage.length === 0 ? renderTemplate`<p class="mt-6 text-[0.9375rem] text-ink-3">Nothing has been forked yet. If you want to take one of these arguments somewhere it was not taken, that is what this is for.</p>` : renderTemplate`<div class="mt-6 max-w-3xl">${withLineage.map(({ post, lineage }) => renderTemplate`<div class="border-b border-rule py-5 last:border-b-0"><h3 class="text-[1.0625rem]"><a${addAttribute(`/w/${post.slug}`, "href")} class="no-underline hover:text-accent">${post.title}</a></h3><p class="meta mt-1.5">${longDate(post.publishedAt)} · ${post.authorName}</p>${lineage.ancestors.length > 0 && renderTemplate`<ol class="mt-2 space-y-1 border-l border-rule pl-3 text-[0.875rem]">${lineage.ancestors.map((a) => renderTemplate`<li><span class="meta">${a.depth} deep</span>${" "}<a${addAttribute(`/w/${a.slug}`, "href")} class="text-ink-2 no-underline hover:text-accent">${a.title}</a></li>`)}</ol>`}${lineage.descendants.length > 0 && renderTemplate`<p class="mt-2 text-[0.875rem] text-ink-2">Forked into:${" "}${lineage.descendants.map((d, i) => renderTemplate`${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${i > 0 && ", "}<a${addAttribute(`/w/${d.slug}`, "href")} class="no-underline hover:text-accent">${d.title}</a>` })}`)}</p>`}</div>`)}</div>`}</section><section class="mt-16" aria-labelledby="all-posts-heading"><div class="border-b border-rule pb-3"><h2 id="all-posts-heading" class="text-xl">Everything</h2></div><div class="mt-5 max-w-3xl">${all.map((p) => renderTemplate`${renderComponent($$result, "PostRow", $$PostRow, {
		"slug": p.slug,
		"title": p.title,
		"dek": p.dek,
		"status": p.status,
		"publishedAt": p.publishedAt,
		"updatedAt": p.updatedAt,
		"readingMinutes": p.readingMinutes,
		"versionCount": p.versionCount,
		"annotationTotal": p.annotationTotal,
		"authorName": p.authorName,
		"topicName": p.topicName,
		"compact": true
	})}`)}</div></section></div>` })}`;
}, "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/pages/constellations/index.astro", void 0);
var $$file = "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/pages/constellations/index.astro";
var $$url = "/constellations";
//#endregion
//#region \0virtual:astro:page:src/pages/constellations/index@_@astro
var page = () => constellations_exports;
//#endregion
export { page };
