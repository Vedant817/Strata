import { t as __exportAll } from "./rolldown-runtime_8H4AJuhK.mjs";
import { t as getIdentity } from "./auth_BCgGryh8.mjs";
import { l as getPostById, m as markReviewed, t as addLink, u as getPostBySlug } from "./posts_DKPEGog2.mjs";
import { r as safeReturnTo } from "./note-actions_CI6lMVYb.mjs";
import { a as promoteCapture, o as setCaptureState, t as addCapture } from "./studio_B88tlfqA.mjs";
import { z } from "zod";
//#region src/pages/api/studio.ts
var studio_exports = /* @__PURE__ */ __exportAll({
	GET: () => GET,
	POST: () => POST
});
/**
* Studio mutations. Same shape as the note endpoint: ordinary form posts,
* one validated schema, redirect back with the reason on failure. Studio is
* for claimed writers — an anonymous browser has no inbox to capture into,
* so without an account the honest response is to send them to claim one.
*/
var schema = z.discriminatedUnion("action", [
	z.object({
		action: z.literal("capture"),
		body: z.string().trim().min(1, "A capture needs some text.").max(4e3),
		source: z.enum([
			"share",
			"voice",
			"screenshot",
			"scratchpad",
			"clip"
		]).default("scratchpad"),
		returnTo: z.string().optional()
	}),
	z.object({
		action: z.literal("state"),
		id: z.string().min(1),
		to: z.enum([
			"inbox",
			"seed",
			"draft",
			"discarded"
		]),
		returnTo: z.string().optional()
	}),
	z.object({
		action: z.literal("promote"),
		id: z.string().min(1),
		returnTo: z.string().optional()
	}),
	z.object({
		action: z.literal("reviewed"),
		postId: z.string().min(1),
		status: z.enum([
			"seedling",
			"budding",
			"evergreen"
		]).optional(),
		returnTo: z.string().optional()
	}),
	z.object({
		action: z.literal("link"),
		fromPostId: z.string().min(1),
		toSlug: z.string().min(1).max(120),
		type: z.enum([
			"cites",
			"extends",
			"contradicts",
			"mentions"
		]),
		returnTo: z.string().optional()
	}),
	z.object({
		action: z.literal("grow"),
		ids: z.string().min(1).max(2e3),
		returnTo: z.string().optional()
	}),
	z.object({
		action: z.literal("voice"),
		returnTo: z.string().optional()
	}),
	z.object({
		action: z.literal("save-draft"),
		postId: z.string().min(1),
		count: z.coerce.number().int().min(0).max(500),
		returnTo: z.string().optional()
	}),
	z.object({
		action: z.literal("add-block"),
		postId: z.string().min(1),
		blockType: z.enum([
			"paragraph",
			"heading",
			"quote",
			"code",
			"list",
			"callout"
		]),
		returnTo: z.string().optional()
	}),
	z.object({
		action: z.literal("publish"),
		postId: z.string().min(1),
		changeSummary: z.string().trim().min(10, "Say what changed, in at least a sentence. Future readers — and you — will thank you.").max(500),
		isMajor: z.string().optional(),
		returnTo: z.string().optional()
	})
]);
var POST = async ({ request, cookies, redirect, url }) => {
	const identity = await getIdentity(cookies);
	if (!identity.userId) return redirect("/write#handle", 303);
	const form = await request.formData().catch(() => null);
	const back = safeReturnTo(form?.get("returnTo"), "/studio");
	const target = new URL(back, url);
	target.searchParams.delete("studioError");
	const parsed = schema.safeParse(form ? Object.fromEntries(form) : null);
	if (!parsed.success) {
		target.searchParams.set("studioError", parsed.error.issues[0]?.message ?? "That did not look right.");
		return redirect(target.pathname + target.search, 303);
	}
	const input = parsed.data;
	if (input.action === "capture") {
		const result = await addCapture(identity.userId, input.body, input.source);
		if (!result.ok) {
			target.searchParams.set("studioError", result.error);
			return redirect(target.pathname + target.search, 303);
		}
		return redirect(back, 303);
	}
	if (input.action === "state") {
		const ok = await setCaptureState(input.id, identity.userId, input.to);
		if (!ok) target.searchParams.set("studioError", "That capture is not yours.");
		return redirect(ok ? back : target.pathname + target.search, 303);
	}
	if (input.action === "promote") {
		const promoted = await promoteCapture(input.id, identity.userId);
		if (!promoted.ok) {
			target.searchParams.set("studioError", promoted.error);
			return redirect(target.pathname + target.search, 303);
		}
		const post = await getPostById(promoted.postId);
		return redirect(post ? `/w/${post.slug}` : back, 303);
	}
	if (input.action === "reviewed") {
		const ok = await markReviewed(input.postId, identity.userId, input.status);
		if (!ok) target.searchParams.set("studioError", "That post is not yours.");
		return redirect(ok ? back : target.pathname + target.search, 303);
	}
	if (input.action === "grow") {
		const { growGroup } = await import("./studio_B88tlfqA.mjs").then((n) => n.s);
		const grown = await growGroup(identity.userId, input.ids.split(",").map((s) => s.trim()).filter(Boolean));
		if (!grown.ok) {
			target.searchParams.set("studioError", grown.error);
			return redirect(target.pathname + target.search, 303);
		}
		const post = await getPostById(grown.postId);
		return redirect(post ? `/w/${post.slug}` : back, 303);
	}
	if (input.action === "voice") {
		const { refreshVoice } = await import("./voice_J-TKh2RN.mjs").then((n) => n.i);
		const profile = await refreshVoice(identity.userId);
		if (!profile) target.searchParams.set("studioError", "Nothing published to learn a voice from yet.");
		return redirect(profile ? back : target.pathname + target.search, 303);
	}
	if (input.action === "save-draft" || input.action === "add-block" || input.action === "publish") {
		const { applyEditorAction } = await import("./drafts_DfY_BAiM.mjs").then((n) => n.n);
		const fields = {};
		if (form) {
			for (const [k, v] of form.entries()) if (typeof v === "string") fields[k] = v;
		}
		const result = await applyEditorAction(input, fields, identity.userId);
		if (!result.ok) {
			target.searchParams.set("studioError", result.error);
			return redirect(target.pathname + target.search, 303);
		}
		if (result.redirectTo) return redirect(result.redirectTo, 303);
		const done = new URL(back, url);
		done.searchParams.set("saved", "1");
		return redirect(done.pathname + done.search, 303);
	}
	const target_post = await getPostBySlug(input.toSlug.trim().toLowerCase());
	if (!target_post) {
		target.searchParams.set("studioError", `No post at /w/${input.toSlug.trim().toLowerCase()}.`);
		return redirect(target.pathname + target.search, 303);
	}
	const own = await getPostById(input.fromPostId);
	if (!own || own.authorId !== identity.userId) {
		target.searchParams.set("studioError", "That post is not yours.");
		return redirect(target.pathname + target.search, 303);
	}
	if (target_post.id === input.fromPostId) {
		target.searchParams.set("studioError", "A post cannot link to itself.");
		return redirect(target.pathname + target.search, 303);
	}
	await addLink(input.fromPostId, target_post.id, input.type);
	return redirect(back, 303);
};
var GET = () => Response.redirect("/studio", 303);
//#endregion
//#region \0virtual:astro:page:src/pages/api/studio@_@ts
var page = () => studio_exports;
//#endregion
export { page };
