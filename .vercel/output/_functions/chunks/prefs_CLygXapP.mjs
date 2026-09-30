//#region src/lib/prefs.ts
/**
* Reader preferences. Stored in a signed-free, plain cookie for now — the point
* is that a reader's depth/density/theme follows them across every post without
* an account, which is the whole premise of the reading experience.
*/
var THEME_COOKIE = "strata_theme";
var DENSITY_COOKIE = "strata_density";
var DEPTH_COOKIE = "strata_depth";
var ANON_COOKIE = "strata_anon";
var THEMES = ["paper", "ink"];
var DENSITIES = [
	"comfortable",
	"compact",
	"roomy"
];
var DEPTHS = [
	"skim",
	"understand",
	"master"
];
var DEPTH_LABEL = {
	skim: "Skim",
	understand: "Read",
	master: "Study"
};
var DEPTH_HINT = {
	skim: "The argument only. About 90 seconds.",
	understand: "The full argument, with prerequisites explained inline.",
	master: "Everything. Footnotes, citations, private author notes, appendices."
};
function pick(raw, allowed, fallback) {
	return allowed.includes(raw) ? raw : fallback;
}
function readCookie(cookies, name) {
	return cookies[name];
}
function resolvePrefs(cookies, anonId) {
	return {
		theme: pick(readCookie(cookies, THEME_COOKIE), THEMES, "paper"),
		density: pick(readCookie(cookies, DENSITY_COOKIE), DENSITIES, "comfortable"),
		depth: pick(readCookie(cookies, DEPTH_COOKIE), DEPTHS, "understand"),
		anonId
	};
}
/**
* The one id for this browser, minted at most once per request.
*
* Pages used to fall back to a fresh `crypto.randomUUID()` whenever no cookie
* arrived — and the layout minted a *different* one for the outgoing cookie.
* Every first-visit write (read receipts, first notes) was then recorded
* under an id the browser would never send again: orphaned on arrival. The
* "changed since you read it" banner never fired for a first read, and reader
* memory missed every reader's first post.
*
* Page frontmatter runs before the layout, so the first caller mints and
* sets, and later callers see `has()` and must NOT mint again. A caller that
* arrives after the mint cannot retrieve the minted value (Astro exposes
* outgoing cookies through `has`, not `get`), so it gets a throwaway marked
* as such — safe for reads, and anything that writes must be the minter.
*/
function ensureAnonId(cookies) {
	const incoming = cookies.get(ANON_COOKIE)?.value;
	if (incoming) return incoming;
	if (cookies.has("strata_anon")) return `transient-${crypto.randomUUID()}`;
	const id = crypto.randomUUID();
	cookies.set(ANON_COOKIE, id, {
		path: "/",
		httpOnly: false,
		sameSite: "lax",
		maxAge: 31536e3
	});
	return id;
}
//#endregion
export { DEPTH_COOKIE as a, THEME_COOKIE as c, DEPTHS as i, ensureAnonId as l, DENSITIES as n, DEPTH_HINT as o, DENSITY_COOKIE as r, DEPTH_LABEL as s, ANON_COOKIE as t, resolvePrefs as u };
