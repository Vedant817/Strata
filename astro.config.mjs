// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import vercel from '@astrojs/vercel';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

const SITE = process.env.SITE_URL ?? 'http://localhost:4321';
// Vercel sets VERCEL=1 on its builders. Build with the Vercel adapter there
// (serverless functions) and the Node standalone adapter everywhere else, so
// `npm run preview` and the smoke suite keep testing the exact artifact CI
// builds. One config, two targets, no drift in between.
const onVercel = process.env.VERCEL === '1';

export default defineConfig({
  site: SITE,
  output: 'server',
  adapter: onVercel ? vercel() : node({ mode: 'standalone' }),
  trailingSlash: 'ignore',
  integrations: [
    // No React. The last island was Marginalia; it and the other two
    // interactive surfaces (the depth dial, the artifact figures) are now plain
    // DOM, because shipping a framework runtime to re-render a textarea and move
    // an SVG line cost more than every other script on the page combined.
    sitemap({
      /* `/week` is per-reader: its contents depend on one visitor's follows
         and finished reads, so listing it would be an invitation for a crawler
         to cache it and serve one reader's constellation to the next. It is
         `noindex` and `private, no-store` as well; this is the third lock.

         The trailing slash matters: the sitemap writes `<loc>` with one, so a
         filter anchored at `/week` matches nothing and the page ships in the
         sitemap anyway. An earlier version of this exact filter did. */
      filter: (page) =>
        !page.includes('/studio') &&
        !page.includes('/api/') &&
        !/^\/week\/?$/.test(new URL(page).pathname),
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
    // resvg ships a native binary. Vite's dev pre-bundler tries to read it as
    // UTF-8 JavaScript and fails, which poisons the module graph for every
    // route — not just the share-card endpoint that uses it.
    optimizeDeps: { exclude: ['@resvg/resvg-js'] },
    ssr: { external: ['@resvg/resvg-js'] },
  },
  build: {
    /* Inline the stylesheet. `auto` (Astro's default) only inlines below 4KB,
       so 42KB shipped as an external `<link>` — and a render-blocking link is
       not free: on the Slow 4G profile PLAN.md §2.5 measures against, the extra
       request costs 562ms of latency before the first pixel, which was more
       than half of the 1817ms LCP on the homepage.

       Inlining trades that round-trip for bytes the reader already has in the
       document they are waiting for anyway. It costs ~215ms of transfer at
       1.6Mbps and saves 562ms of latency, and the CSS compresses inside the
       HTML: the whole page went out at 27.9KB brotli. On a warm connection the
       extra bytes are ~35ms. The trade is clearly worth it, and only on the
       first view — after that the document is in cache either way.

       scripts/perf-budget.ts reads the inlined CSS out of the built HTML, so
       this does not make the CSS budget stop counting: it makes it count the
       bytes a reader actually downloads. */
    inlineStylesheets: 'always',
  },
  security: {
    checkOrigin: true,
  },
  devToolbar: { enabled: false },
});
