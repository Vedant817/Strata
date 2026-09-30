import { createHighlighter } from "shiki";
//#region src/lib/highlight.ts
/**
* Server-side syntax highlighting for code blocks.
*
* Highlighted on the server, once, and cached per language — the alternative is
* shipping a highlighter to the reader, which is exactly the weight this
* project refuses to add (see PLAN.md §2.5: the article page ships zero
* external JS). A highlighter is 200KB+ in the browser and free on a server
* that renders one page per request.
*
* The two themes are the site's own paper and ink, built from the same CSS
* custom properties the rest of the design uses, so a code block cannot
* introduce a colour that is not already in the palette. If the requested
* language is unknown, the code is returned unhighlighted rather than dropped:
* a wrong guess should never lose a reader the code.
*/
/** Aliases people actually type, mapped to real Shiki ids. */
var ALIASES = {
	js: "javascript",
	jsx: "jsx",
	ts: "typescript",
	tsx: "tsx",
	py: "python",
	rb: "ruby",
	sh: "bash",
	shell: "bash",
	zsh: "bash",
	console: "shell",
	yml: "yaml",
	md: "markdown",
	rs: "rust",
	golang: "go",
	"c++": "cpp",
	"c#": "csharp",
	cs: "csharp",
	kt: "kotlin",
	objc: "objective-c",
	postgres: "sql",
	psql: "sql",
	htm: "html",
	dockerfile: "docker",
	"": "text",
	text: "text",
	txt: "text",
	plain: "text"
};
var CODE_LANGUAGES = [
	{
		value: "text",
		label: "Plain text"
	},
	{
		value: "typescript",
		label: "TypeScript"
	},
	{
		value: "javascript",
		label: "JavaScript"
	},
	{
		value: "jsx",
		label: "JSX"
	},
	{
		value: "tsx",
		label: "TSX"
	},
	{
		value: "python",
		label: "Python"
	},
	{
		value: "rust",
		label: "Rust"
	},
	{
		value: "go",
		label: "Go"
	},
	{
		value: "java",
		label: "Java"
	},
	{
		value: "kotlin",
		label: "Kotlin"
	},
	{
		value: "swift",
		label: "Swift"
	},
	{
		value: "csharp",
		label: "C#"
	},
	{
		value: "cpp",
		label: "C++"
	},
	{
		value: "ruby",
		label: "Ruby"
	},
	{
		value: "php",
		label: "PHP"
	},
	{
		value: "sql",
		label: "SQL"
	},
	{
		value: "bash",
		label: "Shell"
	},
	{
		value: "json",
		label: "JSON"
	},
	{
		value: "yaml",
		label: "YAML"
	},
	{
		value: "toml",
		label: "TOML"
	},
	{
		value: "html",
		label: "HTML"
	},
	{
		value: "css",
		label: "CSS"
	},
	{
		value: "xml",
		label: "XML"
	},
	{
		value: "markdown",
		label: "Markdown"
	},
	{
		value: "docker",
		label: "Dockerfile"
	},
	{
		value: "graphql",
		label: "GraphQL"
	},
	{
		value: "diff",
		label: "Diff"
	}
];
function normaliseLang(raw) {
	const key = (raw ?? "").trim().toLowerCase();
	return ALIASES[key] ?? key;
}
var PAPER = {
	name: "strata-paper",
	type: "light",
	colors: {
		"editor.background": "#faf9f5",
		"editor.foreground": "#1a1917"
	},
	settings: [
		{
			scope: ["comment", "punctuation.definition.comment"],
			settings: {
				foreground: "6b675e",
				fontStyle: "italic"
			}
		},
		{
			scope: [
				"string",
				"string.quoted",
				"constant.other.symbol"
			],
			settings: { foreground: "2f6b3d" }
		},
		{
			scope: ["constant.numeric", "constant.language"],
			settings: { foreground: "9a4a1f" }
		},
		{
			scope: [
				"keyword",
				"storage",
				"storage.type",
				"keyword.control"
			],
			settings: { foreground: "8a3a2a" }
		},
		{
			scope: [
				"entity.name.function",
				"support.function",
				"meta.function-call"
			],
			settings: { foreground: "1f5673" }
		},
		{
			scope: [
				"entity.name.type",
				"support.type",
				"support.class"
			],
			settings: { foreground: "6b4a9c" }
		},
		{
			scope: ["variable", "variable.parameter"],
			settings: { foreground: "1a1917" }
		},
		{
			scope: ["entity.name.tag", "meta.tag"],
			settings: { foreground: "8a3a2a" }
		},
		{
			scope: ["entity.other.attribute-name"],
			settings: { foreground: "9a4a1f" }
		},
		{
			scope: ["punctuation", "meta.brace"],
			settings: { foreground: "6b675e" }
		},
		{
			scope: ["keyword.operator"],
			settings: { foreground: "6b4a9c" }
		},
		{
			scope: ["markup.heading"],
			settings: {
				foreground: "1f5673",
				fontStyle: "bold"
			}
		}
	]
};
var INK = {
	name: "strata-ink",
	type: "dark",
	colors: {
		"editor.background": "#100f0d",
		"editor.foreground": "#e8e4dc"
	},
	settings: [
		{
			scope: ["comment", "punctuation.definition.comment"],
			settings: {
				foreground: "8b857a",
				fontStyle: "italic"
			}
		},
		{
			scope: [
				"string",
				"string.quoted",
				"constant.other.symbol"
			],
			settings: { foreground: "8fbf9f" }
		},
		{
			scope: ["constant.numeric", "constant.language"],
			settings: { foreground: "e0a06a" }
		},
		{
			scope: [
				"keyword",
				"storage",
				"storage.type",
				"keyword.control"
			],
			settings: { foreground: "e08a75" }
		},
		{
			scope: [
				"entity.name.function",
				"support.function",
				"meta.function-call"
			],
			settings: { foreground: "7fb8d4" }
		},
		{
			scope: [
				"entity.name.type",
				"support.type",
				"support.class"
			],
			settings: { foreground: "bda6e0" }
		},
		{
			scope: ["variable", "variable.parameter"],
			settings: { foreground: "e8e4dc" }
		},
		{
			scope: ["entity.name.tag", "meta.tag"],
			settings: { foreground: "e08a75" }
		},
		{
			scope: ["entity.other.attribute-name"],
			settings: { foreground: "e0a06a" }
		},
		{
			scope: ["punctuation", "meta.brace"],
			settings: { foreground: "8b857a" }
		},
		{
			scope: ["keyword.operator"],
			settings: { foreground: "bda6e0" }
		},
		{
			scope: ["markup.heading"],
			settings: {
				foreground: "7fb8d4",
				fontStyle: "bold"
			}
		}
	]
};
/**
* The highlighter is pinned to globalThis, not to module scope.
*
* A highlighter with 26 grammars is tens of megabytes. Held in a module
* variable, a dev-server hot reload throws the old one away and builds a new
* one on the next render, and the process eventually runs out of memory and the
* dev server dies mid-request — which looks exactly like a bug in the renderer.
* On globalThis it survives reloads and is created once per process.
*/
var HOLDER = globalThis;
function getHighlighter() {
	HOLDER.__strataHighlighter ??= createHighlighter({
		themes: [PAPER, INK],
		langs: [
			"text",
			"typescript",
			"javascript",
			"jsx",
			"tsx",
			"python",
			"rust",
			"go",
			"java",
			"kotlin",
			"swift",
			"csharp",
			"cpp",
			"ruby",
			"php",
			"sql",
			"bash",
			"json",
			"yaml",
			"toml",
			"html",
			"css",
			"xml",
			"markdown",
			"docker",
			"graphql",
			"diff"
		]
	}).catch((err) => {
		HOLDER.__strataHighlighter = void 0;
		throw err;
	});
	return HOLDER.__strataHighlighter;
}
function escapeHtml(s) {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
/**
* Shiki wraps its output in its own `<pre class="shiki"><code>…</code></pre>`.
* We supply the surrounding `<pre>`/`<code>` ourselves (so one block can carry
* both themes), so keep only the token markup from inside Shiki's `<code>`.
* Feeding Shiki's whole output into our own `<code>` would nest a `<pre>`
* inside a `<pre>` and leave the theme display rules matching the wrong
* element.
*/
function innerCode(shikiHtml) {
	const open = shikiHtml.indexOf("<code");
	if (open === -1) return shikiHtml;
	const start = shikiHtml.indexOf(">", open) + 1;
	const end = shikiHtml.lastIndexOf("</code>");
	if (start <= 0 || end === -1 || end < start) return shikiHtml;
	return shikiHtml.slice(start, end);
}
/**
* Highlight a code block. Never throws: an unknown language, a Shiki failure,
* or a highlighting bug must still render the code.
*/
async function highlightCode(code, rawLang) {
	const lang = normaliseLang(rawLang);
	const plain = escapeHtml(code);
	try {
		const hl = await getHighlighter();
		if (!hl.getLoadedLanguages().includes(lang)) return {
			paper: plain,
			ink: plain,
			lang: "text",
			plain
		};
		const common = {
			lang,
			transformers: []
		};
		return {
			paper: innerCode(hl.codeToHtml(code, {
				...common,
				theme: "strata-paper"
			})),
			ink: innerCode(hl.codeToHtml(code, {
				...common,
				theme: "strata-ink"
			})),
			lang,
			plain
		};
	} catch (err) {
		console.error("[strata] highlight failed:", err);
		return {
			paper: plain,
			ink: plain,
			lang: "text",
			plain
		};
	}
}
//#endregion
export { highlightCode as n, normaliseLang as r, CODE_LANGUAGES as t };
