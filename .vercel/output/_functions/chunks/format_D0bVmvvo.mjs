//#region src/lib/format.ts
/** Presentation helpers. Locale-stable on purpose — this is a reading product and
*  dates should not shift meaning because of where the server is. */
var MONTHS = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December"
];
function longDate(ms) {
	if (!ms) return "Unpublished";
	const d = new Date(ms);
	return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
/** "3 days ago" / "in 2 months", rounded. Used for staleness and read times. */
function relativeTime(ms, now = Date.now()) {
	if (!ms) return "never";
	const delta = ms - now;
	const abs = Math.abs(delta);
	const units = [
		["year", 31536e6],
		["month", 2592e6],
		["week", 6048e5],
		["day", 864e5],
		["hour", 36e5],
		["minute", 6e4]
	];
	const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
	for (const [unit, size] of units) if (abs >= size) return rtf.format(Math.round(delta / size), unit);
	return "just now";
}
/** "3 days ago" / "in 2 months". Unlike relativeTime, `numeric: 'always'` — the
*  "last week" / "yesterday" forms produce nonsense when a sentence already
*  says "last" ("last last week"). */
function ago(ms, now = Date.now()) {
	if (!ms) return "never";
	const delta = ms - now;
	const abs = Math.abs(delta);
	const units = [
		["year", 31536e6],
		["month", 2592e6],
		["week", 6048e5],
		["day", 864e5],
		["hour", 36e5],
		["minute", 6e4]
	];
	const rtf = new Intl.RelativeTimeFormat("en", { numeric: "always" });
	for (const [unit, size] of units) if (abs >= size) return rtf.format(Math.round(delta / size), unit);
	return "just now";
}
/** Compact "3d ago" form for dense metadata rows. */
function shortAgo(ms, now = Date.now()) {
	if (!ms) return "—";
	const days = Math.floor((now - ms) / 864e5);
	if (days < 1) return "today";
	if (days < 30) return `${days}d ago`;
	if (days < 365) return `${Math.round(days / 30)}mo ago`;
	return `${Math.floor(days / 365)}y ago`;
}
function plural(n, one, many = `${one}s`) {
	return `${n} ${n === 1 ? one : many}`;
}
/**
* A verb agreeing with a count: `verb(1, 'argues', 'argue')`.
*
* Hand-writing "1 note argues / 4 notes argue" is a classic place for a blog to
* look machine-made, and the pattern recurs on every count in the product.
*/
function verb(n, one, many = one) {
	return new Intl.PluralRules("en", { type: "cardinal" }).select(n) === "one" ? one : many;
}
//#endregion
export { shortAgo as a, relativeTime as i, longDate as n, verb as o, plural as r, ago as t };
