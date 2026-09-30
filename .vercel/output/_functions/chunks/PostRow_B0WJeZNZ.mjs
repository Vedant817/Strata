import { d as renderTemplate, f as maybeRenderHead, i as renderComponent, m as addAttribute, w as createAstro } from "./server_DKu4icSC.mjs";
import { t as createComponent } from "./compiler_DeGWR9rg.mjs";
import { a as shortAgo, n as longDate, r as plural } from "./format_D0bVmvvo.mjs";
import { t as $$StatusBadge } from "./StatusBadge_wg3zFwEI.mjs";
//#region src/components/PostRow.astro
createAstro("http://localhost:4321");
var $$PostRow = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$PostRow;
	const { slug, title, dek, status, publishedAt, updatedAt, authorName, topicName, readingMinutes, versionCount = 1, annotationTotal = 0, ordinal, note, compact = false } = Astro.props;
	const revised = versionCount > 1;
	return renderTemplate`${maybeRenderHead($$result)}<article${addAttribute(["group border-b border-rule py-6 first:border-t-0 first:pt-0 last:border-b-0", compact && "py-4"], "class:list")}><div class="flex gap-4 sm:gap-6">${ordinal !== void 0 && renderTemplate`<span class="meta w-6 shrink-0 pt-1 tabular-nums" aria-hidden="true">${String(ordinal).padStart(2, "0")}</span>`}<div class="min-w-0 flex-1"><div class="flex flex-wrap items-center gap-x-3 gap-y-1">${renderComponent($$result, "StatusBadge", $$StatusBadge, { "status": status })}${topicName && renderTemplate`<span class="meta">${topicName}</span>`}${revised && renderTemplate`<a${addAttribute(`/w/${slug}#revisions-heading`, "href")} class="meta text-accent no-underline hover:underline"${addAttribute(`${versionCount} revisions. Open the revision history.`, "title")}>revised ${versionCount}× · ${shortAgo(updatedAt ?? publishedAt)}</a>`}</div><h3${addAttribute(["mt-2", compact ? "text-[1.0625rem]" : "text-[1.1875rem]"], "class:list")}><a${addAttribute(`/w/${slug}`, "href")} class="no-underline transition-colors group-hover:text-accent">${title}</a></h3>${dek && !compact && renderTemplate`<p class="mt-1.5 text-[0.9375rem] leading-relaxed text-ink-2">${dek}</p>`}${note && renderTemplate`<p class="mt-2 border-l-2 border-rule-strong pl-3 text-[0.9375rem] text-ink-2">${note}</p>`}<p class="meta mt-2.5">${authorName && renderTemplate`<span>${authorName}</span>`}${authorName && renderTemplate`<span aria-hidden="true"> · </span>`}<span>${longDate(publishedAt)}</span>${readingMinutes ? renderTemplate`<span> · ${readingMinutes} min</span>` : null}${annotationTotal > 0 && renderTemplate`<span> · ${plural(annotationTotal, "note")}</span>`}</p></div></div></article>`;
}, "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/components/PostRow.astro", void 0);
//#endregion
export { $$PostRow as t };
