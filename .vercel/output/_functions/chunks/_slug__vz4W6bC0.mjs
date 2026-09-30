import { t as __exportAll } from "./rolldown-runtime_8H4AJuhK.mjs";
import { S as unescapeHTML, a as Fragment, d as renderTemplate, f as maybeRenderHead, g as createRenderInstruction, h as defineScriptVars, i as renderComponent, m as addAttribute, w as createAstro } from "./server_DKu4icSC.mjs";
import { t as createComponent } from "./compiler_DeGWR9rg.mjs";
import { l as ensureAnonId, u as resolvePrefs } from "./prefs_CLygXapP.mjs";
import { t as $$Base } from "./Base_BucALmBf.mjs";
import { a as shortAgo, i as relativeTime, n as longDate, o as verb, r as plural, t as ago } from "./format_D0bVmvvo.mjs";
import { t as $$StatusBadge } from "./StatusBadge_wg3zFwEI.mjs";
import { l as asks, n as readyDb } from "./db_NRbr6ekn.mjs";
import { t as nanoid } from "./ids_TtqtpDCt.mjs";
import { p as myReadingLists } from "./taxonomy_CiJ526xn.mjs";
import { i as stripInline, n as renderInline, r as slugify } from "./inline_YMPn7sV2.mjs";
import { h as myReactions, p as listAnnotations, s as countParticipants, t as getIdentity, x as voterKeyFor } from "./auth_BCgGryh8.mjs";
import { i as memoryKeyFor, r as isSaved } from "./reader_BL_CGxBC.mjs";
import { C as blockInlineSource, S as renderWithHighlight, T as minutesAtDepth, d as getRevisionView, f as getVersions, o as getAdjacent, p as incrementViews, s as getLastReceipt, u as getPostBySlug, v as recordRead, w as blockToPlainText, x as diffStats } from "./posts_DKPEGog2.mjs";
import { n as getMyHighlights } from "./highlights_CaFzTkyg.mjs";
import { t as answerFromAnyModel } from "./ask_D4wROK0c.mjs";
import { n as highlightCode } from "./highlight_Bx2_emM9.mjs";
import { sql } from "drizzle-orm";
//#region node_modules/astro/dist/runtime/server/render/script.js
async function renderScript(result, id) {
	const inlined = result.inlinedScripts.get(id);
	let content = "";
	if (inlined != null) {
		if (inlined) content = `<script type="module">${inlined}<\/script>`;
	} else {
		const resolved = await result.resolve(id);
		content = `<script type="module" src="${result.userAssetsBase ? (result.base === "/" ? "" : result.base) + result.userAssetsBase : ""}${resolved}"><\/script>`;
	}
	return createRenderInstruction({
		type: "script",
		id,
		content
	});
}
//#endregion
//#region src/components/NoteCard.astro
createAstro("http://localhost:4321");
var $$NoteCard = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$NoteCard;
	const { id, kind, body, authorName, authorHandle, createdAt, editedAt, isAuthor, isMine = false, isAccepted, onOlderRevision, anchorLost, quote, versionNumber, postSlug, postId = "", canAccept = false, returnTo = "", mine = [], replies = [], depth = 0, reactions = {
		useful: 0,
		insightful: 0,
		source: 0
	} } = Astro.props;
	const LABELS = {
		comment: "Comment",
		correction: "Correction",
		extension: "Extension",
		disagreement: "Disagreement",
		worked_example: "Worked example",
		update: "Update",
		author_note: "Author’s note"
	};
	const REACTIONS = [
		{
			kind: "useful",
			label: "useful"
		},
		{
			kind: "insightful",
			label: "insightful"
		},
		{
			kind: "source",
			label: "sourced"
		}
	];
	const ACCEPTABLE = [
		"correction",
		"disagreement",
		"update",
		"extension"
	];
	const mineSet = new Set(mine);
	const back = returnTo || Astro.url.pathname + Astro.url.search;
	const canReact = depth === 0;
	const canReply = depth === 0;
	const canEdit = isMine;
	const showAccept = canAccept && !isMine && !isAccepted && ACCEPTABLE.includes(kind);
	const totalReactions = reactions.useful + reactions.insightful + reactions.source;
	return renderTemplate`${maybeRenderHead($$result)}<article${addAttribute(`note-${id}`, "id")}${addAttribute([
		"border-b border-rule py-3 last:border-b-0 first:pt-0",
		isAuthor && "note-author pl-3",
		depth > 0 && "note-reply border-l-2 border-rule pl-3"
	], "class:list")}${addAttribute(id, "data-note-id")}${addAttribute(kind, "data-note-kind")}><p class="meta flex flex-wrap items-center gap-x-2"><span${addAttribute(["note-kind-" + kind], "class:list")}>${LABELS[kind]}${isAccepted && renderTemplate`<span class="text-pine"> · accepted</span>`}</span></p>${quote && depth === 0 && renderTemplate`<blockquote class="mt-1.5 border-l-2 border-rule-strong pl-2 text-[0.8125rem] leading-snug text-ink-3 italic">${quote}</blockquote>`}<p class="mt-1.5 text-[0.875rem] leading-relaxed text-ink-2">${body}</p><p class="meta mt-1.5 flex flex-wrap items-center gap-x-2">${authorHandle ? renderTemplate`<a${addAttribute(`/a/${authorHandle}`, "href")} class="no-underline hover:text-ink">${authorName}</a>` : renderTemplate`<span>${authorName}</span>`}<span aria-hidden="true">·</span><span>${relativeTime(createdAt)}</span>${editedAt && renderTemplate`${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`<span aria-hidden="true">·</span><span${addAttribute(new Date(editedAt).toISOString(), "title")}>edited</span>` })}`}<span aria-hidden="true">·</span><a${addAttribute(`/w/${postSlug}#note-${id}`, "href")} class="no-underline hover:text-ink">link</a></p>${onOlderRevision && renderTemplate`<p class="mt-1.5 text-[0.75rem] leading-snug text-ochre"><a${addAttribute(`/w/${postSlug}?rev=${versionNumber}#note-${id}`, "href")} class="no-underline hover:underline">This note is on revision ${versionNumber} — read that version to see what it argued with →</a></p>`}${anchorLost && renderTemplate`<p class="mt-1.5 text-[0.75rem] leading-snug text-ink-3">The sentence this note was attached to has since been rewritten out of the post.</p>`}${canReact && renderTemplate`<div class="mt-2 flex flex-wrap items-center gap-1.5">${REACTIONS.map((r) => {
		const given = mineSet.has(`${id}:${r.kind}`);
		const count = reactions[r.kind];
		return renderTemplate`<form method="post" action="/api/notes" class="contents"><input type="hidden" name="action" value="react"><input type="hidden" name="noteId"${addAttribute(id, "value")}><input type="hidden" name="kind"${addAttribute(r.kind, "value")}><input type="hidden" name="returnTo"${addAttribute(back, "value")}><button type="submit"${addAttribute(given, "aria-pressed")}${addAttribute(["border px-2 py-1 text-[0.75rem] transition-colors", given ? "border-accent text-accent" : "border-rule text-ink-3 hover:border-rule-strong hover:text-ink"], "class:list")}>${r.label}${count > 0 && renderTemplate`<span class="tabular-nums"> ${count}</span>`}</button></form>`;
	})}${totalReactions === 0 && renderTemplate`<span class="meta ml-1">Was this worth reading?</span>`}</div>`}${(canReply || canEdit) && renderTemplate`<div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">${canReply && renderTemplate`<details class="note-disclosure"><summary class="meta cursor-pointer text-ink-3 hover:text-ink">Reply</summary><form method="post" action="/api/notes" class="mt-2"><input type="hidden" name="action" value="reply"><input type="hidden" name="parentId"${addAttribute(id, "value")}><input type="hidden" name="returnTo"${addAttribute(back, "value")}><label class="sr-only"${addAttribute(`reply-${id}`, "for")}>Reply to this note</label><textarea${addAttribute(`reply-${id}`, "id")} name="body"${addAttribute(3, "rows")}${addAttribute(4e3, "maxlength")} required placeholder="Argue with this, or add what it left out." class="w-full resize-y border border-rule bg-paper px-3 py-2 text-[0.875rem] leading-relaxed focus:border-accent focus:outline-none"></textarea><button type="submit" class="mt-1.5 border border-ink bg-ink px-3 py-1 text-[0.8125rem] text-paper transition-colors hover:border-accent hover:bg-accent">Post reply</button></form></details>`}${canEdit && renderTemplate`<details class="note-disclosure"><summary class="meta cursor-pointer text-ink-3 hover:text-ink">Edit</summary><form method="post" action="/api/notes" class="mt-2"><input type="hidden" name="action" value="edit"><input type="hidden" name="noteId"${addAttribute(id, "value")}><input type="hidden" name="returnTo"${addAttribute(back, "value")}><label class="sr-only"${addAttribute(`edit-${id}`, "for")}>Edit your note</label><textarea${addAttribute(`edit-${id}`, "id")} name="body"${addAttribute(3, "rows")}${addAttribute(4e3, "maxlength")} required class="w-full resize-y border border-rule bg-paper px-3 py-2 text-[0.875rem] leading-relaxed focus:border-accent focus:outline-none">
                ${body}
              </textarea><button type="submit" class="mt-1.5 border border-ink bg-ink px-3 py-1 text-[0.8125rem] text-paper transition-colors hover:border-accent hover:bg-accent">Save</button></form></details>`}${canEdit && renderTemplate`<form method="post" action="/api/notes" class="contents"><input type="hidden" name="action" value="remove"><input type="hidden" name="noteId"${addAttribute(id, "value")}><input type="hidden" name="returnTo"${addAttribute(back, "value")}><button type="submit" class="meta text-ink-3 hover:text-danger" onclick="return confirm('Delete this note? Replies to it stay, but the note itself goes.')">Delete</button></form>`}${!isMine && renderTemplate`<details class="note-disclosure"><summary class="meta cursor-pointer text-ink-3 hover:text-ink">Report</summary><form method="post" action="/api/notes" class="mt-2 flex flex-wrap items-center gap-2"><input type="hidden" name="action" value="report"><input type="hidden" name="noteId"${addAttribute(id, "value")}><input type="hidden" name="returnTo"${addAttribute(back, "value")}><label class="sr-only"${addAttribute(`report-${id}`, "for")}>Why does this note not belong here?</label><input${addAttribute(`report-${id}`, "id")} name="reason" required${addAttribute(3, "minlength")}${addAttribute(500, "maxlength")} placeholder="Spam, abuse, off-topic…" class="min-w-0 flex-1 border border-rule bg-paper px-2 py-1 text-[0.8125rem] focus:border-accent focus:outline-none"><button type="submit" class="border border-rule px-2 py-1 text-[0.8125rem] text-ink-3 transition-colors hover:border-danger hover:text-danger">Flag for the author</button></form></details>`}</div>`}${showAccept && renderTemplate`<form method="post" action="/api/notes" class="mt-2"><input type="hidden" name="action" value="accept"><input type="hidden" name="noteId"${addAttribute(id, "value")}><input type="hidden" name="postId"${addAttribute(postId, "value")}><input type="hidden" name="returnTo"${addAttribute(back, "value")}><button type="submit" class="border border-pine px-2 py-1 text-[0.75rem] text-pine transition-colors hover:bg-pine hover:text-paper">Accept this into the revision history</button><p class="mt-1 text-[0.75rem] leading-snug text-ink-3">It becomes an attributed amendment, and ${authorName} is credited on it.</p></form>`}${replies.length > 0 && renderTemplate`<div class="mt-2 space-y-1">${replies.map((child) => renderTemplate`${renderComponent($$result, "NoteReply", $$NoteCard, {
		"id": child.id,
		"kind": child.kind,
		"body": child.body,
		"authorName": child.authorName,
		"authorHandle": child.authorHandle,
		"createdAt": child.createdAt,
		"editedAt": child.editedAt,
		"isAuthor": child.isAuthor,
		"isMine": child.isMine,
		"isAccepted": child.isAccepted,
		"onOlderRevision": child.onOlderRevision,
		"anchorLost": child.resolved.status === "lost",
		"quote": child.anchor.quote,
		"versionNumber": child.versionNumber,
		"postSlug": postSlug,
		"postId": postId,
		"canAccept": canAccept,
		"returnTo": returnTo,
		"mine": mine,
		"depth": depth + 1
	})}`)}</div>`}</article>`;
}, "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/components/NoteCard.astro", void 0);
//#endregion
//#region src/lib/artifact.ts
function num(v, fallback) {
	const n = typeof v === "number" ? v : Number(v);
	return Number.isFinite(n) ? n : fallback;
}
function arr(v) {
	return Array.isArray(v) ? v.map((x) => num(x, 0)) : [];
}
function str(v, fallback = "") {
	return typeof v === "string" ? v : fallback;
}
function curveData(props) {
	const model = str(props.model, "staleness");
	const min = num(props.min, 0);
	const max = num(props.max, 100);
	const changeEvery = num(props.changeEvery, 10);
	const unit = str(props.unit, "s");
	const measured = arr(props.measured);
	const isRecall = model === "recall";
	let series;
	if (isRecall) {
		if (measured.length === 0) return {
			ok: false,
			isRecall,
			min,
			max,
			unit,
			series: [],
			firstX: min,
			note: "",
			seriesForClient: []
		};
		const lo = Math.min(...measured);
		const hi = Math.max(...measured);
		series = measured.map((v, i) => {
			return {
				x: min + (max - min) * i / Math.max(1, measured.length - 1),
				raw: v,
				y: hi === lo ? .5 : (v - lo) / (hi - lo)
			};
		});
	} else {
		series = [];
		const steps = 120;
		for (let i = 0; i <= steps; i++) {
			const px = min + (max - min) * i / steps;
			if (px <= 0) {
				series.push({
					x: px,
					raw: 0,
					y: 0
				});
				continue;
			}
			const y = 1 - Math.exp(-changeEvery / px);
			series.push({
				x: px,
				raw: y,
				y
			});
		}
	}
	return {
		ok: series.length >= 2,
		isRecall,
		min,
		max,
		unit,
		series,
		firstX: isRecall ? min : Math.min(max, Math.max(min, changeEvery * 2)),
		note: isRecall ? "Measured, not modelled. Move the slider to see where the curve actually flattens." : "Assumes independent (Poisson) changes and exponential decay on read. Real change is burstier, so expect worse than this.",
		seriesForClient: series.flatMap((p) => [
			p.x,
			p.raw,
			p.y
		])
	};
}
var SCENARIOS = [
	{
		key: "independent",
		label: "Independent hops",
		note: "each hop draws its own shock"
	},
	{
		key: "correlated",
		label: "Shared factor",
		note: "one shock hits most hops at once"
	},
	{
		key: "locked",
		label: "Perfectly locked",
		note: "one shock scales every hop"
	}
];
function mulberry(seed) {
	let a = seed >>> 0;
	return () => {
		a = a + 1831565813 >>> 0;
		let t = Math.imul(a ^ a >>> 15, 1 | a);
		t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	};
}
function breakdownData(props) {
	const hops = Array.isArray(props.hops) ? props.hops.map((h) => str(h)) : [];
	const latencies = arr(props.latencies);
	const variance = arr(props.variance);
	const N = 2e4;
	if (hops.length === 0 || latencies.length === 0) return {
		ok: false,
		naive: 0,
		perHop: [],
		scenarios: []
	};
	const rand = mulberry(356890);
	const per = Array.from({ length: SCENARIOS.length }, () => hops.map(() => []));
	const totals = Array.from({ length: SCENARIOS.length }, () => []);
	for (let i = 0; i < N; i++) {
		const u = Math.max(rand(), 1e-9);
		const v = rand();
		const shared = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
		let t0 = 0;
		let t1 = 0;
		let t2 = 0;
		for (let h = 0; h < hops.length; h++) {
			const mean = latencies[h] ?? latencies[0];
			const sd = variance[h] ?? variance[0];
			const uu = Math.max(rand(), 1e-9);
			const vv = rand();
			const own = Math.sqrt(-2 * Math.log(uu)) * Math.cos(2 * Math.PI * vv);
			const a = Math.max(.1, mean + own * sd);
			const b = Math.max(.1, mean + (.75 * shared + .66 * own) * sd);
			const c = Math.max(.1, mean + shared * sd);
			per[0][h].push(a);
			per[1][h].push(b);
			per[2][h].push(c);
			t0 += a;
			t1 += b;
			t2 += c;
		}
		totals[0].push(t0);
		totals[1].push(t1);
		totals[2].push(t2);
	}
	const p99 = (xs) => {
		xs.sort((x, y) => x - y);
		return xs[Math.floor(xs.length * .99)];
	};
	const p50 = (xs) => {
		const s = [...xs].sort((x, y) => x - y);
		return s[Math.floor(s.length * .5)];
	};
	return {
		ok: true,
		naive: per[0].reduce((sum, samples) => sum + p99(samples), 0),
		perHop: hops.map((name, h) => ({
			name,
			p50: p50(per[0][h]),
			p99: p99(per[0][h])
		})),
		scenarios: SCENARIOS.map((s, i) => ({
			...s,
			p99: p99(totals[i])
		}))
	};
}
function matrixCases(props) {
	return (Array.isArray(props.cases) ? props.cases : []).map((c) => ({
		name: str(c.name, "unnamed"),
		recall: num(c.recall, 0),
		precision: num(c.precision, 0),
		grounded: num(c.grounded, 0),
		verdict: str(c.verdict, "")
	}));
}
function timelineEvents(props) {
	return (Array.isArray(props.events) ? props.events : []).map((e) => ({
		at: str(e.at, ""),
		label: str(e.label, ""),
		note: str(e.note, "")
	}));
}
//#endregion
//#region src/components/Artifact.astro
createAstro("http://localhost:4321");
var $$Artifact = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$Artifact;
	const { component, title, props } = Astro.props;
	const W = 560;
	const W_CURVE = 560;
	const H_CURVE = 220;
	const PAD_C = {
		l: 52,
		r: 14,
		t: 12,
		b: 28
	};
	const cx = (c, v) => PAD_C.l + (v - c.min) / (c.max - c.min || 1) * (W_CURVE - PAD_C.l - PAD_C.r);
	const cy = (y) => H_CURVE - PAD_C.b - y * (H_CURVE - PAD_C.t - PAD_C.b);
	const curve = component === "curve" ? curveData(props) : null;
	const curvePath = curve && curve.ok ? curve.series.map((p, i) => `${i === 0 ? "M" : "L"}${cx(curve, p.x).toFixed(1)},${cy(p.y).toFixed(1)}`).join(" ") : "";
	const curveY = (y) => cy(y);
	const curvePx = (v) => cx(curve, v);
	const curveSummary = (() => {
		if (!curve || !curve.ok) return "";
		const base = curve.series[0].raw;
		const first = curve.series.find((p) => p.x >= curve.firstX) ?? curve.series[0];
		const gain = first.raw - base;
		return curve.isRecall ? `${(first.raw * 100).toFixed(1)}% recall at ${Math.round(first.x)} dimensions — ${gain >= 0 ? "+" : ""}${(gain * 100).toFixed(1)} points over the ${Math.round(curve.min)}-dimension baseline.` : `${(first.raw * 100).toFixed(0)}% of reads can be served stale at a ${first.x.toFixed(first.x < 10 ? 1 : 0)}${curve.unit} TTL.`;
	})();
	const bd = component === "breakdown" ? breakdownData(props) : null;
	const bdW = 560;
	const bdMax = bd?.ok ? Math.max(bd.naive, ...bd.scenarios.map((s) => s.p99)) : 1;
	const bdBar = (v) => v / (bdMax || 1) * 504;
	const matrix = component === "matrix" ? matrixCases(props) : null;
	const mH = 300;
	const mPad = {
		l: 52,
		r: 16,
		t: 16,
		b: 40
	};
	const mx = (v) => mPad.l + v * (W - mPad.l - mPad.r);
	const my = (v) => mH - mPad.b - v * (mH - mPad.t - mPad.b);
	const activeCase = matrix && matrix.length > 0 ? matrix[0] : void 0;
	const timeline = component === "timeline" ? timelineEvents(props) : [];
	const isEmpty = component === "curve" && !curve?.ok || component === "breakdown" && !bd?.ok || component === "matrix" && matrix.length === 0 || component === "timeline" && timeline.length === 0;
	const emptyWhat = component === "curve" ? "the measured series" : component === "breakdown" ? "the hop data" : component === "matrix" ? "the case list" : "the timeline";
	const known = [
		"curve",
		"breakdown",
		"matrix",
		"timeline"
	].includes(component);
	return renderTemplate`${!known ? renderTemplate`${maybeRenderHead($$result)}<p class="border border-danger p-4 text-[0.9375rem] text-danger" role="alert">This figure could not be drawn: unknown artifact "${String(component)}"</p>` : isEmpty ? renderTemplate`<p class="border border-dashed border-rule-strong p-6 text-center text-[0.9375rem] text-ink-3">This figure has no data yet — ${emptyWhat} is empty.</p>` : renderTemplate`<figure class="my-8 border border-rule bg-surface"${addAttribute(component, "data-artifact")}>${title && renderTemplate`<figcaption class="meta border-b border-rule px-4 py-2.5">${title}</figcaption>`}<div class="p-4">${component === "curve" && curve && renderTemplate`<div data-curve${addAttribute(curve.min, "data-min")}${addAttribute(curve.max, "data-max")}${addAttribute(curve.unit, "data-unit")}${addAttribute(String(curve.isRecall), "data-recall")}><script type="application/json" data-curve-series>${unescapeHTML(JSON.stringify(curve.seriesForClient))}<\/script><svg${addAttribute(`0 0 ${W_CURVE} ${H_CURVE}`, "viewBox")} class="w-full" role="img"${addAttribute(curveSummary, "aria-label")}>${(curve.isRecall ? [
		{
			y: 0,
			label: `${(Math.min(...props.measured ?? []) * 100).toFixed(0)}%`
		},
		{
			y: .5,
			label: "50%"
		},
		{
			y: 1,
			label: `${(Math.max(...props.measured ?? []) * 100).toFixed(0)}%`
		}
	] : [
		{
			y: 0,
			label: "0%"
		},
		{
			y: .25,
			label: "25%"
		},
		{
			y: .5,
			label: "50%"
		},
		{
			y: .75,
			label: "75%"
		},
		{
			y: 1,
			label: "100%"
		}
	]).map((t) => renderTemplate`<g><line${addAttribute(PAD_C.l, "x1")}${addAttribute(W_CURVE - PAD_C.r, "x2")}${addAttribute(curveY(t.y), "y1")}${addAttribute(curveY(t.y), "y2")} stroke="var(--rule)" stroke-width="1"></line><text${addAttribute(PAD_C.l - 8, "x")}${addAttribute(curveY(t.y) + 4, "y")} text-anchor="end" font-size="10" fill="var(--ink-3)" font-family="var(--font-mono)">${t.label}</text></g>`)}<path${addAttribute(curvePath, "d")} fill="none" stroke="var(--accent)" stroke-width="1.75"></path><line data-cursor-line${addAttribute(curvePx(curve.firstX), "x1")}${addAttribute(curvePx(curve.firstX), "x2")}${addAttribute(PAD_C.t, "y1")}${addAttribute(H_CURVE - PAD_C.b, "y2")} stroke="var(--rule-strong)" stroke-width="1"></line><circle data-cursor-dot${addAttribute(curvePx(curve.firstX), "cx")}${addAttribute(curveY(curve.series.find((p) => p.x >= curve.firstX)?.y ?? 0), "cy")} r="3.5" fill="var(--accent)"></circle><text${addAttribute(PAD_C.l, "x")}${addAttribute(212, "y")} font-size="10" fill="var(--ink-3)" font-family="var(--font-mono)">${Math.round(curve.min)}</text><text${addAttribute(W_CURVE - PAD_C.r, "x")}${addAttribute(212, "y")} text-anchor="end" font-size="10" fill="var(--ink-3)" font-family="var(--font-mono)">${Math.round(curve.max)}${curve.isRecall ? "" : curve.unit}</text></svg><div class="mt-4 flex flex-wrap items-center gap-4 border-t border-rule pt-4"><label class="flex flex-1 items-center gap-3"><span class="meta shrink-0">${curve.isRecall ? "Width" : "TTL"}</span><input type="range"${addAttribute(curve.min, "min")}${addAttribute(curve.max, "max")}${addAttribute((curve.max - curve.min) / 200, "step")}${addAttribute(curve.firstX, "value")} data-curve-range class="w-full accent-[var(--accent)]"${addAttribute(curve.isRecall ? "Embedding width" : "Cache TTL", "aria-label")}><span class="meta w-16 shrink-0 text-right tabular-nums" data-curve-value>${Math.round(curve.firstX)}${curve.isRecall ? "d" : curve.unit}</span></label><p class="max-w-sm text-[0.9375rem] text-ink-2" data-curve-summary>${curveSummary}</p></div></div>`}${component === "breakdown" && bd?.ok && renderTemplate`<div data-breakdown><svg${addAttribute(`0 0 ${bdW} ${bd.perHop.length * 30 + bd.scenarios.length * 34 + 46}`, "viewBox")} class="w-full" role="img"${addAttribute(`Naive sum of per-hop p99s is ${bd.naive.toFixed(0)} milliseconds. The measured p99 of the whole request ranges from ${Math.min(...bd.scenarios.map((s) => s.p99)).toFixed(0)} to ${Math.max(...bd.scenarios.map((s) => s.p99)).toFixed(0)} milliseconds depending on correlation.`, "aria-label")}>${bd.perHop.map((s, i) => renderTemplate`<g data-hop tabindex="0"${addAttribute(s.name, "data-name")}${addAttribute(s.p99.toFixed(1), "data-p99")}${addAttribute(s.p50.toFixed(1), "data-p50")}${addAttribute({ cursor: "default" }, "style")}><text x="0"${addAttribute(i * 30 + 14, "y")} font-size="11" fill="var(--ink-2)" font-family="var(--font-mono)">${s.name}</text><rect${addAttribute(44, "x")}${addAttribute(i * 30 + 4, "y")}${addAttribute(bdBar(s.p99), "width")} height="10" fill="var(--rule-strong)"></rect><text${addAttribute(44 + bdBar(s.p99) + 6, "x")}${addAttribute(i * 30 + 13, "y")} font-size="10" fill="var(--ink-3)" font-family="var(--font-mono)">p99 ${s.p99.toFixed(0)} · p50 ${s.p50.toFixed(0)}</text></g>`)}<line${addAttribute(44, "x1")}${addAttribute(44 + bdBar(bd.naive), "x2")}${addAttribute(bd.perHop.length * 30 - 4, "y1")}${addAttribute(bd.perHop.length * 30 - 4, "y2")} stroke="var(--danger)" stroke-width="2"></line><text${addAttribute(44, "x")}${addAttribute(bd.perHop.length * 30 + 10, "y")} font-size="10" fill="var(--danger)" font-family="var(--font-mono)">sum of per-hop p99s — the number you would report: ${bd.naive.toFixed(0)}ms</text>${bd.scenarios.map((s, i) => {
		const y = bd.perHop.length * 30 + 26 + i * 34;
		const over = s.p99 - bd.naive;
		return renderTemplate`<g data-scenario tabindex="0"${addAttribute(s.label, "data-name")}${addAttribute(s.note, "data-note")}${addAttribute(s.p99.toFixed(1), "data-p99")}${addAttribute(over.toFixed(1), "data-over")}${addAttribute({ cursor: "default" }, "style")}><text x="0"${addAttribute(y + 12, "y")} font-size="10" fill="var(--ink-2)" font-family="var(--font-mono)">${s.label}</text><rect${addAttribute(44, "x")}${addAttribute(y + 3, "y")}${addAttribute(bdBar(s.p99), "width")} height="9" fill="var(--accent)"></rect><text${addAttribute(44 + bdBar(s.p99) + 6, "x")}${addAttribute(y + 12, "y")} font-size="10" fill="var(--ink-2)" font-family="var(--font-mono)">${s.p99.toFixed(0)}ms (${over >= 0 ? "+" : ""}${over.toFixed(0)})</text></g>`;
	})}</svg><p class="meta mt-2 min-h-[1.5em] border-t border-rule pt-2 tabular-nums" data-breakdown-readout aria-live="polite">Hover a bar for exact numbers.</p><p class="mt-3 border-t border-rule pt-3 text-[0.9375rem] text-ink-2">The naive sum is <strong class="font-medium text-ink">${bd.naive.toFixed(0)}ms</strong>. The real number is somewhere between${" "}<strong class="font-medium text-ink">${Math.min(...bd.scenarios.map((s) => s.p99)).toFixed(0)}ms</strong> and${" "}<strong class="font-medium text-ink">${Math.max(...bd.scenarios.map((s) => s.p99)).toFixed(0)}ms</strong>, and which end you get depends on whether your hops fail together. You cannot read that off the component dashboards.</p><p class="sr-only">20,000 simulated requests, lognormal per hop. The honest answer depends entirely on how correlated the hops are.</p></div>`}${component === "matrix" && matrix && matrix.length > 0 && activeCase && renderTemplate`<div data-matrix><script type="application/json" data-matrix-cases>${unescapeHTML(JSON.stringify(matrix))}<\/script><svg${addAttribute(`0 0 ${W} ${mH}`, "viewBox")} class="w-full" role="img"${addAttribute(`Diagnostic matrix. Selected: ${activeCase.name}, ${activeCase.verdict}`, "aria-label")}>${[
		0,
		.25,
		.5,
		.75,
		1
	].map((t) => renderTemplate`<g><line${addAttribute(mx(t), "x1")}${addAttribute(mx(t), "x2")}${addAttribute(mPad.t, "y1")}${addAttribute(mH - mPad.b, "y2")} stroke="var(--rule)" stroke-width="1"></line><line${addAttribute(mPad.l, "x1")}${addAttribute(W - mPad.r, "x2")}${addAttribute(my(t), "y1")}${addAttribute(my(t), "y2")} stroke="var(--rule)" stroke-width="1"></line></g>`)}${matrix.map((c, idx) => renderTemplate`<g${addAttribute(idx, "data-case")} class="cursor-pointer" role="button" tabindex="0"${addAttribute(`${c.name}: ${c.verdict}`, "aria-label")}><circle${addAttribute(mx(c.recall), "cx")}${addAttribute(my(c.precision), "cy")}${addAttribute(idx === 0 ? 7 : 5, "r")}${addAttribute(idx === 0 ? "var(--accent)" : "none", "fill")} stroke="var(--accent)" stroke-width="1.5"></circle><text${addAttribute(mx(c.recall) + 11, "x")}${addAttribute(my(c.precision) + 4, "y")} font-size="10" fill="var(--ink-2)" font-family="var(--font-mono)">${c.name}</text></g>`)}<text${addAttribute(W / 2, "x")}${addAttribute(290, "y")} text-anchor="middle" font-size="10" fill="var(--ink-3)" font-family="var(--font-mono)">recall@10 →</text><text x="14"${addAttribute(mH / 2, "y")} text-anchor="middle" font-size="10" fill="var(--ink-3)" font-family="var(--font-mono)"${addAttribute(`rotate(-90 14 ${mH / 2})`, "transform")}>context precision →</text></svg><div class="mt-3 border-t border-rule pt-3" data-matrix-detail><p class="meta mb-1" data-matrix-name>${activeCase.name}</p><p class="text-[0.9375rem] text-ink"><strong class="font-medium" data-matrix-verdict>${activeCase.verdict}</strong></p><p class="meta mt-1 tabular-nums" data-matrix-numbers>recall ${activeCase.recall.toFixed(2)} · precision ${activeCase.precision.toFixed(2)} · groundedness ${activeCase.grounded.toFixed(2)}</p></div></div>`}${component === "timeline" && timeline.length > 0 && renderTemplate`<ol class="relative space-y-4 border-l border-rule pl-5">${timeline.map((e) => renderTemplate`<li class="relative"><span class="absolute -left-[1.4375rem] top-1.5 h-1.5 w-1.5 bg-accent" aria-hidden="true"></span><p class="meta">${e.at}</p><p class="text-[0.9375rem] text-ink">${e.label}</p>${e.note && renderTemplate`<p class="text-[0.9375rem] text-ink-2">${e.note}</p>`}</li>`)}</ol>`}</div>${component === "curve" && curve?.note && renderTemplate`<p class="meta border-t border-rule px-4 py-2.5 leading-relaxed">${curve.note}</p>`}${component === "breakdown" && bd?.ok && renderTemplate`<p class="meta border-t border-rule px-4 py-2.5 leading-relaxed">20,000 simulated requests, lognormal per hop. The honest answer depends entirely on how correlated the hops are — which you cannot see from the component numbers.</p>`}${component === "matrix" && renderTemplate`<p class="meta border-t border-rule px-4 py-2.5 leading-relaxed">Recall on the horizontal axis, context precision on the vertical. Click a marker.</p>`}</figure>`}${renderScript($$result, "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/components/Artifact.astro?astro&type=script&index=0&lang.ts")}`;
}, "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/components/Artifact.astro", void 0);
//#endregion
//#region src/components/Prose.astro
createAstro("http://localhost:4321");
var $$Prose = createComponent(async ($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$Prose;
	const { blocks, diffSegments, changeStatus, notes = {}, replies = {}, postSlug = "", postId = "", canAccept = false, returnTo = "", mine = [] } = Astro.props;
	const codeHighlight = /* @__PURE__ */ new Map();
	await Promise.all(blocks.filter((b) => b.type === "code").map(async (b) => {
		const codeBlock = b;
		codeHighlight.set(codeBlock.id, await highlightCode(codeBlock.code, codeBlock.lang));
	}));
	const segHtml = (segments) => segments.map((s) => {
		const html = s.html ?? renderInline(s.text);
		if (s.type === "ins") return `<span class="diff-ins">${html}</span>`;
		if (s.type === "del") return `<span class="diff-del">${html}</span>`;
		return html;
	}).join("");
	return renderTemplate`${maybeRenderHead($$result)}<div class="prose-post">${blocks.map((block) => {
		const id = block.id;
		const status = changeStatus?.[id];
		const segments = diffSegments?.[id];
		const changed = status && status !== "unchanged";
		const body = () => segments ? segHtml(segments) : renderInline(blockInlineSource(block));
		const blockNotes = notes[id] ?? [];
		const hasNotes = blockNotes.length > 0;
		const renderBody = () => {
			if (segments) return segHtml(segments);
			const first = blockNotes[0];
			const source = blockInlineSource(block);
			if (first && first.resolved.status !== "lost" && first.anchor.quote) {
				const attrs = ` data-note-anchor="${first.id}"`;
				const cls = first.isMine ? "hl-anchor hl-mine" : "hl-anchor";
				if (block.type === "paragraph" || block.type === "tldr") return renderWithHighlight(source, first.resolved.start, first.resolved.end, cls, attrs);
			}
			return renderInline(source);
		};
		return renderTemplate`<div${addAttribute(`block-${id}`, "id")}${addAttribute(id, "data-block-id")}${addAttribute(block.layer, "data-layer")}${addAttribute(block.type, "data-block-type")}${addAttribute(status, "data-change")}${addAttribute([
			"block-with-notes",
			changed && "diff-block",
			status === "removed" && "opacity-70"
		], "class:list")}><div class="min-w-0">${block.type === "tldr" && renderTemplate`<aside class="border-l-2 border-accent pl-5"><p class="meta mb-2">In one paragraph</p><p class="!text-[1.125rem] leading-relaxed">${unescapeHTML(renderBody())}</p></aside>`}${block.type === "heading" && block.level === 2 && renderTemplate`<h2${addAttribute(slugify(block.text), "id")} class="scroll-mt-24"><a${addAttribute(`#${slugify(block.text)}`, "href")} class="no-underline hover:text-accent">${unescapeHTML(body())}</a></h2>`}${block.type === "heading" && block.level === 3 && renderTemplate`<h3${addAttribute(slugify(block.text), "id")} class="scroll-mt-24"><a${addAttribute(`#${slugify(block.text)}`, "href")} class="no-underline hover:text-accent">${unescapeHTML(body())}</a></h3>`}${block.type === "paragraph" && renderTemplate`<p>${unescapeHTML(renderBody())}</p>`}${block.type === "quote" && renderTemplate`<figure><blockquote class="!m-0"><p>${unescapeHTML(body())}</p>${block.attribution && renderTemplate`<figcaption class="meta mt-2 not-italic">— ${block.attribution}</figcaption>`}</blockquote></figure>`}${block.type === "callout" && renderTemplate`<aside${addAttribute([
			"border p-4 text-[0.9375rem]",
			block.tone === "correction" && "border-accent bg-accent-soft",
			block.tone === "warn" && "border-ochre",
			block.tone === "note" && "border-rule bg-sunken"
		], "class:list")}>${block.title && renderTemplate`<p${addAttribute([
			"meta mb-1",
			block.tone === "correction" && "text-accent",
			block.tone === "warn" && "text-ochre"
		], "class:list")}>${block.title}</p>`}<p class="!m-0 leading-relaxed">${unescapeHTML(body())}</p></aside>`}${block.type === "primer" && renderTemplate`<aside class="border border-dashed border-rule-strong bg-sunken p-4"><p class="meta mb-1"><span class="text-ink">${block.term}</span> — context</p><p class="!m-0 text-[0.9375rem] leading-relaxed text-ink-2">${unescapeHTML(body())}</p></aside>`}${block.type === "code" && (() => {
			const h = codeHighlight.get(block.id) ?? {};
			return renderTemplate`<figure class="code-figure"><figcaption class="code-bar"><span class="meta" data-code-lang>${h.lang ?? block.lang}</span><button type="button" class="meta code-copy" data-code-copy aria-label="Copy this snippet">Copy</button></figcaption><pre class="code-body"${addAttribute(block.code, "data-code")}${addAttribute(h.paper ? "1" : "0", "data-highlighted")}>
                    ${h.paper ? renderTemplate`${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`
                        <code class="theme-paper">${unescapeHTML(h.paper)}</code>
                        ${h.ink && renderTemplate`<code class="theme-ink">${unescapeHTML(h.ink)}</code>`}
                      ` })}` : renderTemplate`<code>${block.code}</code>`}
                  </pre>${block.caption && renderTemplate`<figcaption class="meta mt-2">${block.caption}</figcaption>`}</figure>`;
		})()}${block.type === "list" && (block.ordered ? renderTemplate`<ol class="list-decimal pl-6 space-y-2">${block.items.map((item) => renderTemplate`<li>${unescapeHTML(renderInline(item))}</li>`)}</ol>` : renderTemplate`<ul class="list-none pl-0 space-y-2">${block.items.map((item) => renderTemplate`<li class="flex gap-3"><span aria-hidden="true" class="text-ink-3 select-none">—</span><span>${unescapeHTML(renderInline(item))}</span></li>`)}</ul>`)}${block.type === "table" && renderTemplate`<div class="overflow-x-auto"><table class="w-full border-collapse text-[0.9375rem]"><thead><tr>${block.head.map((h) => renderTemplate`<th class="border-b border-rule-strong px-3 py-2 text-left font-medium">${unescapeHTML(renderInline(h))}</th>`)}</tr></thead><tbody>${block.rows.map((row) => renderTemplate`<tr>${row.map((cell) => renderTemplate`<td class="border-b border-rule px-3 py-2 align-top text-ink-2">${unescapeHTML(renderInline(cell))}</td>`)}</tr>`)}</tbody></table></div>`}${block.type === "figure" && renderTemplate`<figure><img${addAttribute(block.src, "src")}${addAttribute(block.alt, "alt")} loading="lazy" decoding="async">${block.caption && renderTemplate`<figcaption class="meta mt-2">${block.caption}</figcaption>`}</figure>`}${block.type === "interactive" && renderTemplate`${renderComponent($$result, "Artifact", $$Artifact, {
			"component": block.component,
			"title": block.title,
			"props": block.props
		})}`}</div>${hasNotes && renderTemplate`<div class="block-notes"${addAttribute(id, "data-notes-for")}><p class="meta mb-2 xl:sr-only">${blockNotes.length === 1 ? "1 note" : `${blockNotes.length} notes`}</p>${blockNotes.map((note) => renderTemplate`${renderComponent($$result, "NoteCard", $$NoteCard, {
			"id": note.id,
			"kind": note.kind,
			"body": note.body,
			"authorName": note.authorName,
			"authorHandle": note.authorHandle,
			"createdAt": note.createdAt,
			"editedAt": note.editedAt,
			"isAuthor": note.isAuthor,
			"isMine": note.isMine,
			"isAccepted": note.isAccepted,
			"onOlderRevision": note.onOlderRevision,
			"anchorLost": note.resolved.status === "lost",
			"quote": note.anchor.quote,
			"versionNumber": note.versionNumber,
			"postSlug": postSlug,
			"postId": postId,
			"canAccept": canAccept,
			"returnTo": returnTo,
			"mine": mine,
			"replies": replies[note.id] ?? [],
			"reactions": note.reactions
		})}`)}</div>`}</div>`;
	})}</div><script>
  (() => {
    /* Copy a snippet. The raw text is carried in data-code, because the visible
       markup is full of span elements and copying the DOM would copy the
       highlighting with it. */
    for (const btn of document.querySelectorAll('[data-code-copy]')) {
      btn.addEventListener('click', async () => {
        const pre = btn.closest('.code-figure')?.querySelector('[data-code]');
        const text = pre?.getAttribute('data-code') ?? '';
        if (!text) return;
        try {
          await navigator.clipboard.writeText(text);
          btn.textContent = 'Copied';
          btn.setAttribute('data-state', 'copied');
        } catch {
          // Clipboard denied (insecure context, or the reader said no): say so
          // rather than pretending it worked.
          btn.textContent = 'Ctrl+C';
        }
        setTimeout(() => {
          btn.textContent = 'Copy';
          btn.removeAttribute('data-state');
        }, 1600);
      });
    }
  })();
<\/script>`;
}, "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/components/Prose.astro", void 0);
//#endregion
//#region src/components/DepthDial.astro
createAstro("http://localhost:4321");
var $$DepthDial = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$DepthDial;
	const { initial, minutes, hasUnderstand, hasMaster } = Astro.props;
	const available = [
		{
			value: "skim",
			label: "Skim",
			hint: "The argument only."
		},
		{
			value: "understand",
			label: "Read",
			hint: "Full argument, prerequisites explained inline."
		},
		{
			value: "master",
			label: "Study",
			hint: "Everything — footnotes, citations, author notes."
		}
	].filter((o) => {
		if (o.value === "understand" && !hasUnderstand) return false;
		if (o.value === "master" && !hasMaster) return false;
		return true;
	});
	const active = available.find((o) => o.value === initial) ?? available[0];
	return renderTemplate`${available.length < 2 ? renderTemplate`${maybeRenderHead($$result)}<div class="flex items-baseline justify-between gap-4 border border-rule bg-surface px-4 py-3"><p class="text-[0.9375rem] text-ink-2">${active.hint}</p><p class="meta shrink-0 tabular-nums">${minutes[active.value] ? `${minutes[active.value]} min` : ""}</p></div>` : renderTemplate`<div class="border border-rule bg-surface" data-depth-dial><div class="flex items-stretch" role="group" aria-label="Reading depth">${available.map((o) => {
		const on = o.value === initial;
		const mins = minutes[o.value] ?? 0;
		return renderTemplate`<button type="button"${addAttribute(o.value, "data-depth")}${addAttribute(o.hint, "data-hint")}${addAttribute(on ? "true" : "false", "aria-pressed")}${addAttribute(["flex-1 border-r border-rule px-2 py-2 text-left transition-colors last:border-r-0", on ? "bg-ink text-paper" : "text-ink-2 hover:bg-sunken hover:text-ink"], "class:list")}><span class="block font-sans text-[0.9375rem] leading-tight font-medium">${o.label}</span><span${addAttribute(["meta block leading-tight tabular-nums", on ? "text-paper/70" : "text-ink-3"], "class:list")}>${mins > 0 ? `${mins} min` : "—"}</span></button>`;
	})}</div><p class="border-t border-rule px-3 py-1.5 text-[0.8125rem] leading-snug text-ink-3" data-depth-hint>${active.hint}</p></div>`}${renderScript($$result, "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/components/DepthDial.astro?astro&type=script&index=0&lang.ts")}`;
}, "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/components/DepthDial.astro", void 0);
//#endregion
//#region src/components/Marginalia.astro
createAstro("http://localhost:4321");
var $$Marginalia = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$Marginalia;
	const { postId, versionId, canWriteAuthorNote, signedInAs } = Astro.props;
	return renderTemplate`${maybeRenderHead($$result)}<!-- Discoverability. Before this script runs there is no affordance at all, so
     a reader who selects a sentence gets nothing and concludes the feature
     does not exist. This is the hint that closes that gap. --><p class="fixed bottom-3 left-3 z-40 hidden border border-rule bg-surface px-3 py-2 lg:block" data-marginalia-hint><span class="meta">Select any sentence to leave a note</span></p><!-- The affordance the script positions. Kept in markup (rather than built in
     JS) so it is one predictable node, not something assembled on selection. --><div class="affordance-group hidden" data-marginalia-affordance><button type="button" class="affordance" data-marginalia-note>Leave a note →</button><button type="button" class="affordance" data-marginalia-highlight aria-label="Highlight this for yourself">Highlight</button></div><script>(function(){${defineScriptVars({
		postId,
		versionId,
		canWriteAuthorNote,
		signedInAs
	})}
  (() => {
    const KINDS = [
      { value: 'comment', label: 'Comment', hint: 'A general response to this sentence.' },
      { value: 'correction', label: 'Correction', hint: 'This is wrong. Say what is right.' },
      { value: 'extension', label: 'Extension', hint: 'It goes further than the post claims.' },
      { value: 'disagreement', label: 'Disagreement', hint: 'The conclusion does not follow.' },
      { value: 'worked_example', label: 'Worked example', hint: 'Concrete numbers or a case.' },
      { value: 'update', label: 'Update', hint: 'This has since changed in the world.' },
    ];

    const hint = document.querySelector('[data-marginalia-hint]');
    const affordance = document.querySelector('[data-marginalia-affordance]');
    if (!affordance) return;

    /** Current selection, or null. */
    let selection = null; // { blockId, quote, prefixHint, suffixHint, x, y, range }
    let composer = null;
    let kind = 'comment';
    let scrollAtSelection = window.scrollY;

    const clear = () => {
      selection = null;
      affordance.classList.add('hidden');
      if (composer) {
        composer.remove();
        composer = null;
      }
      if (hint) hint.classList.remove('hidden');
    };

    /* --- selection capture ------------------------------------------------ */
    function onSelect() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const text = sel.toString().replace(/\\s+/g, ' ').trim();
      if (text.length < 3 || text.length > 600) return;
      const node = sel.anchorNode;
      const el = node instanceof Element ? node : node?.parentElement;
      const block = el?.closest('[data-block-id]');
      if (!block) return;
      const type = block.getAttribute('data-block-type');
      if (!type || !['paragraph', 'quote', 'tldr', 'callout', 'list'].includes(type)) return;
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;

      const blockText = block.textContent ?? '';
      const at = blockText.indexOf(text);
      scrollAtSelection = window.scrollY;
      selection = {
        blockId: block.getAttribute('data-block-id'),
        quote: text,
        prefixHint: at > 0 ? blockText.slice(Math.max(0, at - 64), at) : '',
        suffixHint: at >= 0 ? blockText.slice(at + text.length, at + text.length + 64) : '',
        x: rect.left + rect.width / 2,
        y: rect.top,
        range: range.cloneRange(),
      };
      positionAffordance();
    }

    function positionAffordance() {
      if (!selection) return;
      affordance.classList.remove('hidden');
      if (hint) hint.classList.add('hidden');
      affordance.style.left = Math.min(Math.max(selection.x, 110), window.innerWidth - 110) + 'px';
      affordance.style.top = Math.max(selection.y - 8, 40) + 'px';
    }

    function onDown(e) {
      const t = e.target;
      if (composer && composer.contains(t)) return;
      if (t instanceof Element && t.closest('.affordance')) return;
      if (t instanceof Element && t.closest('[data-note-anchor]')) return;
      clear();
    }
    function onKey(e) {
      if (e.key === 'Escape') clear();
    }
    function onScroll() {
      if (Math.abs(window.scrollY - scrollAtSelection) < 40) return;
      clear();
    }
    document.addEventListener('selectionchange', onSelect);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, { passive: true });

    /* --- highlight --------------------------------------------------------- */
    async function highlightSelection() {
      const sel = selection;
      if (!sel) return;
      const range = sel.range;
      clear();
      try {
        const res = await fetch('/api/highlight', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ postId, blockId: sel.blockId, text: sel.quote }),
        });
        if (!res.ok) return;
        // Wrap the exact range the reader selected, so the mark lands on the
        // words they chose and not the whole paragraph. Unwrapping on a second
        // click keeps it a true toggle in place. A range that crosses element
        // boundaries cannot be wrapped as one node; the reader's own list at the
        // article foot still shows it.
        if (range && range.startContainer.parentElement) {
          const existing = range.startContainer.parentElement.closest('mark[data-reader-highlight]');
          if (existing) {
            existing.replaceWith(...Array.from(existing.childNodes));
          } else if (!range.collapsed) {
            const mark = document.createElement('mark');
            mark.setAttribute('data-reader-highlight', '');
            try {
              range.surroundContents(mark);
            } catch {}
          }
        }
      } catch {}
    }

    /* --- composer ---------------------------------------------------------- */
    function openComposer(sel) {
      if (!sel || composer) return;
      const el = document.createElement('div');
      el.className =
        'fixed inset-x-3 bottom-3 z-50 mx-auto max-w-lg border border-rule-strong bg-surface p-4 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:left-auto sm:mx-0';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-label', 'Leave a note');
      el.innerHTML = \`
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="meta">Attached to</p>
            <p class="mt-1 line-clamp-2 border-l-2 border-accent pl-2 text-[0.8125rem] leading-snug text-ink-2 italic" data-quote></p>
          </div>
          <button type="button" class="meta shrink-0 px-1 text-ink-3 hover:text-ink" data-close aria-label="Close">✕</button>
        </div>
        <form class="mt-3">
          <label class="meta" for="note-kind">What kind of note?</label>
          <div class="mt-1.5 flex flex-wrap gap-1" data-kinds></div>
          <p class="mt-1.5 text-[0.75rem] leading-snug text-ink-3" data-kind-hint></p>
          <label class="meta mt-3 block" for="note-body">Your note</label>
          <p class="mt-1.5 text-[0.75rem] leading-snug text-ink-3" data-empty>Empty for now. The notes that survive on a post are the ones that would be worth reading on their own — a number, a case, or the sentence you think is wrong.</p>
          <textarea id="note-body" rows="4" maxlength="4000" placeholder="Be specific. The best notes here are the ones that would be worth reading on their own." class="mt-1.5 w-full resize-y border border-rule bg-paper px-3 py-2 text-[0.9375rem] leading-relaxed focus:border-accent focus:outline-none"></textarea>
          <p class="mt-2 hidden border border-danger px-3 py-2 text-[0.8125rem] text-danger" data-error role="alert"></p>
          <div class="mt-3 flex items-center justify-between gap-3">
            <div class="min-w-0">
              <p class="text-[0.75rem] leading-snug text-ink-3">\${signedInAs ? \`Posting as \${signedInAs}.\` : 'Posting anonymously. You can claim these notes later.'}</p>
              <label class="mt-1.5 flex cursor-pointer items-center gap-2 text-[0.75rem] text-ink-3">
                <input type="checkbox" class="h-3.5 w-3.5 accent-[var(--accent)]" data-private> Only I can see this
              </label>
            </div>
            <button type="submit" class="shrink-0 border border-ink bg-ink px-3 py-1.5 text-[0.875rem] text-paper transition-colors hover:border-accent hover:bg-accent disabled:cursor-not-allowed disabled:border-rule disabled:bg-transparent disabled:text-ink-3">Post note</button>
          </div>
        </form>\`;
      el.querySelector('[data-quote]').textContent = sel.quote;
      el.querySelector('[data-close]').addEventListener('click', clear);
      document.body.appendChild(el);
      composer = el;
      selection = null;
      affordance.classList.add('hidden');
      if (hint) hint.classList.add('hidden');

      const kindsEl = el.querySelector('[data-kinds]');
      const kindHintEl = el.querySelector('[data-kind-hint]');
      const renderKinds = () => {
        kindsEl.innerHTML = '';
        for (const k of KINDS) {
          const b = document.createElement('button');
          b.type = 'button';
          b.textContent = k.label;
          b.setAttribute('aria-pressed', k.value === kind ? 'true' : 'false');
          b.className =
            'border px-2 py-1 text-[0.75rem] transition-colors ' +
            (k.value === kind ? 'border-accent text-accent' : 'border-rule text-ink-3 hover:border-rule-strong hover:text-ink');
          b.addEventListener('click', () => {
            kind = k.value;
            renderKinds();
            kindHintEl.textContent = k.hint;
          });
          kindsEl.appendChild(b);
        }
      };
      renderKinds();
      kindHintEl.textContent = KINDS[0].hint;

      const textarea = el.querySelector('textarea');
      const submit = el.querySelector('button[type=submit]');
      const errorEl = el.querySelector('[data-error]');
      const emptyEl = el.querySelector('[data-empty]');
      textarea.addEventListener('input', () => {
        const has = textarea.value.trim().length > 0;
        submit.disabled = !has;
        emptyEl.classList.toggle('hidden', has);
      });
      submit.disabled = true;
      requestAnimationFrame(() => textarea.focus());

      el.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const body = textarea.value.trim();
        if (!body) return;
        submit.disabled = true;
        submit.textContent = 'Saving…';
        errorEl.classList.add('hidden');
        try {
          const res = await fetch('/api/annotations', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              postId,
              versionId,
              blockId: sel.blockId,
              quote: sel.quote,
              prefixHint: sel.prefixHint,
              suffixHint: sel.suffixHint,
              kind,
              body,
              isPrivate: el.querySelector('[data-private]').checked,
            }),
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok || !json.id) {
            errorEl.textContent = json.error ?? 'Could not save that note.';
            errorEl.classList.remove('hidden');
            submit.disabled = false;
            submit.textContent = 'Post note';
            return;
          }
          insertLocally(json.id, sel.blockId, sel.quote, body, kind);
          // Leave the panel open briefly so the reader sees their note land,
          // then dismiss. Dismissing instantly reads as the note being swallowed.
          setTimeout(clear, 700);
        } catch {
          errorEl.textContent = 'Network error. Your note was not saved.';
          errorEl.classList.remove('hidden');
          submit.disabled = false;
          submit.textContent = 'Post note';
        }
      });
    }

    /* --- optimistic insert -------------------------------------------------- */
    function insertLocally(id, blockId, quote, body, _kind) {
      if (!blockId) return;
      const block = document.querySelector(\`[data-block-id="\${CSS.escape(blockId)}"]\`);
      if (!block) return;
      let rail = block.querySelector('.block-notes');
      if (!rail) {
        rail = document.createElement('div');
        rail.className = 'block-notes';
        rail.setAttribute('data-notes-for', blockId);
        block.appendChild(rail);
      }
      const count = rail.querySelector('.meta');
      if (count) count.textContent = '1 note';
      const label = KINDS.find((k) => k.value === kind)?.label ?? 'Comment';
      rail.insertAdjacentHTML(
        'afterbegin',
        \`<article class="border-b border-rule py-3" data-note-id="\${id}">
           <p class="meta note-kind-\${kind}">\${label}</p>
           <blockquote class="mt-1.5 border-l-2 border-rule-strong pl-2 text-[0.8125rem] leading-snug text-ink-3 italic"></blockquote>
           <p class="mt-1.5 text-[0.875rem] leading-relaxed text-ink-2"></p>
           <p class="meta mt-1.5">\${signedInAs ?? 'Anonymous'} · just now</p>
         </article>\`,
      );
      const article = rail.querySelector('[data-note-id]');
      if (article) {
        article.querySelector('blockquote').textContent = quote;
        article.querySelectorAll('p')[1].textContent = body;
      }
    }

    // Wire the affordance buttons. The note button hands its captured selection
    // to the composer; the highlight button consumes it in place.
    affordance.querySelector('[data-marginalia-note]').addEventListener('click', () => {
      const sel = selection;
      if (sel) openComposer(sel);
    });
    affordance.querySelector('[data-marginalia-highlight]').addEventListener('click', highlightSelection);
  })();
})();<\/script>`;
}, "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/components/Marginalia.astro", void 0);
//#endregion
//#region src/lib/repo/ask.ts
/**
* Ask this article — extractive, grounded, offline.
*
* There is no model here, and that is the point for v1: the answer is always
* quotes from *this* post, so it cannot hallucinate, cannot import outside
* knowledge, and costs nothing to run. A question with no match gets "this
* isn't covered in the article" rather than an invented answer — and that
* refusal is logged, because the questions readers had to ask are the
* writer's to-do list (§4.5: asking improves the article for everyone).
*
* The retrieval is block-scoped FTS over this post only. A post-level index
* would let a neighboring post's vocabulary answer for this one; filtering by
* `post_id` inside the query makes that structurally impossible. When a model
* arrives it answers *from these passages*, behind the per-author caps — the
* interface is the passages, not the prose.
*/
function toFtsQuery(raw) {
	const terms = raw.split(/\s+/).map((t) => t.replace(/["*]/g, "").trim()).filter((t) => t.length > 1).slice(0, 10);
	if (terms.length === 0) return null;
	return terms.map((t) => `"${t}"`).join(" ");
}
async function askPost(postId, versionId, question, askedById, limit = 3) {
	const started = Date.now();
	const clean = question.trim().slice(0, 500);
	const query = clean.length >= 2 ? toFtsQuery(clean) : null;
	let passages = [];
	if (query) passages = (await (await readyDb()).all(sql`
      SELECT block_id AS block_id,
        snippet(block_fts, 0, '<mark>', '</mark>', '…', 32) AS quote
      FROM block_fts
      WHERE post_id = ${postId} AND block_fts MATCH ${query}
      ORDER BY rank
      LIMIT ${limit}
    `)).map((r) => ({
		blockId: r.block_id,
		quote: r.quote
	}));
	const latencyMs = Date.now() - started;
	const matched = passages.length > 0;
	let answer = null;
	let modelLabel = null;
	let mode = "extractive";
	{
		let model = null;
		try {
			model = await answerFromAnyModel(postId, askedById, passages.map((p) => p.quote), clean);
		} catch (err) {
			console.error("[strata] ask model path failed, falling back:", err);
		}
		if (model) {
			answer = model.text;
			modelLabel = model.label;
			mode = "model";
		}
	}
	try {
		await (await readyDb()).insert(asks).values({
			id: nanoid(),
			postId,
			versionId,
			blockId: null,
			question: clean,
			answer: answer ?? (matched ? passages.map((p) => p.quote.replace(/<\/?mark>/g, "")).join("\n\n") : ""),
			citations: JSON.stringify(passages.map((p) => ({ blockId: p.blockId }))),
			mode,
			latencyMs,
			askedById
		});
	} catch (err) {
		console.error("[strata] ask log failed:", err);
	}
	return {
		question: clean,
		matched,
		passages,
		latencyMs,
		answer,
		modelLabel,
		mode
	};
}
//#endregion
//#region src/pages/w/[slug].astro
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
	const post = slug ? await getPostBySlug(slug) : null;
	if (!post) return new Response(null, {
		status: 404,
		statusText: "Not found"
	});
	const anonId = ensureAnonId(Astro.cookies);
	const identity = await getIdentity(Astro.cookies);
	const prefs = resolvePrefs(Astro.cookies, anonId);
	const depth = prefs.depth;
	const requestedRev = Number(Astro.url.searchParams.get("rev") ?? "");
	const isViewingOld = Number.isFinite(requestedRev) && requestedRev > 0;
	const view = await getRevisionView(post.id, isViewingOld ? requestedRev : void 0);
	if (!view) return new Response(null, {
		status: 404,
		statusText: "Not found"
	});
	const doc = post.blocks;
	const hasUnderstand = doc.some((b) => b.layer === "understand");
	const hasMaster = doc.some((b) => b.layer === "master");
	const minutes = {
		skim: minutesAtDepth(doc, "skim"),
		understand: minutesAtDepth(doc, "understand"),
		master: minutesAtDepth(doc, "master")
	};
	(async () => {
		try {
			await recordRead({
				postId: post.id,
				versionId: post.version.id,
				anonId,
				userId: identity.userId
			});
			await incrementViews(post.id);
		} catch (err) {
			console.error("[strata] read receipt failed", err);
		}
	})();
	const versions = await getVersions(post.id);
	const lastSeen = await getLastReceipt(anonId, post.id);
	const hasChangesSince = Boolean(lastSeen && lastSeen.versionId !== view.current.id && lastSeen.versionNumber < view.current.versionNumber);
	const stats = diffStats(view.diff);
	const reviewed = post.lastReviewedAt ? shortAgo(post.lastReviewedAt) : null;
	const { newer, older } = await getAdjacent(post.id);
	const blockTexts = new Map(doc.map((b) => [b.id, blockToPlainText(b)]));
	const allNotes = await listAnnotations(post.id, blockTexts, {
		anonId,
		authorId: identity.userId,
		currentVersionId: post.currentVersionId ?? ""
	});
	const NOTE_SORTS = [
		"newest",
		"top",
		"contested",
		"author"
	];
	const sortParam = Astro.url.searchParams.get("notes");
	const noteSort = NOTE_SORTS.includes(sortParam ?? "") ? sortParam : "newest";
	const reactionTotal = (n) => n.reactions.useful + n.reactions.insightful + n.reactions.source;
	const sortNotes = (list) => {
		const copy = [...list];
		switch (noteSort) {
			case "top": return copy.sort((a, b) => reactionTotal(b) - reactionTotal(a) || a.createdAt - b.createdAt);
			case "contested": return copy.sort((a, b) => {
				const rank = (n) => (n.kind === "disagreement" || n.kind === "correction" ? 1e3 : 0) + n.replies;
				return rank(b) - rank(a) || a.createdAt - b.createdAt;
			});
			case "author": return copy.sort((a, b) => Number(b.isAuthor) - Number(a.isAuthor) || a.createdAt - b.createdAt);
			default: return copy.sort((a, b) => b.createdAt - a.createdAt);
		}
	};
	const rootNotes = allNotes.filter((n) => !n.parentId);
	const repliesByParent = {};
	for (const note of allNotes) {
		if (!note.parentId) continue;
		(repliesByParent[note.parentId] ??= []).push(note);
	}
	for (const list of Object.values(repliesByParent)) list.sort((a, b) => a.createdAt - b.createdAt);
	const notesByBlock = {};
	for (const note of sortNotes(rootNotes)) (notesByBlock[note.blockId] ??= []).push(note);
	const participants = await countParticipants(post.id);
	const myNoteCount = allNotes.filter((n) => n.isMine).length;
	const isPostAuthor = identity.userId === post.authorId;
	const staleNotes = allNotes.filter((n) => n.onOlderRevision).length;
	const mineReactions = [...await myReactions(voterKeyFor(identity.userId, anonId), allNotes.map((n) => n.id))];
	const isSavedNow = await isSaved(memoryKeyFor(identity.userId, anonId), post.id);
	const ownLists = identity.userId ? await myReadingLists(identity.userId) : [];
	const myHighlights = (await getMyHighlights(anonId, identity.userId)).filter((h) => h.postSlug === post.slug);
	const myHighlightCount = myHighlights.length;
	const returnTo = Astro.url.pathname + Astro.url.search;
	const noteError = Astro.url.searchParams.get("noteError");
	const subscribeState = Astro.url.searchParams.get("subscribe");
	const errorNoteId = Astro.url.searchParams.get("note");
	const askQuery = (Astro.url.searchParams.get("ask") ?? "").trim().slice(0, 500);
	const askAsked = askQuery.length >= 3;
	const askResult = askAsked ? await askPost(post.id, view.current.id, askQuery, identity.userId) : null;
	const title = isViewingOld ? `${post.title} (revision ${view.current.versionNumber})` : post.title;
	const description = post.seoDescription || stripInline(post.dek);
	const diffByBlock = Object.fromEntries(view.diff.map((d) => [d.blockId, d.segments]));
	const changeByBlock = Object.fromEntries(view.diff.map((d) => [d.blockId, d.status]));
	const jsonLd = [{
		"@type": "Article",
		headline: post.title,
		description,
		datePublished: new Date(post.publishedAt ?? post.createdAt).toISOString(),
		dateModified: new Date(view.current.createdAt).toISOString(),
		author: {
			"@type": "Person",
			name: post.authorName
		},
		isAccessibleForFree: true,
		version: view.current.versionNumber,
		...post.topicName ? { articleSection: post.topicName } : {}
	}, {
		"@type": "Person",
		name: post.authorName,
		url: `/a/${post.authorHandle}`
	}];
	return renderTemplate`${renderComponent($$result, "Base", $$Base, {
		"title": title,
		"description": description,
		"ogType": "article",
		"ogImage": `/og/${post.slug}-diff.png`,
		"prefs": prefs,
		"jsonLd": jsonLd
	}, { "default": async ($$result) => renderTemplate`${maybeRenderHead($$result)}<article data-depth-host${addAttribute(depth, "data-depth")}${addAttribute(post.id, "data-post-id")}${addAttribute(view.current.versionNumber, "data-version")}><header class="shell border-b border-rule pt-10 pb-8"><div class="article-body"><div class="flex flex-wrap items-center gap-x-4 gap-y-2">${renderComponent($$result, "StatusBadge", $$StatusBadge, { "status": post.status })}${post.topicName && renderTemplate`<a href="/topics" class="meta no-underline hover:text-ink">${post.topicName}</a>`}<span class="meta">${longDate(post.publishedAt)}</span>${view.current.versionNumber > 1 && renderTemplate`<span class="meta">revised ${view.current.versionNumber}× · ${shortAgo(view.current.createdAt)}</span>`}</div><h1 class="mt-5 text-3xl">${post.title}</h1>${post.dek && renderTemplate`<p class="mt-4 text-[1.125rem] leading-relaxed text-ink-2">${post.dek}</p>`}<p class="mt-5 text-[0.9375rem] text-ink-3"><a${addAttribute(`/a/${post.authorHandle}`, "href")} class="text-ink-2 no-underline hover:text-accent">${post.authorName}</a>${post.annotationTotal > 0 && renderTemplate`${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${" · "}<a href="#marginalia" class="text-ink-2 no-underline hover:text-accent">${plural(post.annotationTotal, "note")} in the margin</a>` })}`}${reviewed && renderTemplate`<span> · reviewed ${reviewed}</span>`}<span data-presence aria-hidden="true"></span></p></div></header><script>(function(){${defineScriptVars({ postId: post.id })}
      (() => {
        /* Presence heartbeat: anonymous, silent, ambient. Beats while the page
           is visible; the count next to the byline updates from the same
           endpoint. Nothing here identifies anyone — the server only ever
           counts, and a failed beat changes nothing on screen. */
        const slot = document.querySelector('[data-presence]');
        if (!slot) return;
        const paint = (n) => {
          slot.textContent = n >= 2 ? \` · \${n} reading now\` : '';
        };
        const beat = async () => {
          try {
            await fetch('/api/presence', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ postId }),
              keepalive: true,
            });
            const res = await fetch(\`/api/presence?postId=\${encodeURIComponent(postId)}\`);
            if (!res.ok) return;
            const json = await res.json();
            if (typeof json.readers === 'number') paint(json.readers);
          } catch {
            // Ambient. Never break the page over it.
          }
        };
        const tick = () => {
          if (document.visibilityState === 'visible') void beat();
        };
        void beat();
        window.setInterval(tick, 30000);
        document.addEventListener('visibilitychange', tick);
      })();
    })();<\/script><div class="shell"><div class="article-body mt-6 space-y-3">${hasChangesSince && !isViewingOld && renderTemplate`<div class="border border-accent bg-accent-soft px-4 py-3"><p class="text-[0.9375rem]"><strong class="font-medium">This post has changed since you read it.</strong>${" "}<span class="text-ink-2">You last saw version ${lastSeen.versionNumber}. ${plural(stats.changed, "change")} since.</span></p><a${addAttribute(`?rev=${view.current.versionNumber}`, "href")} class="meta mt-2 inline-block text-accent no-underline hover:underline">See what changed →</a></div>`}${noteError && renderTemplate`<div class="border border-danger px-4 py-3" role="alert"${addAttribute(errorNoteId ? `error-for-note-${errorNoteId}` : void 0, "id")}><p class="text-[0.9375rem] text-danger">${noteError}</p><p class="meta mt-1">Nothing was changed.</p></div>`}${isViewingOld && renderTemplate`<div class="border border-ochre px-4 py-3"><p class="text-[0.9375rem]"><strong class="font-medium">Viewing revision ${view.current.versionNumber}</strong>${" "}<span class="text-ink-2">— ${view.compared ? `changes shown against revision ${view.compared.versionNumber}` : "the first published version"}. Written ${ago(view.current.createdAt)}.</span></p><p class="meta mt-2">${view.current.changeSummary}</p><a${addAttribute(`/w/${post.slug}`, "href")} class="meta mt-2 inline-block text-ochre no-underline hover:underline">← Back to the current version</a></div>`}</div></div><div class="shell mt-8"><div class="article-body">${renderComponent($$result, "Prose", $$Prose, {
		"blocks": doc,
		"diffSegments": isViewingOld && view.compared ? diffByBlock : void 0,
		"changeStatus": isViewingOld && view.compared ? changeByBlock : void 0,
		"notes": notesByBlock,
		"replies": repliesByParent,
		"postSlug": post.slug,
		"postId": post.id,
		"canAccept": isPostAuthor,
		"returnTo": returnTo,
		"mine": mineReactions
	})}</div></div><div class="shell mt-16"><div class="article-body space-y-10"><section aria-labelledby="depth-heading" class="border-t border-rule pt-6"><h2 id="depth-heading" class="meta mb-3">How deep do you want this?</h2>${!Astro.cookies.has("strata_depth") && renderTemplate`<p class="mb-3 max-w-xl border-l-2 border-accent pl-3 text-[0.9375rem] leading-relaxed text-ink-2">First time here? <strong class="font-medium text-ink">Set your depth once</strong> and every post honors it — skim the argument, read it properly, or take the footnotes too.</p>`}${renderComponent($$result, "DepthDial", $$DepthDial, {
		"initial": depth,
		"minutes": minutes,
		"hasUnderstand": hasUnderstand,
		"hasMaster": hasMaster
	})}</section><section aria-labelledby="revisions-heading" class="border-t border-rule pt-6"><div class="flex items-baseline justify-between gap-4"><h2 id="revisions-heading" class="meta">Revision history</h2>${isViewingOld && renderTemplate`<a${addAttribute(`/w/${post.slug}`, "href")} class="meta text-accent no-underline hover:underline">current →</a>`}</div>${isViewingOld && view.compared && stats.changed > 0 && renderTemplate`<p class="mt-2 text-[0.9375rem] text-ink-2">${[
		stats.modified > 0 && `${plural(stats.modified, "paragraph")} rewritten`,
		stats.added > 0 && `${stats.added} added`,
		stats.removed > 0 && `${stats.removed} removed`
	].filter(Boolean).join(" · ")}</p>`}<ol class="mt-4 space-y-3">${versions.map((v) => {
		const isViewing = v.id === view.current.id;
		const isHead = v.id === post.currentVersionId;
		return renderTemplate`<li class="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-rule pb-3 last:border-b-0"><span class="meta w-8 tabular-nums">v${v.versionNumber}</span><a${addAttribute(`?rev=${v.versionNumber}`, "href")}${addAttribute(["text-[0.9375rem] no-underline", isViewing ? "text-ink" : "text-ink-2 hover:text-accent"], "class:list")}${addAttribute(isViewing ? "true" : void 0, "aria-current")}>${v.changeSummary}</a><span class="meta">${shortAgo(v.createdAt)}</span>${v.isMajor && !isHead && renderTemplate`<span class="meta text-ochre">major</span>`}${isHead && renderTemplate`<span class="meta text-pine">current</span>`}${isViewing && !isHead && renderTemplate`<span class="meta text-accent">viewing</span>`}</li>`;
	})}</ol></section>${post.visibility === "public" && post.publishedAt && !isViewingOld && renderTemplate`<section aria-label="Keep this post" class="border-t border-rule pt-6"><div class="flex flex-wrap items-baseline gap-x-5 gap-y-2"><form method="post" action="/api/memory" class="contents"><input type="hidden" name="action" value="save"><input type="hidden" name="postId"${addAttribute(post.id, "value")}><input type="hidden" name="returnTo"${addAttribute(returnTo, "value")}><button type="submit"${addAttribute(isSavedNow, "aria-pressed")} class="meta text-ink-3 no-underline hover:text-ink">${isSavedNow ? "Saved ✓ — in your reading" : "Save for later"}</button></form>${identity.userId && ownLists.length > 0 && renderTemplate`<details class="note-disclosure"><summary class="meta cursor-pointer text-ink-3 hover:text-ink">Add to a list</summary><form method="post" action="/api/lists" class="mt-2 flex flex-wrap items-center gap-2"><input type="hidden" name="action" value="add"><input type="hidden" name="postId"${addAttribute(post.id, "value")}><input type="hidden" name="returnTo"${addAttribute(returnTo, "value")}><label class="sr-only" for="add-to-list">Choose a list</label><select id="add-to-list" name="listId" class="border border-rule bg-paper px-2 py-1 text-[0.8125rem] focus:border-accent focus:outline-none">${ownLists.map((l) => renderTemplate`<option${addAttribute(l.id, "value")}>${l.title}${l.isPublic ? "" : " (private)"}</option>`)}</select><button type="submit" class="border border-rule px-2 py-1 text-[0.8125rem] text-ink-3 transition-colors hover:border-ink hover:text-ink">Add</button></form></details>`}${identity.userId ? renderTemplate`<form method="post" action="/api/fork" class="flex flex-wrap items-baseline gap-x-3 gap-y-2"><input type="hidden" name="postId"${addAttribute(post.id, "value")}><input type="hidden" name="returnTo"${addAttribute(returnTo, "value")}><button type="submit" class="meta text-ink-3 no-underline hover:text-ink">Fork this post →</button><span class="text-[0.8125rem] text-ink-3">Your own seedling, starting from this text. The ancestor is credited permanently.</span></form>` : renderTemplate`<p class="text-[0.8125rem] text-ink-3"><a href="/write#handle" class="text-ink-3 underline hover:text-ink">Claim a handle</a>${" "}to fork this post into your own seedling.</p>`}</div></section>`}<section id="marginalia" aria-labelledby="marginalia-heading" class="border-t border-rule pt-6"><div class="flex flex-wrap items-baseline justify-between gap-3"><h2 id="marginalia-heading" class="meta">Marginalia</h2>${myNoteCount > 0 && renderTemplate`<a href="#marginalia" class="meta no-underline hover:text-ink">${plural(myNoteCount, "note")} of yours on this post</a>`}</div><p class="mt-2 max-w-xl text-[0.9375rem] leading-relaxed text-ink-2">${allNotes.length === 0 ? "No notes yet. Select any sentence in the text to leave the first one — no account needed." : `${plural(allNotes.length, "note")} from ${plural(participants, "reader")}, attached to specific sentences. Select any sentence in the text to add yours.`}</p>${allNotes.some((n) => n.onOlderRevision) && renderTemplate`<p class="mt-2 max-w-xl text-[0.875rem] leading-relaxed text-ochre">${`${plural(staleNotes, "note")} here ${verb(staleNotes, "argues", "argue")} with an earlier revision of this post and ${verb(staleNotes, "links", "link")} to it.`}</p>`}${allNotes.length > 1 && renderTemplate`<nav aria-label="Order the notes" class="mt-3 flex flex-wrap items-center gap-2"><span class="meta">Order</span>${NOTE_SORTS.map((s) => renderTemplate`<a${addAttribute(`?notes=${s}`, "href")}${addAttribute(noteSort === s ? "true" : void 0, "aria-current")}${addAttribute(["meta no-underline transition-colors", noteSort === s ? "text-accent" : "text-ink-3 hover:text-ink"], "class:list")}>${s}</a>`)}${noteSort !== "newest" && renderTemplate`<a${addAttribute(Astro.url.pathname, "href")} class="meta text-ink-3 no-underline hover:text-ink">reset</a>`}</nav>`}</section><section id="ask" aria-labelledby="ask-heading" class="border-t border-rule pt-6"><h2 id="ask-heading" class="meta">Ask this article</h2><p class="mt-2 max-w-xl text-[0.9375rem] leading-relaxed text-ink-2">Answers are quotes from this post, not generated text — so they can be wrong by omission but never by invention. What it does not cover, it says so. If you have brought your own model key, a model summarizes those same quotes, and the quotes stay the source of truth.</p><form method="get" action="#ask" class="mt-4 flex max-w-xl gap-2" role="search"><label class="sr-only" for="ask-q">Ask this article</label><input id="ask-q" name="ask" type="search"${addAttribute(askQuery, "value")} required${addAttribute(3, "minlength")}${addAttribute(500, "maxlength")} autocomplete="off" placeholder="What does it say about…?" class="min-w-0 flex-1 border border-rule bg-paper px-3 py-2 text-[0.9375rem] focus:border-accent focus:outline-none"><button type="submit" class="shrink-0 border border-ink bg-ink px-4 py-2 text-[0.9375rem] text-paper transition-colors hover:border-accent hover:bg-accent">Ask</button></form>${askAsked && renderTemplate`<div class="mt-5 max-w-xl border border-rule bg-surface p-4"><p class="meta">You asked</p><p class="mt-1 text-[0.9375rem] font-medium">“${askResult.question}”</p>${askResult.matched ? renderTemplate`${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${askResult.answer && renderTemplate`${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`<p class="meta mt-4">In short</p><p class="mt-2 text-[0.9375rem] leading-relaxed">${askResult.answer}</p>` })}`}<p class="meta mt-4">The post says</p><div class="mt-2 space-y-4">${askResult.passages.map((p) => renderTemplate`<figure class="border-l-2 border-accent pl-3"><blockquote class="text-[0.9375rem] leading-relaxed text-ink-2">${unescapeHTML(p.quote)}</blockquote><figcaption class="meta mt-1.5"><a${addAttribute(`#block-${p.blockId}`, "href")} class="no-underline hover:text-ink">Read in context →</a></figcaption></figure>`)}</div>${askResult.answer && renderTemplate`<p class="meta mt-4">Summarized from the quotes above, which are the source of truth — the model only read these, never outside sources.${askResult.modelLabel ? ` (${askResult.modelLabel})` : ""}</p>`}` })}` : renderTemplate`<p class="mt-3 border-l-2 border-ochre pl-3 text-[0.9375rem] leading-relaxed text-ink-2">This isn't covered in the article — not yet, anyway. The question has been logged against the post, which is how the writer learns what to write next.</p>`}</div>`}</section>${myHighlightCount > 0 && renderTemplate`<section aria-labelledby="hl-heading" class="border-t border-rule pt-6"><h2 id="hl-heading" class="text-xl">Your highlights${" "}<span class="meta">· ${plural(myHighlightCount, "span")}</span></h2><p class="mt-2 text-[0.9375rem] leading-relaxed text-ink-2">Private to you. Writers see which spans readers marked, never who marked them or that you did.</p><ol class="mt-4 space-y-4">${myHighlights.map((h) => renderTemplate`<li class="border-l-2 border-accent pl-3"><p class="text-[0.9375rem] leading-relaxed text-ink-2">${h.text}</p><p class="meta mt-1.5"><a${addAttribute(`/w/${h.postSlug}`, "href")} class="no-underline hover:text-ink">${h.postTitle}</a>${" "}· ${ago(h.createdAt)}</p></li>`)}</ol></section>`}<section aria-labelledby="revise-heading" class="border-t border-rule pt-6"><h2 id="revise-heading" class="text-xl">When this changes</h2><p class="mt-2 text-[0.9375rem] leading-relaxed text-ink-2">${view.current.versionNumber > 1 ? `This post has been revised ${view.current.versionNumber - 1} ${view.current.versionNumber === 2 ? "time" : "times"}. Leave an address and you will hear the next time it moves — once, and only for a substantial change, not a typo.` : "Leave an address and you will hear if this post is ever substantially revised — once, and only when it actually changes."}</p>${subscribeState === "on" ? renderTemplate`<p class="mt-3 border-l-2 border-accent pl-3 text-[0.9375rem] text-ink-2" role="status">You will hear when it changes. If you did not expect this, it is already done and the address was not stored anywhere else.</p>` : subscribeState === "off" ? renderTemplate`<p class="mt-3 border-l-2 border-rule-strong pl-3 text-[0.9375rem] text-ink-2" role="status">Unsubscribed. You will not hear about further changes.</p>` : renderTemplate`<form method="post" action="/api/subscribe" class="mt-4 flex max-w-md flex-wrap items-end gap-2"><input type="hidden" name="postId"${addAttribute(post.id, "value")}><input type="hidden" name="returnTo"${addAttribute(returnTo, "value")}><div class="min-w-0 flex-1"><label class="meta block" for="rev-email">Email</label><input id="rev-email" name="email" type="email" required autocomplete="email" placeholder="you@example.com" class="mt-1 w-full border border-rule bg-paper px-3 py-2 text-[0.9375rem] focus:border-accent focus:outline-none"></div><button type="submit" class="shrink-0 border border-ink bg-ink px-3 py-2 text-[0.9375rem] text-paper transition-colors hover:border-accent hover:bg-accent">Tell me</button>${subscribeState === "bad-email" && renderTemplate`<p class="w-full text-[0.875rem] text-danger" role="alert">That does not look like an email address.</p>`}</form>`}</section></div></div>${renderComponent($$result, "Marginalia", $$Marginalia, {
		"postId": post.id,
		"versionId": view.current.id,
		"canWriteAuthorNote": isPostAuthor,
		"signedInAs": identity.handle
	})}${(newer || older) && renderTemplate`<nav aria-label="Adjacent writing" class="shell border-t border-rule py-8"><div class="grid gap-6 sm:grid-cols-2">${older && renderTemplate`<a${addAttribute(`/w/${older.slug}`, "href")} class="group block no-underline"><p class="meta">← Previous</p><p class="mt-1 text-[1.0625rem] text-ink group-hover:text-accent">${older.title}</p></a>`}${newer && renderTemplate`<a${addAttribute(`/w/${newer.slug}`, "href")} class="group block no-underline sm:text-right"><p class="meta">Next →</p><p class="mt-1 text-[1.0625rem] text-ink group-hover:text-accent">${newer.title}</p></a>`}</div></nav>`}</article>` })}${renderScript($$result, "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/pages/w/[slug].astro?astro&type=script&index=0&lang.ts")}`;
}, "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/pages/w/[slug].astro", void 0);
var $$file = "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/pages/w/[slug].astro";
var $$url = "/w/[slug]";
//#endregion
//#region \0virtual:astro:page:src/pages/w/[slug]@_@astro
var page = () => _slug__exports;
//#endregion
export { page };
