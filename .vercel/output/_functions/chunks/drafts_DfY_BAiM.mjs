import { t as __exportAll } from "./rolldown-runtime_8H4AJuhK.mjs";
import { n as readyDb, y as posts } from "./db_NRbr6ekn.mjs";
import { t as nanoid } from "./ids_TtqtpDCt.mjs";
import { D as serializeBody, E as parseBody, g as publishRevision } from "./posts_DKPEGog2.mjs";
import { r as normaliseLang } from "./highlight_Bx2_emM9.mjs";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
//#region src/lib/repo/drafts.ts
var drafts_exports = /* @__PURE__ */ __exportAll({
	applyEditorAction: () => applyEditorAction,
	applyEditorForm: () => applyEditorForm,
	blankBlock: () => blankBlock,
	draftFromPublished: () => draftFromPublished,
	getDraft: () => getDraft,
	publishDraft: () => publishDraft,
	saveDraft: () => saveDraft
});
/**
* Drafts: the editor's work-in-progress.
*
* Revisions are immutable history, so the editor needs somewhere that is
* explicitly *not* history. `posts.draft_body` holds {title, dek, blocks},
* written on every save and cleared on publish. One draft per post, owned by
* the post's author, never rendered to readers — the only readers of a draft
* are the editor page and publish, and both check ownership first.
*/
var draftSchema = z.object({
	title: z.string().trim().min(1, "A post needs a title.").max(200),
	dek: z.string().trim().max(500).default(""),
	blocks: z.array(z.custom((b) => b !== null && typeof b === "object")).min(1, "A post needs at least one block.")
});
async function getDraft(postId, authorId) {
	const [row] = await (await readyDb()).select({
		draftBody: posts.draftBody,
		authorId: posts.authorId
	}).from(posts).where(eq(posts.id, postId)).limit(1);
	if (!row || row.authorId !== authorId) return null;
	if (!row.draftBody) return null;
	try {
		const parsed = draftSchema.parse(JSON.parse(row.draftBody));
		return {
			title: parsed.title,
			dek: parsed.dek,
			blocks: parseBody(serializeBody(parsed.blocks))
		};
	} catch {
		return null;
	}
}
/** Seed a draft from the current published version, for a first edit. */
async function draftFromPublished(postId, authorId) {
	const [row] = await (await readyDb()).select({
		title: posts.title,
		dek: posts.dek,
		authorId: posts.authorId,
		currentVersionId: posts.currentVersionId
	}).from(posts).where(eq(posts.id, postId)).limit(1);
	if (!row || row.authorId !== authorId || !row.currentVersionId) return null;
	const { getPostById } = await import("./posts_DKPEGog2.mjs").then((n) => n.h);
	const post = await getPostById(postId);
	if (!post) return null;
	return {
		title: post.title,
		dek: post.dek,
		blocks: post.blocks
	};
}
async function saveDraft(postId, authorId, doc) {
	const parsed = draftSchema.safeParse(doc);
	if (!parsed.success) return {
		ok: false,
		error: parsed.error.issues[0]?.message ?? "That draft did not look right."
	};
	const database = await readyDb();
	const [own] = await database.select({ id: posts.id }).from(posts).where(and(eq(posts.id, postId), eq(posts.authorId, authorId))).limit(1);
	if (!own) return {
		ok: false,
		error: "That post is not yours."
	};
	await database.update(posts).set({
		draftBody: JSON.stringify({
			title: parsed.data.title,
			dek: parsed.data.dek,
			blocks: parsed.data.blocks
		}),
		updatedAt: Date.now()
	}).where(eq(posts.id, postId));
	return { ok: true };
}
/** Publish the draft as a new revision. Requires a change summary — "fixed
*  the benchmark" is the whole point of the history, and a revision without
*  one is a gap in the record, not a convenience. */
async function publishDraft(postId, authorId, changeSummary, isMajor) {
	const clean = changeSummary.trim();
	if (clean.length < 10) return {
		ok: false,
		error: "Say what changed, in at least a sentence. Future readers — and you — will thank you."
	};
	const database = await readyDb();
	const [row] = await database.select({
		slug: posts.slug,
		title: posts.title,
		dek: posts.dek,
		authorId: posts.authorId,
		draftBody: posts.draftBody
	}).from(posts).where(eq(posts.id, postId)).limit(1);
	if (!row || row.authorId !== authorId) return {
		ok: false,
		error: "That post is not yours."
	};
	if (!row.draftBody) return {
		ok: false,
		error: "Nothing to publish — save the draft first."
	};
	let doc;
	try {
		doc = draftSchema.parse(JSON.parse(row.draftBody));
	} catch {
		return {
			ok: false,
			error: "The draft is damaged. Re-save it from the editor."
		};
	}
	const published = await publishRevision({
		postId,
		authorId,
		body: doc.blocks,
		changeSummary: clean,
		isMajor
	});
	await database.update(posts).set({
		title: doc.title,
		dek: doc.dek,
		draftBody: null,
		updatedAt: Date.now()
	}).where(eq(posts.id, postId));
	return {
		ok: true,
		versionNumber: published.versionNumber,
		slug: row.slug
	};
}
/**
* Fold one editor save over the base blocks.
*
* The form carries one row per block: id, order, layer, a delete flag, and
* type-specific fields. Structural kinds the editor does not render (tables,
* figures, interactives) ride through untouched from the base — preserved
* verbatim, never re-parsed, so the editor cannot corrupt what it cannot show.
* Unknown ids in the form are ignored rather than appended: the form describes
* edits to known blocks, and anything else is either stale or forged.
*/ function applyEditorForm(base, form) {
	const count = Math.min(500, Math.max(0, Number.parseInt(form.count ?? "0", 10) || 0));
	const byId = new Map(base.blocks.map((b) => [b.id, b]));
	const out = [];
	for (let i = 0; i < count; i++) {
		const id = (form[`b_${i}_id`] ?? "").trim();
		if (!id) continue;
		const prev = byId.get(id);
		if (!prev) continue;
		if (form[`b_${i}_del`] === "1") continue;
		const order = Number.parseInt(form[`b_${i}_order`] ?? String(i), 10);
		const layerRaw = form[`b_${i}_layer`];
		const layer = layerRaw === "core" || layerRaw === "understand" || layerRaw === "master" ? layerRaw : prev.layer;
		const num = Number.isFinite(order) ? order : i;
		let next = prev;
		switch (prev.type) {
			case "paragraph":
				next = {
					...prev,
					text: (form[`b_${i}_text`] ?? "").slice(0, 2e4),
					layer
				};
				break;
			case "tldr":
				next = {
					...prev,
					text: (form[`b_${i}_text`] ?? "").slice(0, 2e4)
				};
				break;
			case "heading": {
				const level = form[`b_${i}_level`] === "3" ? 3 : 2;
				next = {
					...prev,
					level,
					text: (form[`b_${i}_text`] ?? "").slice(0, 500),
					layer
				};
				break;
			}
			case "quote":
				next = {
					...prev,
					text: (form[`b_${i}_text`] ?? "").slice(0, 2e4),
					attribution: (form[`b_${i}_attr`] ?? "").slice(0, 200),
					layer
				};
				break;
			case "callout": {
				const tone = form[`b_${i}_tone`];
				next = {
					...prev,
					title: (form[`b_${i}_ctitle`] ?? "").slice(0, 300),
					text: (form[`b_${i}_text`] ?? "").slice(0, 2e4),
					tone: tone === "warn" || tone === "correction" ? tone : "note",
					layer
				};
				break;
			}
			case "code":
				next = {
					...prev,
					lang: normaliseLang((form[`b_${i}_lang`] ?? "text").slice(0, 40)),
					code: (form[`b_${i}_code`] ?? "").slice(0, 6e4),
					caption: (form[`b_${i}_caption`] ?? "").slice(0, 300),
					layer
				};
				break;
			case "list": {
				const items = (form[`b_${i}_items`] ?? "").split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 200);
				next = {
					...prev,
					items: items.length > 0 ? items : prev.items,
					layer
				};
				break;
			}
			case "primer":
				next = {
					...prev,
					term: (form[`b_${i}_term`] ?? "").slice(0, 200),
					text: (form[`b_${i}_text`] ?? "").slice(0, 2e4)
				};
				break;
			default: next = {
				...prev,
				layer
			};
		}
		out.push({
			order: num,
			block: next
		});
	}
	out.sort((a, b) => a.order - b.order);
	return {
		title: (form.title ?? base.title).trim().slice(0, 200) || base.title,
		dek: (form.dek ?? base.dek).trim().slice(0, 500),
		blocks: out.map((o) => o.block)
	};
}
function blankBlock(type) {
	const id = nanoid();
	switch (type) {
		case "heading": return {
			id,
			type: "heading",
			level: 2,
			text: "",
			layer: "core"
		};
		case "quote": return {
			id,
			type: "quote",
			text: "",
			attribution: "",
			layer: "understand"
		};
		case "code": return {
			id,
			type: "code",
			lang: "text",
			code: "",
			caption: "",
			layer: "master"
		};
		case "list": return {
			id,
			type: "list",
			ordered: false,
			items: [""],
			layer: "understand"
		};
		case "callout": return {
			id,
			type: "callout",
			tone: "note",
			title: "",
			text: "",
			layer: "understand"
		};
		default: return {
			id,
			type: "paragraph",
			text: "",
			layer: "understand"
		};
	}
}
/**
* The three editor mutations, sharing one ownership check.
*
* Returns either an error to show, a redirect to the published diff, or
* nothing — in which case the caller re-renders the editor with a saved flag.
* Every path re-checks that the post belongs to the caller, because the form
* is attacker-supplied and a postId in it proves nothing.
*/
async function applyEditorAction(input, fields, authorId) {
	const [own] = await (await readyDb()).select({
		id: posts.id,
		slug: posts.slug
	}).from(posts).where(and(eq(posts.id, input.postId), eq(posts.authorId, authorId))).limit(1);
	if (!own) return {
		ok: false,
		error: "That post is not yours."
	};
	const base = await getDraft(input.postId, authorId) ?? await draftFromPublished(input.postId, authorId);
	if (!base) return {
		ok: false,
		error: "That post could not be loaded."
	};
	if (input.action === "add-block") {
		const saved = await saveDraft(input.postId, authorId, {
			title: base.title,
			dek: base.dek,
			blocks: [...base.blocks, blankBlock(input.blockType)]
		});
		return saved.ok ? { ok: true } : saved;
	}
	if (input.action === "save-draft") {
		const next = applyEditorForm(base, fields);
		const saved = await saveDraft(input.postId, authorId, next);
		return saved.ok ? { ok: true } : saved;
	}
	const published = await publishDraft(input.postId, authorId, input.changeSummary, input.isMajor === "1");
	if (!published.ok) return published;
	return {
		ok: true,
		redirectTo: `/w/${published.slug}?rev=${published.versionNumber}`
	};
}
//#endregion
export { drafts_exports as n, getDraft as r, draftFromPublished as t };
