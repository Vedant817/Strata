import { d as renderTemplate, f as maybeRenderHead, m as addAttribute, w as createAstro } from "./server_DKu4icSC.mjs";
import { t as createComponent } from "./compiler_DeGWR9rg.mjs";
import { i as relativeTime } from "./format_D0bVmvvo.mjs";
//#region src/components/StatusBadge.astro
createAstro("http://localhost:4321");
var $$StatusBadge = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$StatusBadge;
	const META = {
		seedling: {
			label: "Seedling",
			colour: "var(--moss)",
			meaning: "An early, evolving thought. Published before it is finished."
		},
		budding: {
			label: "Budding",
			colour: "var(--ochre)",
			meaning: "An argument forming, with references attached to its claims."
		},
		evergreen: {
			label: "Evergreen",
			colour: "var(--pine)",
			meaning: "Actively maintained. Someone is answerable for its accuracy."
		},
		archived: {
			label: "Archived",
			colour: "var(--ink-3)",
			meaning: "Kept for the record, no longer maintained."
		}
	};
	const { status, updatedAt, compact = false } = Astro.props;
	const meta = META[status];
	return renderTemplate`${maybeRenderHead($$result)}<span class="meta inline-flex items-center gap-1.5 whitespace-nowrap"${addAttribute(meta.meaning, "title")}${addAttribute(compact ? void 0 : `color: ${meta.colour}`, "style")}><span class="inline-block h-1.5 w-1.5 shrink-0"${addAttribute(`background: ${meta.colour}`, "style")} aria-hidden="true"></span>${meta.label}${!compact && updatedAt && renderTemplate`<span class="text-ink-3">· ${relativeTime(updatedAt)}</span>`}</span>`;
}, "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/components/StatusBadge.astro", void 0);
//#endregion
export { $$StatusBadge as t };
