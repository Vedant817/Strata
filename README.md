# Strata

A publication for long-form that outlives its own publication date.

Posts are **layered living documents**: they carry a visible revision history, render at
three reader-chosen depths, and accept typed annotations pinned to a specific sentence *and*
the specific revision that sentence belonged to.

See [PLAN.md](./PLAN.md) for the product thesis, the data model, the roadmap and the
explicit kill-criteria.

## Stack

- **Astro 7** (`output: 'server'`, `@astrojs/node` standalone) — HTML-first, islands only
- **React 19** — six islands on an article page, budgeted
- **Tailwind 4** via `@tailwindcss/vite` — CSS-first `@theme`, semantic tokens
- **libsql (SQLite) + Drizzle** — 18 tables, zero external config to run locally
- **Zod** — the typed block document is validated on read

## Running it

```bash
npm install
npm run db:seed      # creates data/strata.db and loads the canon
npm run dev          # http://localhost:4321
```

The seed is idempotent and safe to re-run after editing `src/seed/content.ts`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run preview` | Serve the production build |
| `npm run check` | `astro check` + typecheck |
| `npm run lint:design` | Fails the build on banned visual patterns (see below) |
| `npm run db:seed` | Wipe and rebuild the database |
| `npm run db:generate` | Generate a Drizzle migration from the schema |
| `npm run db:studio` | Drizzle Studio |

## Design constraints

Not enforced by taste — enforced by `npm run lint:design`, which fails on:

- `gradient()`, `backdrop-filter`, `text-shadow`, glow, `box-shadow` with blur > 8px
- `border-radius` ≥ 12px, pill shapes
- `transition: all`, `will-change` on non-compositing properties
- AI-purple hues
- interactive elements without a `:focus-visible` style
- data-driven components missing an empty, loading or error state

The visual thesis is typography-first editorial: ink on paper, 1px hairlines, one accent
(`#A63A24`), no elevation, no gloss. Reference points in PLAN.md §2.

## Content model

A post body is a **typed block document**, not Markdown. This is what makes stable
annotation anchors, author-declared depth layers, semantic diffs and per-block comprehension
telemetry possible. `src/lib/blocks.ts` owns the schema; `src/seed/build.ts` is the authoring
DSL used by the seed content.

## Privacy

No third-party analytics scripts, no ad-tech cookies, no fingerprinting. Reading telemetry is
first-party and aggregate-only, and is never surfaced to a writer for cohorts under 20 readers.
`/privacy#forget` erases an anonymous reader's entire history on request.
