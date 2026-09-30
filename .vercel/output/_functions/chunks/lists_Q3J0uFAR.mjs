import { t as __exportAll } from "./rolldown-runtime_8H4AJuhK.mjs";
import { S as removeCollaborator, _ as setListVisibility, g as rotateListShareToken, h as revokeListShareToken, m as removeListItem, n as createReadingList, t as addListItem, y as addCollaborator } from "./taxonomy_CiJ526xn.mjs";
import { t as getIdentity } from "./auth_BCgGryh8.mjs";
import { r as safeReturnTo } from "./note-actions_CI6lMVYb.mjs";
import { z } from "zod";
//#region src/pages/api/lists.ts
var lists_exports = /* @__PURE__ */ __exportAll({
	GET: () => GET,
	POST: () => POST
});
/**
* Reading-list management. Same contract as every other mutation here:
* ordinary form posts, one validated schema, redirect back with the reason
* on failure. Every action re-checks ownership server-side — a list id in a
* form proves nothing, and a private list must stay private against forged
* requests, not just hidden links.
*/
var schema = z.discriminatedUnion("action", [
	z.object({
		action: z.literal("create"),
		title: z.string().trim().min(3).max(120),
		description: z.string().trim().max(500).default(""),
		isPublic: z.enum(["public", "private"]).default("public"),
		returnTo: z.string().optional()
	}),
	z.object({
		action: z.literal("visibility"),
		listId: z.string().min(1),
		isPublic: z.enum(["public", "private"]),
		returnTo: z.string().optional()
	}),
	z.object({
		action: z.literal("share"),
		listId: z.string().min(1),
		returnTo: z.string().optional()
	}),
	z.object({
		action: z.literal("revoke"),
		listId: z.string().min(1),
		returnTo: z.string().optional()
	}),
	z.object({
		action: z.literal("add"),
		listId: z.string().min(1),
		postId: z.string().min(1),
		note: z.string().trim().max(300).default(""),
		returnTo: z.string().optional()
	}),
	z.object({
		action: z.literal("remove"),
		listId: z.string().min(1),
		postSlug: z.string().min(1).max(120),
		returnTo: z.string().optional()
	}),
	z.object({
		action: z.literal("add-collaborator"),
		listId: z.string().min(1),
		handle: z.string().trim().min(1).max(60),
		role: z.enum(["editor", "viewer"]).default("viewer"),
		returnTo: z.string().optional()
	}),
	z.object({
		action: z.literal("remove-collaborator"),
		listId: z.string().min(1),
		handle: z.string().trim().min(1).max(60),
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
	const fail = (message) => {
		target.searchParams.set("studioError", message);
		return redirect(target.pathname + target.search, 303);
	};
	const input = parsed.data;
	switch (input.action) {
		case "create": {
			const result = await createReadingList(identity.userId, input.title, input.description, input.isPublic === "public");
			if (!result.ok) return fail(result.error);
			return redirect(back, 303);
		}
		case "visibility":
			if (!await setListVisibility(input.listId, identity.userId, input.isPublic === "public")) return fail("That list is not yours.");
			return redirect(back, 303);
		case "share": {
			if (!await rotateListShareToken(input.listId, identity.userId)) return fail("That list is not yours.");
			const link = new URL(back, url);
			link.searchParams.set("shared", input.listId);
			return redirect(link.pathname + link.search, 303);
		}
		case "revoke":
			if (!await revokeListShareToken(input.listId, identity.userId)) return fail("That list is not yours.");
			return redirect(back, 303);
		case "add": {
			const result = await addListItem(input.listId, identity.userId, input.postId, input.note);
			if (!result.ok) return fail(result.error);
			return redirect(back, 303);
		}
		case "remove":
			if (!await removeListItem(input.listId, identity.userId, input.postSlug)) return fail("You cannot edit that list.");
			return redirect(back, 303);
		case "add-collaborator": {
			const result = await addCollaborator(input.listId, identity.userId, input.handle, input.role);
			if (!result.ok) return fail(result.error);
			return redirect(back, 303);
		}
		case "remove-collaborator":
			if (!await removeCollaborator(input.listId, identity.userId, input.handle)) return fail("That list is not yours, or that is not a collaborator on it.");
			return redirect(back, 303);
	}
};
var GET = () => Response.redirect("/lists", 303);
//#endregion
//#region \0virtual:astro:page:src/pages/api/lists@_@ts
var page = () => lists_exports;
//#endregion
export { page };
