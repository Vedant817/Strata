// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

const SITE = process.env.SITE_URL ?? 'http://localhost:4321';

export default defineConfig({
  site: SITE,
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  trailingSlash: 'ignore',
  integrations: [
    react(),
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
