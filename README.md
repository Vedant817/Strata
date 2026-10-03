# Strata

**A publication about things that change.** Long-form that outlives its own publication date: posts are living, layered documents with visible revision histories, margin notes pinned to sentences *and* revisions, and readers who are told when something they read gets fixed.

## Why this is different

Every publishing tool optimizes the moment of publishing. Strata optimizes the five years after:

- **Posts are maintained, not published.** Revisions are versioned, diffable, and attributable. Readers who saw the old version get told what moved (revision subscriptions) instead of discovering staleness by accident.
- **One post, three readers.** Blocks carry depth layers — skim the argument, read it properly, or study the footnotes — so a single post serves three altitudes instead of alienating two of them.
- **Arguments survive rewrites.** Notes attach to a sentence *and* the revision it belonged to, with anchor resolution that survives edits. Accept a correction and it folds into history as an attributed amendment.
- **Ask answers from the post, or refuses.** Grounded in the retrieved passages and attributed to the model that answered; a reader can pick a provider and model, and automatic stays on free-tier models. It never draws on outside knowledge.
- **Bring your archive, keep your dates.** Markdown with front matter and WordPress XML import as budding drafts with their original publication dates and their old permalinks intact.
- **No engagement machinery.** No likes, no follower counts, no trending, no algorithmic feed. Empathy analytics are aggregate-only with a 20-reader floor.
- **Zero client JavaScript on the reading path.** No framework runtime — interactions are a few hundred bytes of inline script. Syntax highlighting, charts, and the search palette are all server-rendered.

## Search benchmarks

Measured on this machine: 1,000,000 synthetic documents with Zipfian term frequencies through the app's exact SQLite FTS5 setup (porter stemming, `LIMIT` + `ORDER BY rank`, snippets — the real `/search` query shape).

| Query (1M docs) | Hits | p50 | p99 |
|---|---|---|---|
| Rare term | 500 | **1 ms** | **3 ms** |
| Mid term | 5,000 | **8 ms** | **43 ms** |
| Ranked top-20 + snippet | 20 | **~1 s** | **1.8 s** |
| Common term, full count (the app never does this) | 876K | 2.2 s | 5.3 s |

Same-scale published figures (2026, comparable hardware): Meilisearch p50 24 ms / p99 82 ms · Typesense 31 / 94 ms · Elasticsearch 89 / 247 ms · Algolia <10 ms (hosted, expensive past 10K searches/mo) · Postgres tsvector ~3K ranked qps at $0 if you already run it.

The specialists are 10–40× faster on hot terms at a million documents — real, and what their in-memory indexes buy. At this app's scale (hundreds to thousands of posts) FTS5 answers in under a millisecond with zero infrastructure, zero ops, and transactional consistency with the content. The command palette filters a ~1KB index in ~2 ms per keystroke and links out to `/search` for depth.

## Stack

- **Astro 7** (`output: 'server'`, `@astrojs/node` standalone) — HTML-first, **no client framework** (0 KB external JS on the reading path)
- **Tailwind 4** via `@tailwindcss/vite` — CSS-first `@theme`, semantic tokens
- **libsql (SQLite) + Drizzle** — 28 tables, 14 migrations; local file in dev, Turso hosted
- **SQLite FTS5** — `post_fts` for search, `block_fts` for Ask grounding
- **Shiki** — server-side syntax highlighting, paper + ink themes in the markup
- **Zod** — the typed block document is validated on read
- **Resend** — claim emails, digest, revision notices (all degrade honestly without a key)

## Running it

```bash
npm install
npm run db:seed      # creates data/strata.db and loads the canon
npm run dev          # http://localhost:4321
```

The seed is idempotent and safe to re-run after editing `src/seed/content.ts`.

Key env vars (see `.env.example`): `DATABASE_URL` + `DATABASE_AUTH_TOKEN` (Turso),
`RESEND_API_KEY`, `CRON_SECRET`, `SITE_URL`, `KEY_ENCRYPTION_SECRET` (BYOK),
`GROQ_API_KEY` / `OPENROUTER_API_KEY` (house AI keys, free-tier only).

## Deploying

Stateless container, Turso holds all data — no volume needed:

- Build: `npm run build` · Start: `node ./dist/server/entry.mjs` (respects `$PORT`)
- Set the env vars above, point `SITE_URL` at the public domain
- Schedulers hit `POST /api/cron/digest` (weekly) and `POST /api/cron/revisions` (daily) with `Authorization: Bearer $CRON_SECRET` — or use the workflows in `.github/workflows/`

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run preview` | Serve the production build |
| `npm run check` | `astro check` + typecheck |
| `npm run lint:design` | Fails the build on banned visual patterns (see below) |
| `npm run verify` | Design lint, typecheck and anchor tests |
| `npm run test:anchors` | Anchor resolution cases (exact / moved / lost) |
| `npm run test:anchor-survival` | End-to-end proof that a note survives a rewrite |
| `npm run test:annotations` | Marginalia invariants, publication scope, and a rehearsal of migration 0020 |
| `npm run test:migration` | The 0020 rehearsal alone: a pre-0020 schema, six planted reactions, the real migration |
| `npm run test:sandbox` | Sandbox invariants for runnable code blocks (see `docs/threat-model-sandbox.md`) |
| `npm run test:smoke` | 32 routes against the built server |
| `npm run perf:budget` | Fails if external client JS exceeds 40 KB (currently 0) |
| `npm run db:seed` / `db:reset` | Wipe and rebuild the database |
| `npm run db:generate` | Generate a Drizzle migration from the schema |

`npm run test:smoke` builds nothing and assumes `npm run build` has run; point
it at an already-running server with `BASE_URL=http://localhost:4321`.

### Checks that need a browser

Two checks cannot run in CI, because CI has no browser and both features are
only meaningful against a real engine. Start a browser with
`msedge --remote-debugging-port=9222 --user-data-dir=%TEMP%/strata-cdp`, run
`npm run dev`, then:

| Command | What it proves |
| --- | --- |
| `npm run test:sandbox:browser` | The snippet sandbox in a real browser: opaque origin, no network egress — judged from the browser's own network log, because a refused fetch and a CORS failure look identical from inside the page — and a busy loop killed without wedging the tab |
| `npm run test:passkeys:browser` | The whole WebAuthn ceremony against Chromium's virtual authenticator: enrolment through the real button, sign-in, a signature counter above 2^31, replay, clone detection, and that refusals do not distinguish an unknown credential from a forged one |

`test:passkeys:browser` needs a hostname rather than an IP address: WebAuthn
refuses an IP as a relying-party ID, so passkeys cannot work on
`http://127.0.0.1:4321` at all. It writes to `data/strata.db` and cleans up after
itself.

## Continuous integration

`.github/workflows/ci.yml` runs the same checks in the same order on every push
and pull request: design lint, typecheck, anchor tests, build, performance
budget, seed, then the route smoke test against the built server.

## Design constraints

Not enforced by taste — enforced by `npm run lint:design`, which fails on:

- `gradient()`, `backdrop-filter`, `text-shadow`, glow, `box-shadow` with blur > 8px
- `border-radius` ≥ 12px, pill shapes
- `transition: all`, `will-change` on non-compositing properties
- AI-purple hues
- interactive elements without a `:focus-visible` style
- data-driven components missing an empty, loading or error state

The visual thesis is typography-first editorial: ink on paper, 1px hairlines, one accent,
no elevation, no gloss. Reference points in PLAN.md §2.

## Content model

A post body is a **typed block document**, not Markdown. This is what makes stable
annotation anchors, author-declared depth layers, semantic diffs and per-block comprehension
telemetry possible. `src/lib/blocks.ts` owns the schema; `src/seed/build.ts` is the authoring
DSL used by the seed content.

## Privacy

No third-party analytics scripts, no ad-tech cookies, no fingerprinting. Reading telemetry is
first-party and aggregate-only, and is never surfaced to a writer for cohorts under 20 readers.
`/privacy#forget` erases an anonymous reader's entire history on request.

## Thesis and roadmap

See [PLAN.md](./PLAN.md) for the product thesis, the data model, the benchmark
methodology, the roadmap and the explicit kill-criteria.
