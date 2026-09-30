import { S as unescapeHTML, a as Fragment, c as renderSlot, d as renderTemplate, f as maybeRenderHead, h as defineScriptVars, i as renderComponent, m as addAttribute, p as renderHead, w as createAstro } from "./server_DKu4icSC.mjs";
import { t as createComponent } from "./compiler_DeGWR9rg.mjs";
import { c as THEME_COOKIE, l as ensureAnonId, r as DENSITY_COOKIE, u as resolvePrefs } from "./prefs_CLygXapP.mjs";
//#region src/components/SiteHeader.astro
createAstro("http://localhost:4321");
var $$SiteHeader = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$SiteHeader;
	const path = Astro.url.pathname;
	const links = [
		{
			href: "/writing",
			label: "Writing"
		},
		{
			href: "/topics",
			label: "Topics"
		},
		{
			href: "/constellations",
			label: "Constellations"
		},
		{
			href: "/lists",
			label: "Lists"
		},
		{
			href: "/search",
			label: "Search"
		},
		{
			href: "/about",
			label: "About"
		},
		{
			href: "/write",
			label: "Write"
		}
	];
	const isActive = (href) => path === href || path.startsWith(href + "/");
	const navLinks = links.filter((l) => l.href !== "/search");
	return renderTemplate`${maybeRenderHead($$result)}<header data-chrome="true" class="border-b border-rule bg-paper z-40 md:sticky md:top-0"><div class="shell"><div class="flex flex-wrap items-center gap-x-6 py-3 md:py-4"><a href="/" class="group no-underline shrink-0"><span class="font-serif text-[1.375rem] leading-none font-medium tracking-tight text-ink">Strata</span></a><nav aria-label="Primary" class="nav-scroll order-3 -mx-5 mt-3 w-[calc(100%+2.5rem)] overflow-x-auto border-t border-rule px-5 pt-1 md:order-none md:mx-0 md:mt-0 md:w-auto md:flex-1 md:overflow-visible md:border-t-0 md:px-0 md:pt-0"><ul class="flex items-center gap-5 whitespace-nowrap md:gap-6">${navLinks.map((l) => renderTemplate`<li><a${addAttribute(l.href, "href")}${addAttribute(["meta inline-block py-1.5 no-underline transition-colors hover:text-ink", isActive(l.href) ? "text-ink" : "text-ink-3"], "class:list")}${addAttribute(isActive(l.href) ? "page" : void 0, "aria-current")}>${l.label}</a></li>`)}<li><a href="/search" data-palette-trigger${addAttribute(["meta inline-block py-1.5 no-underline transition-colors hover:text-ink", isActive("/search") ? "text-ink" : "text-ink-3"], "class:list")}>Search<kbd class="ml-1.5 hidden rounded-sm border border-rule px-1 font-mono text-[0.6875rem] text-ink-3 md:inline-block" aria-hidden="true">⌘K</kbd></a></li></ul></nav><div class="ml-auto flex shrink-0 items-center gap-1 border-l border-rule pl-3"><button type="button" data-theme-toggle aria-label="Switch between paper and ink" title="Switch between paper and ink" class="grid h-8 w-8 place-items-center border border-transparent text-ink-3 transition-colors hover:border-rule hover:text-ink"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" aria-hidden="true"><circle cx="8" cy="8" r="3.4"></circle><path d="M8 1v1.6M8 13.4V15M15 8h-1.6M2.6 8H1M12.9 3.1l-1.1 1.1M4.2 11.8l-1.1 1.1M12.9 12.9l-1.1-1.1M4.2 4.2L3.1 3.1" stroke-linecap="round"></path></svg></button><button type="button" data-density-toggle aria-label="Cycle reading density" title="Cycle reading density" class="meta grid h-8 w-8 place-items-center border border-transparent transition-colors hover:border-rule hover:text-ink"><span data-density-label>aA</span></button></div></div></div></header><div data-palette hidden><div data-palette-overlay class="fixed inset-0 z-50 bg-ink/40" aria-hidden="true"></div><div role="dialog" aria-modal="true" aria-label="Search Strata" class="fixed inset-x-3 top-[12vh] z-50 mx-auto max-w-xl border border-rule-strong bg-paper"><div class="border-b border-rule"><input data-palette-input type="search" autocomplete="off"${addAttribute(false, "spellcheck")} placeholder="Search posts, topics, pages…" aria-label="Search posts, topics, pages" aria-expanded="true" aria-controls="palette-results" aria-activedescendant="" role="combobox" class="w-full bg-transparent px-4 py-3 text-[1.0625rem] focus:outline-none placeholder:text-ink-3"></div><ul id="palette-results" data-palette-results role="listbox" aria-label="Results" class="max-h-[46vh] overflow-y-auto p-1.5"></ul><div class="flex items-center justify-between border-t border-rule px-4 py-2"><p class="meta" aria-hidden="true">↑↓ navigate · ↵ select · Esc close</p><a data-palette-all class="meta no-underline hover:text-ink" href="/search">Full search →</a></div></div></div><script>
  (() => {
    /* Instant palette: one fetch of a compact index, then every keystroke
       filters in memory. No per-keystroke request, no debounce, no spinner —
       on a corpus this size the filter is microseconds, so the only latency
       is the single warm-up fetch, which starts on idle before first use. */
    const trigger = document.querySelector('[data-palette-trigger]');
    const root = document.querySelector('[data-palette]');
    if (!trigger || !root) return;
    const input = root.querySelector('[data-palette-input]');
    const list = root.querySelector('[data-palette-results]');
    const all = root.querySelector('[data-palette-all]');
    const overlay = root.querySelector('[data-palette-overlay]');

    const PAGES = [
      { label: 'Go to Writing', hint: 'posts', href: '/writing', keys: 'writing posts all archive' },
      { label: 'Go to Topics', hint: 'browse', href: '/topics', keys: 'topics browse subjects' },
      { label: 'Go to Constellations', hint: 'graph', href: '/constellations', keys: 'constellations graph links' },
      { label: 'Go to Lists', hint: 'curated', href: '/lists', keys: 'lists reading curated collections' },
      { label: 'Go to About', hint: 'what is this', href: '/about', keys: 'about what is this strata' },
      { label: 'Reading settings', hint: 'depth density', href: '/settings', keys: 'settings depth density preferences theme' },
      { label: 'Write here', hint: 'studio', href: '/write', keys: 'write studio new draft' },
    ];

    let posts = null; // [{slug,title,dek,topic,minutes}]
    let warmed = false;
    async function warm() {
      if (warmed) return;
      warmed = true;
      try {
        const res = await fetch('/api/search-index', { headers: { accept: 'application/json' } });
        if (!res.ok) return;
        const json = await res.json();
        if (Array.isArray(json.posts)) posts = json.posts;
      } catch {
        posts = null;
      }
    }
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => warm(), { timeout: 4000 });
    } else {
      setTimeout(warm, 1500);
    }

    let items = []; // rendered rows: {label, hint, href}
    let active = -1;
    let lastFocus = null;

    function matchPosts(q) {
      if (!posts) return [];
      const out = [];
      for (const p of posts) {
        const title = p.title.toLowerCase();
        const hay = (p.title + ' ' + (p.dek || '') + ' ' + (p.topic || '')).toLowerCase();
        let score = -1;
        if (title.startsWith(q)) score = 0;
        else if (title.includes(q)) score = 1;
        else if (hay.includes(q)) score = 2;
        if (score >= 0) {
          out.push({
            score,
            label: p.title,
            hint: [p.topic, p.minutes ? p.minutes + ' min' : null].filter(Boolean).join(' · '),
            href: '/w/' + p.slug,
            dek: p.dek,
          });
        }
      }
      out.sort((a, b) => a.score - b.score);
      return out.slice(0, 7);
    }

    function matchPages(q) {
      const out = [];
      for (const pg of PAGES) {
        if (pg.label.toLowerCase().includes(q) || pg.keys.includes(q)) out.push(pg);
      }
      return out.slice(0, 4);
    }

    function render(q) {
      const query = q.trim().toLowerCase();
      items = query ? [...matchPosts(query), ...matchPages(query)] : PAGES.slice(0, 5);
      active = items.length ? 0 : -1;
      list.innerHTML = '';
      input.setAttribute('aria-activedescendant', '');
      all.href = '/search' + (query ? '?q=' + encodeURIComponent(q.trim()) : '');
      if (!items.length) {
        const li = document.createElement('li');
        li.className = 'px-3 py-3 text-[0.9375rem] text-ink-3';
        li.textContent = posts ? 'Nothing matches — try the full search.' : 'Index still loading — try the full search.';
        list.appendChild(li);
        return;
      }
      items.forEach((it, i) => {
        const li = document.createElement('li');
        li.id = 'palette-opt-' + i;
        li.setAttribute('role', 'option');
        const a = document.createElement('a');
        a.href = it.href;
        a.className =
          'flex items-baseline justify-between gap-3 px-3 py-2 no-underline ' +
          (i === active ? 'bg-sunken text-ink' : 'text-ink-2');
        a.setAttribute('aria-selected', i === active ? 'true' : 'false');
        a.tabIndex = -1;
        const label = document.createElement('span');
        label.className = 'text-[0.9375rem] font-medium';
        label.textContent = it.label;
        const hint = document.createElement('span');
        hint.className = 'meta shrink-0';
        hint.textContent = it.hint || '';
        a.appendChild(label);
        a.appendChild(hint);
        // Clicking a row navigates natively; mousedown first so the input
        // blur handler (if any) cannot eat the click.
        a.addEventListener('mousedown', (e) => e.preventDefault());
        li.appendChild(a);
        list.appendChild(li);
      });
      paint();
    }

    function paint() {
      const rows = list.querySelectorAll('a');
      rows.forEach((a, i) => {
        const on = i === active;
        a.classList.toggle('bg-sunken', on);
        a.classList.toggle('text-ink', on);
        a.classList.toggle('text-ink-2', !on);
        a.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      input.setAttribute('aria-activedescendant', active >= 0 ? 'palette-opt-' + active : '');
    }

    function open() {
      lastFocus = document.activeElement;
      root.hidden = false;
      document.body.style.overflow = 'hidden';
      warm();
      render('');
      input.value = '';
      // Focus synchronously first — in a background tab rAF may never fire,
      // and an unfocused palette is a dead palette. The rAF re-asserts after
      // layout in case the synchronous call raced the unhide.
      try {
        input.focus({ preventScroll: true });
      } catch {
        input.focus();
      }
      requestAnimationFrame(() => input.focus());
    }
    function close() {
      root.hidden = true;
      document.body.style.overflow = '';
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      if (root.hidden) open();
      else close();
    });
    overlay.addEventListener('click', close);
    input.addEventListener('input', () => render(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (items.length) active = (active + 1) % items.length;
        paint();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (items.length) active = (active - 1 + items.length) % items.length;
        paint();
      } else if (e.key === 'Enter') {
        if (active >= 0 && items[active]) {
          e.preventDefault();
          window.location.href = items[active].href;
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    });
    document.addEventListener('keydown', (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === 'k' || e.key === 'K')) {
        // Never hijack typing: if the user is in a field, only an explicit
        // click or Escape-then-shortcut opens the palette.
        const t = e.target;
        const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
        if (typing) return;
        e.preventDefault();
        if (root.hidden) open();
        else close();
      } else if (e.key === 'Escape' && !root.hidden) {
        close();
      }
      // \`/\` opens the palette from anywhere except a field. The footer legend
      // does not advertise it; it is a gift for the kind of reader who tries.
      if (!mod && e.key === '/' && root.hidden) {
        const t = e.target;
        const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
        if (!typing) {
          e.preventDefault();
          open();
        }
      }
    });
  })();
<\/script><script>(function(){${defineScriptVars({
		themeCookie: THEME_COOKIE,
		densityCookie: DENSITY_COOKIE
	})}
  (() => {
    const YEAR = 60 * 60 * 24 * 365;
    const root = document.documentElement;

    document.querySelector('[data-theme-toggle]')?.addEventListener('click', () => {
      const next = root.dataset.theme === 'ink' ? 'paper' : 'ink';
      root.dataset.theme = next;
      document.cookie = \`\${themeCookie}=\${next};path=/;max-age=\${YEAR};samesite=lax\`;
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', next === 'ink' ? '#100f0d' : '#faf9f5');
    });

    const LABELS = { comfortable: 'aA', compact: 'A', roomy: 'aa' };
    const order = ['comfortable', 'compact', 'roomy'];
    const densityLabel = document.querySelector('[data-density-label]');
    const paintDensity = () => {
      if (densityLabel) densityLabel.textContent = LABELS[root.dataset.density] ?? 'aA';
    };
    paintDensity();

    document.querySelector('[data-density-toggle]')?.addEventListener('click', () => {
      const i = order.indexOf(root.dataset.density);
      const next = order[(i + 1) % order.length];
      root.dataset.density = next;
      document.cookie = \`\${densityCookie}=\${next};path=/;max-age=\${YEAR};samesite=lax\`;
      paintDensity();
    });
  })();
})();<\/script>`;
}, "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/components/SiteHeader.astro", void 0);
//#endregion
//#region src/components/SiteFooter.astro
createAstro("http://localhost:4321");
var $$SiteFooter = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$SiteFooter;
	const year = (/* @__PURE__ */ new Date()).getUTCFullYear();
	const newsletter = Astro.url.searchParams.get("newsletter");
	return renderTemplate`${maybeRenderHead($$result)}<footer data-chrome="true" class="mt-24 border-t border-rule"><div class="shell py-12"><div class="grid gap-10 md:grid-cols-[2fr_1fr_1fr]"><div class="max-w-sm"><p class="font-serif text-lg">Strata</p><p class="mt-2 text-[0.9375rem] leading-relaxed text-ink-2">A publication for long-form that outlives its own publication date. Posts here carry their revision history, and you can set the depth you read at.</p>${newsletter === "done" ? renderTemplate`<p class="meta mt-4 border border-pine px-3 py-2 text-pine">You are on the list. One email a week, unsubscribe anytime.</p>` : renderTemplate`<form method="post" action="/api/newsletter" class="mt-4 flex max-w-xs gap-2"><label class="sr-only" for="newsletter-email">Email for the weekly digest</label><input id="newsletter-email" name="email" type="email" required${addAttribute(320, "maxlength")} autocomplete="email" placeholder="you@example.com" class="min-w-0 flex-1 border border-rule bg-paper px-3 py-1.5 text-[0.875rem] focus:border-accent focus:outline-none"><input type="hidden" name="returnTo"${addAttribute(Astro.url.pathname + Astro.url.search, "value")}><button type="submit" class="shrink-0 border border-ink bg-ink px-3 py-1.5 text-[0.875rem] text-paper transition-colors hover:border-accent hover:bg-accent">Follow</button></form>`}${newsletter === "error" && renderTemplate`<p class="meta mt-2 text-danger" role="alert">That email did not look right — nothing was saved.</p>`}</div><div><p class="meta">Read</p><ul class="mt-3 space-y-2 text-[0.9375rem]"><li><a href="/writing" class="text-ink-2 no-underline hover:text-accent">All writing</a></li><li><a href="/reader" class="text-ink-2 no-underline hover:text-accent">Your reading</a></li><li><a href="/topics" class="text-ink-2 no-underline hover:text-accent">Topics</a></li><li><a href="/lists" class="text-ink-2 no-underline hover:text-accent">Reading lists</a></li><li><a href="/rss.xml" class="text-ink-2 no-underline hover:text-accent">RSS</a></li></ul></div><div><p class="meta">This site</p><ul class="mt-3 space-y-2 text-[0.9375rem]"><li><a href="/about" class="text-ink-2 no-underline hover:text-accent">How it works</a></li><li><a href="/thesis" class="text-ink-2 no-underline hover:text-accent">Is this working?</a></li><li><a href="/privacy" class="text-ink-2 no-underline hover:text-accent">Privacy</a></li><li><a href="/write" class="text-ink-2 no-underline hover:text-accent">Write here</a></li></ul></div></div><div class="mt-12 flex flex-col gap-3 border-t border-rule pt-6 sm:flex-row sm:items-center sm:justify-between"><p class="meta">© ${year} Strata. Set in IBM Plex.</p><a href="/privacy#forget" class="meta no-underline transition-colors hover:text-ink">Forget my reading history →</a></div></div></footer>`;
}, "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/components/SiteFooter.astro", void 0);
//#endregion
//#region src/layouts/Base.astro
createAstro("http://localhost:4321");
var $$Base = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$Base;
	const { title, description = "Strata — long-form that admits it is out of date. Read at your depth, argue in the margins.", canonical, ogType = "website", noindex = false, jsonLd = [], ogImage, bodyClass = "" } = Astro.props;
	const anonId = ensureAnonId(Astro.cookies);
	const prefs = Astro.props.prefs ?? resolvePrefs(Astro.cookies, anonId);
	const site = Astro.site ?? new URL("http://localhost:4321");
	const pageTitle = !title || title === "Strata" ? "Strata" : `${title} · Strata`;
	const canonicalUrl = canonical ? new URL(canonical, site).href : Astro.url.href;
	const graph = jsonLd.length ? JSON.stringify({
		"@context": "https://schema.org",
		"@graph": jsonLd
	}) : null;
	return renderTemplate`<html lang="en"${addAttribute(prefs.theme, "data-theme")}${addAttribute(prefs.density, "data-density")}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${pageTitle}</title><meta name="description"${addAttribute(description, "content")}>${noindex && renderTemplate`<meta name="robots" content="noindex, nofollow">`}<link rel="canonical"${addAttribute(canonicalUrl, "href")}><meta name="theme-color"${addAttribute(prefs.theme === "ink" ? "#100f0d" : "#faf9f5", "content")}><meta property="og:type"${addAttribute(ogType, "content")}><meta property="og:site_name" content="Strata"><meta property="og:title"${addAttribute(title ?? "Strata", "content")}><meta property="og:description"${addAttribute(description, "content")}><meta property="og:url"${addAttribute(canonicalUrl, "content")}>${ogImage ? renderTemplate`${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`<meta property="og:image"${addAttribute(new URL(ogImage, site).href, "content")}><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt"${addAttribute(title ?? "Strata", "content")}><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image"${addAttribute(new URL(ogImage, site).href, "content")}>` })}` : renderTemplate`<meta name="twitter:card" content="summary">`}<meta name="twitter:title"${addAttribute(title ?? "Strata", "content")}><meta name="twitter:description"${addAttribute(description, "content")}><link rel="alternate" type="application/rss+xml" title="Strata — all writing" href="/rss.xml"><link rel="sitemap" type="application/xml" href="/sitemap-index.xml"><link rel="icon" href="/favicon.svg" type="image/svg+xml">${graph && renderTemplate`<script type="application/ld+json">${unescapeHTML(graph)}<\/script>`}<script>(function(){${defineScriptVars({
		themeCookie: THEME_COOKIE,
		densityCookie: DENSITY_COOKIE
	})}
      (() => {
        const read = (name) =>
          (document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)')) || [])[1];
        const stored = read(themeCookie);
        if (stored === 'paper' || stored === 'ink') {
          document.documentElement.dataset.theme = stored;
        } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
          document.documentElement.dataset.theme = 'ink';
        }
        const d = read(densityCookie);
        if (d) document.documentElement.dataset.density = d;
      })();
    })();<\/script><script>
      (() => {
        window.__strataErrors = [];
        const keep = (kind, message, stack) => {
          window.__strataErrors.push({ kind, message: String(message), stack: String(stack || '').slice(0, 600) });
          if (window.__strataErrors.length > 20) window.__strataErrors.shift();
        };
        window.addEventListener('error', (e) => keep('error', e.message, e.error && e.error.stack));
        window.addEventListener('unhandledrejection', (e) => keep('rejection', e.reason));
      })();
    <\/script>${renderHead($$result)}</head><body${addAttribute(bodyClass, "class")}><a href="#main" class="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-ink focus:px-3 focus:py-2 focus:text-paper">Skip to content</a>${renderComponent($$result, "SiteHeader", $$SiteHeader, {})}<main id="main" tabindex="-1">${renderSlot($$result, $$slots["default"])}</main>${renderComponent($$result, "SiteFooter", $$SiteFooter, {})}${renderSlot($$result, $$slots["scripts"])}</body></html>`;
}, "C:/Users/vedan/Documents/Resources/Astro/ssr-blog/src/layouts/Base.astro", void 0);
//#endregion
export { $$Base as t };
