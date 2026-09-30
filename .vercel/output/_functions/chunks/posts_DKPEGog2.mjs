import { t as __exportAll } from "./rolldown-runtime_8H4AJuhK.mjs";
import { A as topics, M as users, S as readReceipts, _ as postLinks, n as readyDb, s as annotations, u as blocks, v as postVersions, x as readEvents, y as posts } from "./db_NRbr6ekn.mjs";
import { t as nanoid } from "./ids_TtqtpDCt.mjs";
import { n as renderInline, t as escapeHtml } from "./inline_YMPn7sV2.mjs";
import { and, asc, count, desc, eq, inArray, lt, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { diffArrays } from "diff";
//#region src/lib/blocks.ts
/**
* Typed block document model.
*
* A post body is a list of typed blocks, never Markdown. This is what makes
* stable annotation anchors, author-declared depth layers, semantic diffs and
* per-block comprehension telemetry possible at all.
*
* Depth layers:
*   core      — always visible. The argument itself.
*   understand— shown at Read and Study. Prerequisites, context, primer cards.
*   master    — shown only at Study. Footnotes, citations, appendices, private
*               author margin notes.
*/
var blocks_exports = /* @__PURE__ */ __exportAll({
	LAYERS: () => LAYERS,
	blockInlineSource: () => blockInlineSource,
	blockSchema: () => blockSchema,
	blockToPlainText: () => blockToPlainText,
	calloutBlock: () => calloutBlock,
	codeBlock: () => codeBlock,
	countWords: () => countWords,
	figureBlock: () => figureBlock,
	headingBlock: () => headingBlock,
	headingPaths: () => headingPaths,
	interactiveBlock: () => interactiveBlock,
	listBlock: () => listBlock,
	minutesAtDepth: () => minutesAtDepth,
	paragraphBlock: () => paragraphBlock,
	parseBody: () => parseBody,
	primerBlock: () => primerBlock,
	quoteBlock: () => quoteBlock,
	serializeBody: () => serializeBody,
	tableBlock: () => tableBlock,
	tldrBlock: () => tldrBlock
});
var LAYERS = [
	"core",
	"understand",
	"master"
];
var base = {
	id: z.string().min(1),
	layer: z.enum(LAYERS).default("core")
};
var paragraphBlock = z.object({
	...base,
	type: z.literal("paragraph"),
	text: z.string()
});
var headingBlock = z.object({
	...base,
	type: z.literal("heading"),
	level: z.union([z.literal(2), z.literal(3)]).default(2),
	text: z.string()
});
var codeBlock = z.object({
	...base,
	type: z.literal("code"),
	lang: z.string().default("text"),
	code: z.string(),
	caption: z.string().default("")
});
var listBlock = z.object({
	...base,
	type: z.literal("list"),
	ordered: z.boolean().default(false),
	items: z.array(z.string())
});
var quoteBlock = z.object({
	...base,
	type: z.literal("quote"),
	text: z.string(),
	attribution: z.string().default("")
});
var tableBlock = z.object({
	...base,
	type: z.literal("table"),
	head: z.array(z.string()),
	rows: z.array(z.array(z.string()))
});
var calloutBlock = z.object({
	...base,
	type: z.literal("callout"),
	tone: z.enum([
		"note",
		"warn",
		"correction"
	]).default("note"),
	title: z.string().default(""),
	text: z.string()
});
/** Always visible, and *expanded* at skim — the one thing skim never hides. */
var tldrBlock = z.object({
	...base,
	type: z.literal("tldr"),
	text: z.string(),
	layer: z.literal("core").default("core")
});
/** Glossary card surfaced inline the first time a term is read at Read depth. */
var primerBlock = z.object({
	...base,
	type: z.literal("primer"),
	term: z.string(),
	text: z.string(),
	layer: z.literal("understand").default("understand")
});
var figureBlock = z.object({
	...base,
	type: z.literal("figure"),
	src: z.string(),
	alt: z.string(),
	caption: z.string().default("")
});
/** Author-authored explorable artifact. Read-side in v1; authoring in v3. */
var interactiveBlock = z.object({
	...base,
	type: z.literal("interactive"),
	component: z.enum([
		"curve",
		"breakdown",
		"matrix",
		"timeline"
	]),
	title: z.string().default(""),
	props: z.record(z.string(), z.unknown()).default({})
});
var blockSchema = z.discriminatedUnion("type", [
	paragraphBlock,
	headingBlock,
	codeBlock,
	listBlock,
	quoteBlock,
	tableBlock,
	calloutBlock,
	tldrBlock,
	primerBlock,
	figureBlock,
	interactiveBlock
]);
function parseBody(json) {
	let raw;
	try {
		raw = JSON.parse(json);
	} catch {
		return [];
	}
	if (!Array.isArray(raw)) return [];
	const out = [];
	for (const item of raw) {
		const parsed = blockSchema.safeParse(item);
		if (parsed.success) out.push(parsed.data);
	}
	return out;
}
function serializeBody(blocks) {
	return JSON.stringify(blocks);
}
/** Plain-text projection. Search, diffs, retrieval and anchors all use this. */
function blockToPlainText(block) {
	switch (block.type) {
		case "paragraph":
		case "quote":
		case "tldr":
		case "heading": return block.text;
		case "callout": return [block.title, block.text].filter(Boolean).join(" — ");
		case "primer": return [block.term, block.text].filter(Boolean).join(" — ");
		case "code": return block.code;
		case "list": return block.items.join("\n");
		case "table": return [block.head.join(" "), ...block.rows.map((r) => r.join(" "))].join("\n");
		case "figure": return [block.alt, block.caption].filter(Boolean).join(" ");
		case "interactive": return [block.title, JSON.stringify(block.props)].filter(Boolean).join(" ");
	}
}
/**
* The exact string `renderInline` consumes for a block — i.e. what the reader
* actually sees, excluding any chrome the renderer adds separately (a callout's
* title, a code caption, a figure's alt text).
*
* `blockToPlainText` is the *search/retrieval/anchor* projection and includes
* those fields. Diffing and display must use this one, or a callout's title
* shows up twice and code spans render as literal backticks.
*/
function blockInlineSource(block) {
	switch (block.type) {
		case "paragraph":
		case "heading":
		case "tldr":
		case "callout":
		case "quote":
		case "primer": return block.text;
		case "code": return block.code;
		case "list": return block.items.join("\n");
		case "table": return [block.head.join(" "), ...block.rows.map((r) => r.join(" "))].join("\n");
		case "figure": return [block.alt, block.caption].filter(Boolean).join(" ");
		case "interactive": return [block.title, JSON.stringify(block.props)].filter(Boolean).join(" ");
	}
}
function countWords(text) {
	const trimmed = text.trim();
	if (!trimmed) return 0;
	return trimmed.split(/\s+/).length;
}
/** Minutes a reader spends at each depth, used for the depth-dial labels. */
function minutesAtDepth(blocks, depth) {
	const allowed = {
		skim: ["core"],
		understand: ["core", "understand"],
		master: [
			"core",
			"understand",
			"master"
		]
	};
	const words = blocks.filter((b) => allowed[depth].includes(b.layer)).reduce((sum, b) => sum + countWords(blockToPlainText(b)), 0);
	return Math.max(1, Math.round(words / 220));
}
/** Heading path for a block, e.g. "Cache invalidation › Read amplification". */
function headingPaths(blocks) {
	const map = /* @__PURE__ */ new Map();
	const stack = [];
	for (const block of blocks) {
		if (block.type === "heading") {
			while (stack.length && stack[stack.length - 1].level >= block.level) stack.pop();
			stack.push({
				level: block.level,
				text: block.text
			});
		}
		map.set(block.id, stack.map((h) => h.text).join(" › "));
	}
	return map;
}
//#endregion
//#region src/lib/inline-diff.ts
/**
* Inline-aware diffing.
*
* A word-level diff over raw source text splits code spans and emphasis across
* segment boundaries: `delete` becomes "`del" + "ete" + "`", and re-rendering
* each fragment emits literal backticks into the article. That is visible,
* embarrassing, and it happens on exactly the posts the whole product is about.
*
* So: tokenise first (markup becomes an atomic token, prose becomes words),
* diff the token keys, then render whole groups.
*/
var INLINE_PATTERN = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(==[^=\n]+==)|(\[[^\]\n]+\]\([^)\s]+\))/g;
/** Split source into atomic markup tokens and word/whitespace tokens. */
function tokenizeInline(src) {
	const out = [];
	let cursor = 0;
	let n = 0;
	const pushProse = (run) => {
		for (const piece of run.split(/(\s+)/)) {
			if (!piece) continue;
			out.push({
				key: `p${n++}:${piece}`,
				html: escapeHtml(piece),
				text: piece
			});
		}
	};
	INLINE_PATTERN.lastIndex = 0;
	let m;
	while ((m = INLINE_PATTERN.exec(src)) !== null) {
		if (m.index > cursor) pushProse(src.slice(cursor, m.index));
		const raw = m[0];
		out.push({
			key: `m${n++}:${raw}`,
			html: renderInline(raw),
			text: raw
		});
		cursor = m.index + raw.length;
	}
	if (cursor < src.length) pushProse(src.slice(cursor));
	return out;
}
/**
* Render source with [start, end) wrapped in a highlight.
*
* Token-based, so a highlight never lands mid-code-span and leaves a stray
* backtick behind. A range that partially covers a token snaps outward to the
* token boundary: highlighting a whole `code` span or none of it is correct,
* highlighting three of its seven characters is not representable.
*/
function renderWithHighlight(src, start, end, className, attrs = "") {
	if (start >= end) return renderInline(src);
	const tokens = tokenizeInline(src);
	let offset = 0;
	let html = "";
	let open = false;
	for (const token of tokens) {
		const tokStart = offset;
		const tokEnd = offset + token.text.length;
		offset = tokEnd;
		const overlaps = tokStart < end && tokEnd > start;
		if (overlaps && !open) {
			html += `<span class="${className}"${attrs}>`;
			open = true;
		}
		html += token.html;
		if (!overlaps && open) {
			html += "</span>";
			open = false;
		}
	}
	if (open) html += "</span>";
	return html;
}
function diffInline(before, after) {
	const a = tokenizeInline(before);
	const b = tokenizeInline(after);
	const parts = diffArrays(a, b, { comparator: (x, y) => x.key === y.key });
	const segments = [];
	for (const part of parts) {
		const type = part.added ? "ins" : part.removed ? "del" : "same";
		const tokens = part.value;
		if (tokens.length === 0) continue;
		const last = segments[segments.length - 1];
		const html = tokens.map((t) => t.html).join("");
		const text = tokens.map((t) => decodeEntity(t.html)).join("");
		if (last && last.type === type) {
			last.html += html;
			last.text += text;
		} else segments.push({
			type,
			html,
			text
		});
	}
	return segments;
}
var ENTITIES = {
	"&amp;": "&",
	"&lt;": "<",
	"&gt;": ">",
	"&quot;": "\"",
	"&#39;": "'"
};
function decodeEntity(html) {
	return html.replace(/&(amp|lt|gt|quot|#39);/g, (full) => ENTITIES[full] ?? full);
}
//#endregion
//#region src/lib/diff.ts
/**
* Semantic block-level diff.
*
* Blocks are matched by their stable `id`, so a diff knows the difference
* between "this sentence was rewritten" and "this paragraph is new" — which a
* naive line diff cannot. Within a modified block we fall back to a word-level
* diff so the reader sees the actual edit, not a whole-block replacement.
*/
function diffBlocks(before, after) {
	const beforeById = new Map(before.map((b) => [b.id, b]));
	const out = [];
	const seen = /* @__PURE__ */ new Set();
	for (const next of after) {
		seen.add(next.id);
		const prev = beforeById.get(next.id);
		if (!prev) {
			out.push({
				blockId: next.id,
				status: "added",
				before: "",
				after: blockInlineSource(next),
				segments: [{
					type: "ins",
					text: blockInlineSource(next)
				}],
				meaningful: true
			});
			continue;
		}
		const a = blockInlineSource(prev);
		const b = blockInlineSource(next);
		if (a === b) {
			out.push({
				blockId: next.id,
				status: "unchanged",
				before: a,
				after: b,
				segments: [{
					type: "same",
					text: b
				}],
				meaningful: false
			});
			continue;
		}
		out.push({
			blockId: next.id,
			status: "modified",
			before: a,
			after: b,
			segments: wordDiff(a, b),
			meaningful: true
		});
	}
	for (const prev of before) {
		if (seen.has(prev.id)) continue;
		const text = blockInlineSource(prev);
		out.push({
			blockId: prev.id,
			status: "removed",
			before: text,
			after: "",
			segments: [{
				type: "del",
				text
			}],
			meaningful: true
		});
	}
	return out;
}
function wordDiff(a, b) {
	return diffInline(a, b).map((p) => ({
		type: p.type,
		text: p.text,
		html: p.html
	}));
}
function diffStats(entries) {
	let added = 0;
	let removed = 0;
	let modified = 0;
	for (const e of entries) if (e.status === "added") added++;
	else if (e.status === "removed") removed++;
	else if (e.status === "modified") modified++;
	return {
		added,
		removed,
		modified,
		changed: added + removed + modified
	};
}
//#endregion
//#region src/lib/repo/search.ts
/**
* Search over the canon.
*
* SQLite FTS5, porter stemming, rank-ordered. The reader types words; they must
* never be able to type FTS syntax, so every term is quoted and the only
* operator left is the implicit AND. The final term gets a prefix wildcard so
* a half-typed thought still finds its post.
*/
/** Quoted FTS terms from free text, safe to interpolate into MATCH. Exported
*  so link suggestions use the same sanitization as search itself. */
function toFtsQuery(raw) {
	const terms = raw.split(/\s+/).map((t) => t.replace(/["*]/g, "").trim()).filter((t) => t.length > 0).slice(0, 10);
	if (terms.length === 0) return null;
	return terms.map((t, i) => i === terms.length - 1 && t.length >= 3 ? `"${t}"*` : `"${t}"`).join(" ");
}
async function searchPosts(raw, limit = 20) {
	if (raw.trim().length < 2) return [];
	const query = toFtsQuery(raw);
	if (!query) return [];
	return (await (await readyDb()).all(sql`
    SELECT f.slug AS slug, f.title AS title, f.dek AS dek, p.status AS status,
      snippet(post_fts, 2, '<mark>', '</mark>', '…', 28) AS snippet
    FROM post_fts f
    INNER JOIN posts p ON p.slug = f.slug
    WHERE post_fts MATCH ${query}
      AND p.visibility = 'public'
      AND p.published_at IS NOT NULL
    ORDER BY rank
    LIMIT ${limit}
  `)).map((r) => ({
		slug: r.slug,
		title: r.title,
		dek: r.dek,
		status: r.status,
		snippet: r.snippet
	}));
}
/**
* Rebuild the index from the current version of every visible post.
*
* Fills both `post_fts` (which post) and `block_fts` (which sentence — Ask
* needs block scope, and a post-level index cannot promise that a passage
* came from *this* post). Called after seeding and after any publish, because
* the indexed body is a projection of typed-block JSON into plain text and
* only application code knows how to make that projection. Returns the number
* of posts indexed so the caller can say so honestly instead of assuming it
* worked.
*/
async function rebuildSearchIndex() {
	const database = await readyDb();
	const rows = await database.select({
		postId: posts.id,
		slug: posts.slug,
		title: posts.title,
		dek: posts.dek,
		body: postVersions.body
	}).from(posts).innerJoin(postVersions, eq(posts.currentVersionId, postVersions.id)).where(eq(posts.visibility, "public"));
	await database.run(sql`DELETE FROM post_fts`);
	await database.run(sql`DELETE FROM block_fts`);
	for (const row of rows) {
		const parsed = parseBody(row.body);
		const body = parsed.map((b) => blockToPlainText(b)).join("\n\n");
		await database.run(sql`INSERT INTO post_fts(title, dek, body, slug) VALUES (${row.title}, ${row.dek}, ${body}, ${row.slug})`);
		for (const block of parsed) {
			const text = blockToPlainText(block).trim();
			if (!text || block.type === "code" || block.type === "figure") continue;
			await database.run(sql`INSERT INTO block_fts(text, block_id, post_id) VALUES (${text}, ${block.id}, ${row.postId})`);
		}
	}
	return rows.length;
}
//#endregion
//#region src/lib/repo/posts.ts
/**
* Post repository: reading, versioning, and the materialised block index.
*
* Every query funnels through `readyDb()` so migrations are guaranteed to have
* run. Diffs are always computed from stored versions and never persisted —
* a stored diff is a diff that will be wrong after the next schema change.
*/
var posts_exports = /* @__PURE__ */ __exportAll({
	addLink: () => addLink,
	countPosts: () => countPosts,
	createPost: () => createPost,
	forgetReader: () => forgetReader,
	forkPost: () => forkPost,
	getAdjacent: () => getAdjacent,
	getLastReceipt: () => getLastReceipt,
	getLineage: () => getLineage,
	getPostById: () => getPostById,
	getPostBySlug: () => getPostBySlug,
	getPreviousVersion: () => getPreviousVersion,
	getRevisionView: () => getRevisionView,
	getVersionByNumber: () => getVersionByNumber,
	getVersions: () => getVersions,
	incrementViews: () => incrementViews,
	markReviewed: () => markReviewed,
	publishRevision: () => publishRevision,
	recordReach: () => recordReach,
	recordRead: () => recordRead,
	suggestLinks: () => suggestLinks
});
var annotationTotal = sql`(
  select count(*) from ${annotations}
  where ${annotations.postId} = ${posts.id}
    and ${annotations.status} = 'visible'
    and ${annotations.isPrivate} = 0
)`;
var versionCount = sql`(
  select count(*) from ${postVersions} where ${postVersions.postId} = ${posts.id}
)`;
var minutes = sql`max(1, round((length(${postVersions.body}) / 4.6) / 220))`;
var baseSelect = {
	authorHandle: users.handle,
	authorName: users.displayName,
	topicName: topics.name,
	versionCount,
	annotationTotal,
	readingMinutes: minutes
};
async function getPostBySlug(slug) {
	const row = (await (await readyDb()).select({
		post: posts,
		version: postVersions,
		...baseSelect
	}).from(posts).innerJoin(users, eq(posts.authorId, users.id)).leftJoin(topics, eq(posts.topicId, topics.id)).innerJoin(postVersions, eq(posts.currentVersionId, postVersions.id)).where(eq(posts.slug, slug)).limit(1))[0];
	if (!row) return null;
	return {
		...row.post,
		...row,
		blocks: parseBody(row.version.body)
	};
}
async function getPostById(id) {
	const row = (await (await readyDb()).select({
		post: posts,
		version: postVersions,
		...baseSelect
	}).from(posts).innerJoin(users, eq(posts.authorId, users.id)).leftJoin(topics, eq(posts.topicId, topics.id)).innerJoin(postVersions, eq(posts.currentVersionId, postVersions.id)).where(eq(posts.id, id)).limit(1))[0];
	if (!row) return null;
	return {
		...row.post,
		...row,
		blocks: parseBody(row.version.body)
	};
}
async function countPosts(options = {}) {
	const database = await readyDb();
	const statuses = options.status ?? [
		"seedling",
		"budding",
		"evergreen"
	];
	const conditions = [inArray(posts.status, statuses), eq(posts.visibility, "public")];
	if (options.topicId) conditions.push(eq(posts.topicId, options.topicId));
	if (options.authorId) conditions.push(eq(posts.authorId, options.authorId));
	const [row] = await database.select({ n: count() }).from(posts).where(and(...conditions));
	return row?.n ?? 0;
}
async function getVersions(postId) {
	return (await readyDb()).select().from(postVersions).where(eq(postVersions.postId, postId)).orderBy(desc(postVersions.versionNumber));
}
async function getVersionByNumber(postId, versionNumber) {
	return (await (await readyDb()).select().from(postVersions).where(and(eq(postVersions.postId, postId), eq(postVersions.versionNumber, versionNumber))).limit(1))[0] ?? null;
}
/** The version immediately before `versionNumber`, used as the diff base. */
async function getPreviousVersion(postId, versionNumber) {
	return (await (await readyDb()).select().from(postVersions).where(and(eq(postVersions.postId, postId), lt(postVersions.versionNumber, versionNumber))).orderBy(desc(postVersions.versionNumber)).limit(1))[0] ?? null;
}
async function getRevisionView(postId, versionNumber) {
	const target = versionNumber ? await getVersionByNumber(postId, versionNumber) : (await getPostById(postId))?.version ?? null;
	if (!target) return null;
	const previous = await getPreviousVersion(postId, target.versionNumber);
	return {
		current: target,
		compared: previous,
		diff: previous ? diffBlocks(parseBody(previous.body), parseBody(target.body)) : []
	};
}
async function getAdjacent(postId) {
	const database = await readyDb();
	const post = await getPostById(postId);
	if (!post?.publishedAt) return {
		newer: null,
		older: null
	};
	const [newer] = await database.select({
		slug: posts.slug,
		title: posts.title
	}).from(posts).where(and(eq(posts.authorId, post.authorId), eq(posts.visibility, "public"), ne(posts.id, postId), sql`${posts.publishedAt} > ${post.publishedAt}`)).orderBy(asc(posts.publishedAt)).limit(1);
	const [older] = await database.select({
		slug: posts.slug,
		title: posts.title
	}).from(posts).where(and(eq(posts.authorId, post.authorId), eq(posts.visibility, "public"), ne(posts.id, postId), sql`${posts.publishedAt} < ${post.publishedAt}`)).orderBy(desc(posts.publishedAt)).limit(1);
	return {
		newer: newer ?? null,
		older: older ?? null
	};
}
/** Materialise the searchable/diffable block index for one version. */
async function materialize(versionId, postId, doc) {
	const database = await readyDb();
	const paths = headingPaths(doc);
	const rows = doc.map((block, ordinal) => ({
		id: nanoid(),
		postId,
		versionId,
		blockId: block.id,
		ordinal,
		type: block.type,
		layer: block.layer,
		text: blockToPlainText(block),
		headingPath: paths.get(block.id) ?? "",
		wordCount: countWords(blockToPlainText(block))
	}));
	if (rows.length === 0) return;
	await database.insert(blocks).values(rows);
}
async function createPost(input) {
	const database = await readyDb();
	const now = Date.now();
	const postId = nanoid();
	const versionId = nanoid();
	const status = input.status ?? "seedling";
	const isPublic = status !== "seedling" || Boolean(input.publishedAt);
	await database.insert(posts).values({
		id: postId,
		slug: input.slug,
		title: input.title,
		dek: input.dek ?? "",
		authorId: input.authorId,
		status,
		visibility: isPublic ? "public" : "unlisted",
		currentVersionId: versionId,
		publishedAt: input.publishedAt ?? (isPublic ? now : null),
		createdAt: now,
		updatedAt: now,
		lastReviewedAt: now,
		topicId: input.topicId ?? null,
		seriesId: input.seriesId ?? null,
		seoDescription: input.seoDescription ?? input.dek ?? "",
		forkedFromId: input.forkedFromId ?? null
	});
	await database.insert(postVersions).values({
		id: versionId,
		postId,
		versionNumber: 1,
		body: serializeBody(input.body),
		changeSummary: input.changeSummary ?? "First published version.",
		authorId: input.authorId,
		createdAt: now,
		isMajor: input.isMajor ?? true
	});
	await materialize(versionId, postId, input.body);
	if (input.forkedFromId) await database.insert(postLinks).values({
		fromPostId: postId,
		toPostId: input.forkedFromId,
		type: "fork_of"
	}).onConflictDoNothing();
	await rebuildSearchIndex();
	return {
		postId,
		versionId
	};
}
async function publishRevision(input) {
	const database = await readyDb();
	const nextNumber = ((await getVersions(input.postId))[0]?.versionNumber ?? 0) + 1;
	const versionId = nanoid();
	const now = Date.now();
	await database.insert(postVersions).values({
		id: versionId,
		postId: input.postId,
		versionNumber: nextNumber,
		body: serializeBody(input.body),
		changeSummary: input.changeSummary,
		authorId: input.authorId,
		createdAt: now,
		isMajor: input.isMajor ?? false
	});
	await materialize(versionId, input.postId, input.body);
	const existing = await getPostById(input.postId);
	const firstPublish = !existing?.publishedAt;
	await database.update(posts).set({
		currentVersionId: versionId,
		updatedAt: now,
		lastReviewedAt: input.status ? now : existing?.lastReviewedAt ?? now,
		status: input.status ?? existing?.status ?? "seedling",
		visibility: firstPublish ? "public" : existing?.visibility ?? "public",
		publishedAt: firstPublish ? now : existing?.publishedAt
	}).where(eq(posts.id, input.postId));
	await rebuildSearchIndex();
	return {
		versionId,
		versionNumber: nextNumber
	};
}
/**
* The maintenance heartbeat: the author looked at this post and it still
* stands (optionally graduating it a lifecycle state). Staleness is a nudge,
* never a shame badge — but a nudge needs a way to be answered, and this is
* it. Separate from publishing a revision because "still true" is the most
* common and most valuable review outcome, and it should not require inventing
* a change.
*/
async function markReviewed(postId, authorId, status) {
	const database = await readyDb();
	const [own] = await database.select({ id: posts.id }).from(posts).where(and(eq(posts.id, postId), eq(posts.authorId, authorId))).limit(1);
	if (!own) return false;
	await database.update(posts).set({
		lastReviewedAt: Date.now(),
		updatedAt: Date.now(),
		...status ? { status } : {}
	}).where(eq(posts.id, postId));
	return true;
}
/**
* Fork a post into your own seedling.
*
* The fork starts as a copy of the ancestor's current blocks with fresh ids —
* shared ids would tangle the two posts' annotation anchors — and inherits
* the ancestor's outbound links, so lineage compounds rather than resets. The
* `fork_of` edge makes the chain traversable in both directions.
*/
async function forkPost(postId, authorId) {
	const database = await readyDb();
	const ancestor = await getPostById(postId);
	if (!ancestor || ancestor.visibility !== "public" || !ancestor.publishedAt) return {
		ok: false,
		error: "That post cannot be forked."
	};
	const body = ancestor.blocks.map((b) => ({
		...b,
		id: nanoid()
	}));
	const slug = `${ancestor.slug}-fork-${nanoid().slice(0, 6)}`;
	const created = await createPost({
		slug,
		title: `Fork of ${ancestor.title}`,
		dek: ancestor.dek,
		authorId,
		body,
		status: "seedling",
		changeSummary: `Forked from "${ancestor.title}".`,
		forkedFromId: ancestor.id
	});
	const outbound = await database.select().from(postLinks).where(eq(postLinks.fromPostId, ancestor.id));
	for (const link of outbound) {
		if (link.toPostId === ancestor.id) continue;
		if (link.type === "fork_of") continue;
		await addLink(created.postId, link.toPostId, link.type);
	}
	return {
		ok: true,
		postId: created.postId,
		slug
	};
}
async function getLastReceipt(anonId, postId) {
	return (await (await readyDb()).select({
		versionId: readReceipts.versionId,
		versionNumber: postVersions.versionNumber,
		readAt: readReceipts.readAt
	}).from(readReceipts).innerJoin(postVersions, eq(readReceipts.versionId, postVersions.id)).where(and(eq(readReceipts.postId, postId), eq(readReceipts.anonId, anonId))).orderBy(desc(readReceipts.readAt)).limit(1))[0] ?? null;
}
async function recordRead(args) {
	const database = await readyDb();
	const now = Date.now();
	const existing = await getLastReceipt(args.anonId, args.postId);
	if (existing?.versionId === args.versionId && now - existing.readAt < 12e5) return;
	await database.insert(readReceipts).values({
		id: nanoid(),
		postId: args.postId,
		versionId: args.versionId,
		anonId: args.anonId,
		userId: args.userId ?? null,
		readAt: now
	});
	await database.insert(readEvents).values({
		id: nanoid(),
		postId: args.postId,
		blockId: null,
		userId: args.userId ?? null,
		anonId: args.anonId,
		event: "impression",
		createdAt: now
	});
}
/** One row per block the reader actually reached, batched by the client. */
async function recordReach(args) {
	if (args.blockIds.length === 0) return 0;
	const database = await readyDb();
	const now = Date.now();
	const rows = args.blockIds.slice(0, 400).map((blockId) => ({
		id: nanoid(),
		postId: args.postId,
		blockId,
		userId: args.userId ?? null,
		anonId: args.anonId,
		event: "reached",
		positionRatio: null,
		createdAt: now
	}));
	await database.insert(readEvents).values(rows);
	return rows.length;
}
async function incrementViews(postId) {
	await (await readyDb()).update(posts).set({ viewCount: sql`${posts.viewCount} + 1` }).where(eq(posts.id, postId));
}
/** Forget everything we know about an anonymous reader. Exercise-able privacy. */
async function forgetReader(anonId) {
	const database = await readyDb();
	await database.delete(readReceipts).where(eq(readReceipts.anonId, anonId));
	await database.delete(readEvents).where(eq(readEvents.anonId, anonId));
}
async function addLink(fromPostId, toPostId, type) {
	await (await readyDb()).insert(postLinks).values({
		fromPostId,
		toPostId,
		type
	}).onConflictDoNothing();
}
/**
* Back-catalog linking suggestions.
*
* A writer with ten posts cannot hold all pairwise connections in their head,
* so old posts stay unlinked and the graph stays thin where it should be
* dense. For each owned post, take significant terms from its title and dek,
* match them against the post index, and exclude the post itself plus
* everything already linked in either direction. What remains is a short list
* of "did you mean to connect these?" — the writer still decides the type or
* dismisses it, because only the writer knows whether shared vocabulary means
* a real relationship or a coincidence.
*/
async function suggestLinks(postId, authorId, limit = 5) {
	const database = await readyDb();
	const { parseBody } = await Promise.resolve().then(() => blocks_exports);
	const { blockToPlainText } = await Promise.resolve().then(() => blocks_exports);
	const [own] = await database.select({
		id: posts.id,
		body: postVersions.body
	}).from(posts).innerJoin(postVersions, eq(posts.currentVersionId, postVersions.id)).where(and(eq(posts.id, postId), eq(posts.authorId, authorId))).limit(1);
	if (!own) return [];
	const STOP = new Set("about above after again against always among another around because become before behind being below between both during every first from further had having here however into itself just like made make many might more most much never often only other ought same should since some such than that their them then there these through under until want were what when where which while with within without would your this have will there their said each which how the and for are but not you all any can had her was one our out day get has him his how man new now old see two way who boy did its let put say she too use".split(" "));
	const wordOf = (text) => (text.toLowerCase().match(/[a-z][a-z'-]{4,}/g) ?? []).filter((w) => !STOP.has(w));
	const ownText = parseBody(own.body).map((b) => blockToPlainText(b)).join(" ");
	const ownCounts = /* @__PURE__ */ new Map();
	for (const w of wordOf(ownText)) ownCounts.set(w, (ownCounts.get(w) ?? 0) + 1);
	const others = await database.select({
		slug: posts.slug,
		body: postVersions.body
	}).from(posts).innerJoin(postVersions, eq(posts.currentVersionId, postVersions.id)).where(and(eq(posts.visibility, "public"), sql`${posts.publishedAt} is not null`));
	const docFreq = /* @__PURE__ */ new Map();
	const bodies = /* @__PURE__ */ new Map();
	for (const o of others) {
		const text = parseBody(o.body).map((b) => blockToPlainText(b)).join(" ");
		bodies.set(o.slug, text);
		for (const w of new Set(wordOf(text))) docFreq.set(w, (docFreq.get(w) ?? 0) + 1);
	}
	const N = Math.max(1, others.length);
	const idf = /* @__PURE__ */ new Map();
	for (const [w, tf] of ownCounts) idf.set(w, Math.log(1 + N / (docFreq.get(w) ?? 1)));
	const ranked = [...ownCounts.entries()].map(([w, tf]) => ({
		w,
		weight: tf * (idf.get(w) ?? 0)
	})).sort((a, b) => b.weight - a.weight);
	const display = ranked.slice(0, 8).map((s) => s.w);
	const weights = new Map(ranked.map((s) => [s.w, s.weight]));
	if (display.length < 2) return [];
	const outIds = await database.select({ id: postLinks.toPostId }).from(postLinks).where(eq(postLinks.fromPostId, postId));
	const inIds = await database.select({ id: postLinks.fromPostId }).from(postLinks).where(eq(postLinks.toPostId, postId));
	const linkedSlugs = /* @__PURE__ */ new Set();
	for (const r of [...outIds, ...inIds]) {
		const [p] = await database.select({ slug: posts.slug }).from(posts).where(eq(posts.id, r.id)).limit(1);
		if (p) linkedSlugs.add(p.slug);
	}
	const [self] = await database.select({ slug: posts.slug }).from(posts).where(eq(posts.id, postId)).limit(1);
	const out = [];
	for (const o of others) {
		if (o.slug === self?.slug || linkedSlugs.has(o.slug)) continue;
		const words = wordOf(bodies.get(o.slug) ?? "");
		const shared = [...new Set(words.filter((w) => weights.has(w)))];
		const score = shared.reduce((n, w) => n + (weights.get(w) ?? 0), 0);
		if (score < 2) continue;
		shared.sort((a, b) => (weights.get(b) ?? 0) - (weights.get(a) ?? 0));
		const [meta] = await database.select({
			id: posts.id,
			title: posts.title,
			dek: posts.dek
		}).from(posts).where(eq(posts.slug, o.slug)).limit(1);
		if (!meta) continue;
		out.push({
			postId: meta.id,
			slug: o.slug,
			title: meta.title,
			dek: meta.dek,
			shared: shared.slice(0, 4),
			score
		});
		if (out.length >= limit * 2) break;
	}
	out.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
	return out.slice(0, limit);
}
async function getLineage(postId) {
	const database = await readyDb();
	const ancestors = [];
	let cursor = postId;
	let depth = 0;
	while (cursor && depth < 12) {
		const parentId = (await database.select({ forkedFromId: posts.forkedFromId }).from(posts).where(eq(posts.id, cursor)).limit(1))[0]?.forkedFromId ?? null;
		if (!parentId) break;
		const parent = (await database.select({
			slug: posts.slug,
			title: posts.title,
			dek: posts.dek
		}).from(posts).where(eq(posts.id, parentId)).limit(1))[0];
		if (!parent) break;
		depth += 1;
		ancestors.unshift({
			depth,
			slug: parent.slug,
			title: parent.title,
			dek: parent.dek
		});
		cursor = parentId;
	}
	return {
		ancestors,
		descendants: await database.select({
			slug: posts.slug,
			title: posts.title,
			dek: posts.dek,
			id: posts.id
		}).from(posts).where(eq(posts.forkedFromId, postId)).limit(20)
	};
}
//#endregion
export { blockInlineSource as C, serializeBody as D, parseBody as E, renderWithHighlight as S, minutesAtDepth as T, recordReach as _, forkPost as a, searchPosts as b, getLineage as c, getRevisionView as d, getVersions as f, publishRevision as g, posts_exports as h, forgetReader as i, getPostById as l, markReviewed as m, countPosts as n, getAdjacent as o, incrementViews as p, createPost as r, getLastReceipt as s, addLink as t, getPostBySlug as u, recordRead as v, blockToPlainText as w, diffStats as x, suggestLinks as y };
