import { t as __exportAll } from "./rolldown-runtime_8H4AJuhK.mjs";
import { C as readerProfiles, n as readyDb } from "./db_NRbr6ekn.mjs";
import { eq } from "drizzle-orm";
//#region src/lib/repo/readerProfile.ts
var readerProfile_exports = /* @__PURE__ */ __exportAll({
	getProfile: () => getProfile,
	saveProfile: () => saveProfile
});
async function getProfile(userId) {
	const [row] = await (await readyDb()).select({
		depth: readerProfiles.depthPreference,
		density: readerProfiles.density
	}).from(readerProfiles).where(eq(readerProfiles.userId, userId)).limit(1);
	if (!row) return null;
	return {
		depth: row.depth,
		density: row.density
	};
}
async function saveProfile(userId, prefs) {
	const database = await readyDb();
	const existing = await getProfile(userId);
	const merged = {
		depth: prefs.depth ?? existing?.depth ?? "understand",
		density: prefs.density ?? existing?.density ?? "comfortable"
	};
	await database.insert(readerProfiles).values({
		userId,
		depthPreference: merged.depth,
		density: merged.density
	}).onConflictDoUpdate({
		target: readerProfiles.userId,
		set: {
			depthPreference: merged.depth,
			density: merged.density
		}
	});
}
//#endregion
export { readerProfile_exports as n, saveProfile as r, getProfile as t };
