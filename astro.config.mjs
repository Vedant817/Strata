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
      filter: (page) => !page.includes('/studio') && !page.includes('/api/'),
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
    inlineStylesheets: 'auto',
  },
  security: {
    checkOrigin: true,
  },
  devToolbar: { enabled: false },
});
