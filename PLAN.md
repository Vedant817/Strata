# Strata — Product & Launch Plan

> **Working name:** Strata (meaning: layers, sediment over time, the record of thinking accumulating).
> Alternatives if taken: Palimpsest, Cairn, Marginalia, Fathom, Longhand.
>
> **One-liner:** Posts that keep up with reality. Read at your depth. Leave notes in the margins.
>
> Status: in build. The reading spine, marginalia, discovery layer, identity,
> search, CI and performance budget are implemented and verified in a browser;
> Ask, Studio, import and launch flows are being built in that order. Anything
> below marked "deferred" is still deferred. Anything marked v1 that has no
> code yet is listed as remaining, not redescribed.

---

## 0. The thesis

Three things have been frozen since ~2004, and every one of them is a product decision, not a law of nature:

1. **The post is a file.** Written once, dated, abandoned. But the *world* it describes keeps moving, and
   so does the author's understanding of it. A 2019 post is now quietly wrong, and the format offers no
   way to fix it in place.
2. **The feed is chronological.** Which means the largest account wins and every long-tail writer is
   buried. Discovery was outsourced to an algorithm nobody in this product controls.
3. **The reader has no state.** Every visit starts at zero. The platform does not know what you know,
   what confused you, what you finished, or what you are trying to learn — so it cannot adapt.

**The thesis:** a post becomes a *layered, living, forkable document*; the reader gets *private memory*;
discovery becomes *human curation* instead of a black box. The compounding asset is **memory**, not
virality.

**Why this is a business, not a feature race:** virality is rented — the algorithm can change it
tomorrow. Reader state, an author's captured fragments, and a corpus of sentence-level notes are
**non-rival assets**. You cannot be disintermediated by someone else's feed change. That is the moat.

**The falsifiable prediction:** on this platform, a post published 12 months ago should be receiving a
meaningful share of its total reads. If post half-life does not improve over a conventional blog's,
the whole thesis is wrong and we should stop. This is tracked as a kill-criterion in §9.

---

## 1. Non-negotiables

### 1.1 The product refuses to have

Ads. Likes. Follower counts. Infinite scroll. "Trending." Engagement bait. Auto-generated filler posts.
A ranking the reader cannot inspect. If we cannot explain to a reader *why* this surfaced, it does not
surface. No dark patterns, no fake urgency, no "people are reading this right now" theatre.

### 1.2 The UI refuses to have

This is a hard constraint from day one, enforced in CI, not by discipline (§2.3). The visual thesis is
**typography-first editorial**: ink on paper, hairlines, whitespace, one accent, no elevation, no gloss.
Reference points: Tufte, Vignelli, newspaper grid, Are.na, Obsidian, 2500, Bloomberg Businessweek.

Banned outright:

- `gradient()` / `radial-gradient()` / conic gradients, anywhere, including on text
- `backdrop-filter`, glassmorphism, frosted panels
- `box-shadow` with blur > 8px; "glow"; `text-shadow`
- `border-radius` >= 12px, pill-shaped everything, `rounded-2xl/3xl/full`
- Tailwind `shadow-lg|xl|2xl`, `blur-*`, `bg-gradient-*`, drop-shadow filters
- Emoji as UI iconography
- Inter as the only typeface; hue families around `#6366F1` (the "AI purple")
- `transition: all`; springy/bouncy easing; scale-transform entrances; parallax
- Text below 4.5:1 contrast (we target AAA, 7:1, on body copy)
- `!important` outside the reset; `outline: none` without a replacement

### 1.3 Privacy as a product promise

No third-party analytics scripts. No ad-tech cookies. No fingerprinting. Reading telemetry is
first-party, aggregated, cohort-suppressed (never shown for cohorts < 20 readers), and never exposes an
individual reader to a writer. The pitch to writers is not "we will spy on your readers" but
"we will show you where readers *struggled*, in aggregate, and never who they were." This is both the
ethical position and the more interesting product.

---

## 2. Design system

### 2.1 Color

Two themes, both warm-neutral. No blue-grey "slate" ramp — that is the default look of every AI-era
dashboard and it is banned.

**Paper (light)**

| token | value | use |
| --- | --- | --- |
| `--bg` | `#FAF9F5` | page (warm off-white; pure `#FFF` causes halation on long reads) |
| `--surface` | `#FFFFFF` | raised blocks, code, figures |
| `--ink` | `#14120F` | body text |
| `--ink-2` | `#4A463F` | secondary text, captions |
| `--ink-3` | `#837D72` | metadata, timestamps |
| `--rule` | `#E2DED4` | hairlines, dividers |
| `--rule-strong` | `#C9C3B6` | table rules, input borders |
| `--accent` | `#A63A24` | links, active state, **one** correction rule per page max |

**Ink (dark)**

| token | value |
| --- | --- |
| `--bg` | `#100F0D` |
| `--surface` | `#171613` |
| `--ink` | `#EDE9E1` |
| `--ink-2` | `#A9A296` |
| `--ink-3` | `#726C61` |
| `--rule` | `#26241F` |
| `--accent` | `#D9694A` |

**Lifecycle badges** — muted natural pigments, never neon. One rule: never more than three semantic
colors on screen at once.

| state | token | value |
| --- | --- | --- |
| Seedling | `--moss` | `#6B7A5A` |
| Budding | `--ochre` | `#B08A2E` |
| Evergreen | `--pine` | `#3F5E4A` |

### 2.2 Type

Free, self-hosted, variable, and deliberately *not* Inter.

- **Body / reading:** IBM Plex Serif (400/500 + real italics), fallback `ui-serif`. Upgrade path to
  **Newsreader** (variable, optical sizing) if we want a more literary voice.
- **UI / chrome:** IBM Plex Sans (500/600). Small-caps metadata labels at `0.08em` tracking.
- **Code / data / metadata:** IBM Plex Mono.

The Plex superfamily is one coherent voice across serif/sans/mono, is free, and reads as engineered
rather than templated. Shipping one family is a design decision, not a compromise.

- Body 18px mobile → 20px desktop, `line-height: 1.65`
- Measure **68–72ch**, hard-max, centered on a 12-column grid with visible gutters
- Scale: 1.25 (major third) with `clamp()` on all heading steps
- No uppercase body text. No text smaller than 13px anywhere.

### 2.3 Space, surface, motion

- 4px base scale. Radius max **4px**; most surfaces use 0.
- **No elevation model.** Surfaces are separated by background tint and 1px rules, not shadows. There is
  no z-axis story, because there is no stack of floating panels.
- Dividers run the full column width, not the text measure — they are page furniture.
- Motion: 120–180ms, `cubic-bezier(0.2, 0, 0, 1)`, opacity + `translateY(<= 8px)` only. No scale, no
  spring, no bounce. `prefers-reduced-motion` → `0ms`, globally.
- Density is a reader setting (comfortable / compact) and must be honored by every component.

### 2.4 CI enforcement

`npm run lint:design` runs on every PR and fails the build on:

```
banned: gradient( | radial-gradient | conic-gradient | backdrop-filter | text-shadow
banned: box-shadow with blur > 8px
banned: border-radius >= 12px  |  border-radius: 9999px
banned: transition: all  |  will-change on non-compositing props
banned: tailwind shadow-lg|xl|2xl|inner  |  blur-*  |  bg-gradient-*  |  rounded-2xl|3xl
banned: hue range 230-290 for accent usage (AI purple)
missing focus-visible style on interactive element
missing empty / loading / error state on data-driven component
```

Plus a per-component definition-of-done checklist (cannot merge without):
focus ring · empty state · loading state · error state · 375px viewport · dark mode · 200% zoom ·
keyboard reachable · screen-reader label.

### 2.5 Performance budget (enforced in CI, Lighthouse gate)

Target: article page **< 100KB** total JS, **< 15KB** critical CSS. LCP < 1.5s on 4G, CLS < 0.02,
INP < 200ms. The article renders and is readable with **JS disabled** — the depth slider, marginalia
rail, and Ask panel are progressive enhancements layered on an already-complete document.

**The target is met, and it is met by deleting the framework rather than by shrinking it.** The article
page now ships **zero external client JS**. The three islands (Marginalia, the depth dial, the artifact
figures) were rewritten as plain DOM, and the `@astrojs/react` integration is removed from the build
entirely. What remains is a few hundred bytes of inline script — a selection listener, a form post, a
line that moves when the reader drags a slider — inlined into the HTML, so there is not even a second
request to make.

The honest accounting of why this was worth doing: React DOM cost 208KB to re-render a textarea and
move one `<line>` in an SVG. Marginalia was never doing layout that needed a framework — it moved a
handful of DOM nodes and posted a form — and the artifact figures were pure arithmetic over author
data, computed once on the server. Shipping a runtime for that was paying 208KB to reimplement
`addEventListener`. The enforced budget (`npm run perf:budget`, which fails the build) is now a
tripwire at 40KB rather than a ceiling, so reintroducing a framework — or any real dependency — lands a
multi-hundred-kilobyte chunk and fails immediately.

---

## 3. The data model is the product

Two load-bearing architectural decisions, made now, hard to reverse.

### 3.1 Posts are typed-block JSON, not Markdown

Markdown cannot host stable paragraph anchors, per-section depth layers, embedded interactive
components, or semantic diffs. So the canonical post body is a **typed block document** (JSON):

`paragraph · heading · code · math · table · figure · callout · interactive · list · quote · embed ·
margin-anchor · footnote`

Markdown remains the **import format**. MDX becomes a *component authoring surface* that compiles down
to typed blocks, not the storage layer.

This one decision unlocks: stable annotation anchoring (§4.2), author-declared depth layers (§4.1),
semantic diffs (§4.3), per-block comprehension telemetry (§5.1), and embedded runnable artifacts (§4.4).

### 3.2 Schema

Core reading:

- `users` — handle, display_name, bio, avatar, role, created_at
- `author_profiles` — user_id, verified_human, tone_vector, topic_ids
- `posts` — slug, title, dek, author_id, `status` (seedling|budding|evergreen|archived), visibility,
  `current_version_id`, published_at, topic_id, series_id, reading_minutes, cover, seo
- `post_versions` — post_id, version_number, `body_doc` jsonb, change_summary, author_id, created_at,
  is_major  *(diffs are computed from this; never stored)*
- `blocks` — materialized per version, `block_id` stable across revisions, anchors live here
- `post_links` — from_post, to_post, type: `cites|extends|contradicts|fork_of|mentions`  *(the graph
  is modeled in v1 even though the visualization is v5 — never retrofit a graph)*
- `forks` — fork_post_id, ancestor_post_id, depth  *(denormalized for O(1) lineage reads)*
- `depth_layers` — block_id, layer (skim|understand|master), author_annotated

Marginalia:

- `annotations` — post_id, `version_id`, `block_id`, `anchor` jsonb, body, kind, parent_id, author_id,
  status, created_at, edited_at, is_resolved
  - `anchor` = `{ blockId, start, end, quote, prefix, suffix }` — a Hypothes.is-style selector: the quote
    text plus surrounding context, so the anchor can be **re-anchored through future edits**. Storing only
    a character offset (the naive approach) breaks silently on the first edit. This is the single most
    commonly botched detail in every annotation product; we get it right from line one.
  - `kind` = `comment | correction | extension | disagreement | worked_example | update | author_note`
  - **Pinned to a version.** If the block changed, the note renders as *"This note is on an older
    revision"* with a link to read that revision in context. Notes never silently re-attach to different
    prose.
- `annotation_reactions` — kind: `useful|insightful|source` (courage reactions only; no applause)

Reader memory:

- `reader_profiles` — depth_preference, explanation_level, density, font_scale, reduced_motion
- `highlights` — post_id, block_id, user_id, text, created_at  *(drives hotspots + resurfacing)*
- `read_events` — post_id, anon_id, block_id, event, dwell_ms, position_ratio, created_at
  *(first-party; anon_id rotates on request; aggregates only, cohort >= 20)*
- `constellation_nodes` / `constellation_edges` — reader's inferred interests, built from reads, asks,
  and explicit follows
- `reads_later` · `collections` — reader curation

Ask (grounded):

- `asks` — post_id, block_id (scope), question, answer, `citations` jsonb, model, latency_ms, cost_cents
  `citations` always resolve to a block in *this* post. If the answer isn't supported by the post, the
  model is required to say so rather than import outside knowledge. That refusal is a feature.

Writer:

- `capture_items` — author_id, body, source (share|voice|screenshot|scratchpad), state
  (inbox|seed|draft|discarded), promoted_post_id, captured_at
- `voice_profiles` — author_id, tone_vector, drift_score, sample_size
- `staleness` — post_id, last_reviewed_at, drift_score, flagged_claim_count  *(drives "this post may be
  out of date" nudges for authors, and the evergreen-maintenance loop)*

Discovery & growth:

- `reading_lists` — owner_id, title, description, items (ordered), is_public, collaborators  *(the primary
  discovery unit)*
- `follows` · `webmentions` (v2) · `newsletter_subscribers` · `waitlist`

---

## 4. Pillar 1 — Living Layers (the reader's core experience)

The post is not a page. It is a layered, versioned, forkable artifact with a memory of how it changed.

### 4.1 The depth dial

One control, top of every post, persisted per reader. Not a gimmick — it solves the actual structural
problem of technical writing, where every author picks **one** altitude and alienates half the audience.

| Layer | Behavior |
| --- | --- |
| **Skim** | `understand` + `master` blocks collapse. Post renders at ~90s. TL;DR block expands. |
| **Understand** | Full linear argument. Prerequisites surface as inline primer cards. Jargon auto-links to a definition the first time, quietly, without a modal. |
| **Master** | All layers expand. Footnotes, source citations, the author's private margin notes, superseded claims, and runnable artifacts become visible. |

Author effort is one-time (tag blocks with a layer), and the payoff is that one post now serves three
different readers. The primer cards are generated once per post and cached, so the marginal cost per
reader approaches zero.

### 4.2 Revision history, inline diffs, and "changed since you were here"

- Every publish or substantive edit creates an immutable `post_version` with a required
  `change_summary` ("fixed the benchmark — was measuring p50 not p99").
- `?rev=12` renders any historical revision **in place**, with a per-block diff against the previous
  version. Insertions, deletions, and rewrites are visually distinguished by underline/strikethrough in
  `--ink-3` with a 2px `--accent` rule — no red/green diff coloring (that is IDE cosplay, not editorial).
- Returning readers get a **non-modal** banner: *"This post changed in 3 places since you read it"* →
  jumps straight to the first diff in context.
- Readers can **subscribe to a post** and get an email only when a `is_major` revision lands. Low
  frequency by design — this notification only fires because something genuinely changed.
- Every post carries a visible revision count and a transparent author-maintenance badge. This is our
  answer to AI slop: the proof of craft is the *record of revision*, visible and auditable.

### 4.3 Forks with lineage

Fork any post into your own version; the ancestor is credited permanently and the chain is traversable
in both directions. Use cases that justify the complexity: adding a regional perspective, translating,
extending with benchmarks, writing the rebuttal you wish existed, or carrying a thesis into a different
domain. The fork inherits `post_links` to the ancestor's citations so lineage compounds rather than
resets.

### 4.4 Explorable and executable artifacts (v1 read-side, v3 author-side)

Bret Victor's *Explorable Explanations* is the correct reference — parameters the reader can drag to
stress-test the author's argument, plus a *Run* affordance that answers "does this still hold?"

- v1 renders author-authored interactive components (chart with exposed controls, financial model,
  slider-driven simulation) inside the reading flow, lazy-hydrated, `client:visible`.
- v1.1 adds "Run this against my inputs" for code blocks — a client-side WebAssembly/JS sandbox in an
  `iframe` with a hard `sandbox` attribute, no network, no `allow-same-origin`. Security surface is
  real; it is feature-flagged and off until it has a threat model.
- v3 opens authoring: authors fork the component, change the model, publish their variant. The artifact
  becomes part of the post's revision history like any other block.

### 4.5 "Ask this article"

Select a paragraph → ask → get an answer **grounded only in that post**, with clickable citations into
specific blocks. Out-of-scope questions get *"This isn't covered in the article"* rather than an
imported opinion. Runs in a Supabase Edge Function with per-author daily cost caps; the model is
swappable behind an interface.

The design win is that "I don't get it" stops being a silent exit and becomes a *query against the
article*. Each Ask is also a **confusion signal** feeding §5.1 — the questions readers had to ask become
the writer's to-do list. Asking improves the article for everyone.

---

## 5. Pillar 2 — Marginalia (shared)

Discourse moves from a 3,000-pixel graveyard to the margin rail, typed, threaded, and versioned.

- Select any span → leave a note. Six kinds, each with distinct visual treatment and ordering:
  `correction` · `extension` · `disagreement` · `worked_example` · `update` · `comment`.
- **Author-only margin notes** are a first-class, visually distinct channel: *"I spent three weeks
  convinced this was true — it wasn't."* Reader-visible process, not a hidden thought log. This is a
  differentiator no one else ships and it is a large part of the "proof of human craft" story.
- Sort modes: `top` / `newest` / `contested` / `author-only`.
- Correction notes can be **accepted by the author**, which promotes them into the post's revision
  history as an attributed amendment. The reader becomes a co-author of the record.
- Private notes are visible only to the reader and never surfaced to writers.
- **Live presence:** anonymous count ("3 people are reading this right now") and shared live highlights,
  via Supabase Realtime. Ambient, not a social network — no profiles, no followers, no DMs.
- Every note is deep-linkable and shareable. **A single margin note is the share unit**, which is a much
  better viral atom than a link to a post.

**The long-term payoff:** a year of typed, sentence-anchored, versioned notes across a publication is a
*searchable corpus of human disagreement*. "What did people say about X across 400 posts?" is a question
no static site can answer and no comment section can be mined for. That corpus is the defensible asset.

---

## 6. Pillar 3 — The Garden (publishing model)

**Lifecycle states**, replacing the pressure to ship finished masterpieces:

- 🌱 **Seedling** — a raw thought. Rough, short, honest, marked unpolished. Lowering the cost of
  publishing something half-formed is how you get a body of work that starts before it is ready.
- 🌿 **Budding** — an argument with references. Claims attached to sources.
- 🌲 **Evergreen** — a pillar piece, **actively maintained**, with a review cadence. Requires a named
  `maintainer` (default: the author) and a staleness score.

Every post is a **seedling from day one** and can graduate. A graduate becomes a durable surface: the
publishing incentive is *maintaining and connecting* posts, not chasing publication volume. That
inverts the whole medium's incentive structure.

**Staleness is a feature, not a bug.** We surface "this post hasn't been reviewed in 14 months" to
readers (honest) and prompt the author (actionable). A post aging visibly is a *nudge*, never a
shame badge.

**Constellations** replace the chronological feed:

- The graph is modeled in v1 (`post_links`), visualized in v5.
- Visualization choice is deliberate: **not** a force-directed hairball. A hairball is the generic, lazy,
  unreadable answer, and it looks like every AI-generated "knowledge graph" ever shipped. We use an
  **arc diagram** on a spine (posts as nodes on a vertical timeline, links as arcs) — honest about time,
  readable at a glance, and typographically at home with the rest of the design. Nodes are labeled text,
  not colored dots.
- Every post is fully usable as a standalone URL. The graph is context, never a gate.

---

## 7. Pillar 4 — Empathy Analytics (writer product)

Not "how many clicks." **Where did readers think, and where did thinking break?**

Shipped in v1 (coarse, honest):

- **Section-level depth:** where readers reach, where they finish, where they leave.
- **Highlight hotspots:** which sentences got highlighted most, across all readers.
- **Confusion signals:** which blocks drew repeated Asks, rewinds, and re-reads.
- **"Am I losing them here?"** — a single, honest, per-section drop-off curve.

Deliberately **not** shipped: individual scroll-tracking heatmaps. They are creepy, frequently
inaccurate, and they point the writer at the wrong problem. Comprehension is a better signal than
eyeballs, and it is the one that aligns incentives.

**Draft Autopsy** (v3) — diagnostics with teeth, all specific and actionable:

- *"Paragraph 3 introduces `p99 latency` without definition. 22% of readers ask about it."*
- *"Your conclusion restates your introduction."*
- *"Section 2 is 2× longer than the rest of the post and 60% of readers skip it."*

**Co-Thinking Studio** (v1 lean → v3 full):

- **v1:** capture inbox (<5s from anywhere: share sheet, keyboard shortcut, screenshot OCR, voice memo →
  transcript), weekly synthesis that turns fragments into drafts, citation-presence linting, a
  counter-argument prompt, and a voice-fingerprint drift check.
- **v3:** argument stress-tester, audience simulator ("where does the 8-year-old drop off?"), and
  multi-format synthesis (visual breakdown, thread outline, flashcards).

**Capture is the real bottleneck.** Writing apps optimize publishing; almost none solve *noticing*. The
5-second capture and weekly synthesis is where a blogging app can genuinely beat a blank page.

**Monetization that doesn't kill the graph — supplement gating.** The core post stays free and complete.
What can be gated: raw notebooks, extended cuts, the actual dataset, the unedited draft, the audio
walkthrough. Authors get paid without ever showing a reader a wall — which is precisely how Medium
destroyed its own network effect. Tipping and subscriptions sit on top, never in front.

---

## 8. Scope: the honest cut

Everything in the original brainstorm is not v1. A half-built feature is worse than an absent one.

**In v1 (the proving set — enough to be a real product):**

Status as built. ✓ means shipped and verified in a browser; ◐ means shipped
coherently but not the whole ambition; ○ means not built.

1. Living Layers: depth dial + per-block layer tags — **✓**
2. Revision history, inline diffs, "changed since your last visit" — **✓**
   (revision *subscription* is ○ — the table exists, no sending job)
3. Marginalia: typed, version-pinned, threaded, author-only notes — **✓**
   plus reactions (anonymous-capable), edit, delete, author accept, four sort
   modes, private notes, reports, and one-level replies
4. "Ask this article" with in-article citations — **◐** extractive and fully
   grounded, offline, and every question logged as a confusion signal; no model
   attached, so it quotes rather than answers
5. Garden lifecycle states + staleness — **✓** including authoring: review,
   graduate, link, fork with inherited lineage
6. Empathy analytics v1 — **◐** per-block reach is collected and the
   confusion signal is real; the writer-facing drop-off view is ○
7. Co-Thinking v1 — **◐** capture inbox and promotion to seedling are real;
   weekly synthesis, citation lint and voice drift are ○
8. **Forks with lineage** — **✓** (the data model arrived in v1, as planned;
   the UI did not have to wait)

**Explicitly deferred:**

| Feature | Why deferred | Target |
| --- | --- | --- |
| Executable code sandboxes | Real security surface, needs a threat model | v1.1, feature-flagged |
| Author-side interactive artifact builder | Largest single build cost in the whole product | v3 |
| Force-graph / any graph viz | v5 (arc diagram), graph *model* in v1 | v5 |
| Audio overviews / dual-host podcasts | Quality risk, cost per post, and a solved-problem trap | not planned |
| Webmentions / fediverse | Distribution, not product; needs a live corpus first | v2 |
| Multi-format synthesis | Nice, not differentiating | v3 |
| Full argument stress-tester | Expensive, quality-sensitive | v3 |
| Subscriber comments at publication level | Only after a real community exists | v2 |

---

## 9. Engineering plan

### 9.1 Stack

Astro is the right call — the "HTML-first, islands-only" model is exactly right for a reading
product, because it makes the "fully readable with JS disabled" budget structurally achievable.

- **Astro 4 → current**, `output: 'server'`, **`@astrojs/node`** standalone adapter (portable; deploy
  target-agnostic). Cloudflare/Vercel are a config swap, not a rewrite.
- **No client framework.** The interactive surface (depth dial, marginalia rail, artifact figures) is
  plain DOM and a few hundred bytes of inline script, and `@astrojs/react` is removed from the build.
  Everything else is static Astro — including the note interactions, which are ordinary form posts
  specifically so they work with JavaScript off. Result: **0KB external client JS** on the article page.
- **DB + auth:** the plan called for **Supabase** — Postgres, Auth, Realtime, Edge Functions. The build
  uses **SQLite via libsql** instead, with handle-claim tokens rather than magic links. This is a
  deliberate deviation, and it has costs worth recording: no RLS, so tenancy rules live in application
  code; no Realtime, so §5's live presence is not buildable as written; no `pgvector`, so Ask retrieval is
  lexical FTS rather than embedding-based. Migrations and the local file make a deploy a config change
  (`DATABASE_URL`), and Turso/libsql is the intended hosted target.
- **ORM:** Drizzle (typed, SQL-transparent, plays well with RLS).
- **Retrieval:** SQLite **FTS5** with porter stemming, two indexes: `post_fts` for search and
  `block_fts` for Ask. Block scope is what makes Ask's grounding promise structural rather than a
  convention — the post id is inside every query's filter.
- **AI:** none attached. Ask is extractive, so the "grounded or refuse" guarantee holds without a model
  and costs nothing. When a model arrives it answers *from the retrieved passages*, behind the
  per-author caps.
- **Telemetry:** first-party `read_events` in SQLite. No third-party analytics, by policy.
- **Deploy:** Node standalone on Render (fits the existing setup). Preview deploys per PR.

### 9.2 Phase 0 — Foundation (Weeks 1–2)

Non-negotiable cleanup of the existing scaffold, then the design system.

- Drop the CDN Tailwind v2 link; add `src/styles/global.css` with the `@tailwind` directives the
  installed integration is currently doing nothing with. Remove Flowbite.
- `Layout.astro` (there is currently no shared layout — only `index.astro` has a `<head>`).
- Fix all broken links: every nav/card link points at `.html` paths including a non-existent
  `article.html`. Add a real 404.
- Design tokens as CSS custom properties, both themes, `color-scheme` wired.
- Typography: self-host Plex Serif/Sans/Mono variable subsets, `font-display: swap`, preload the two
  weights used above the fold.
- `npm run lint:design` + the component definition-of-done checklist.
- Content collections + the typed-block JSON schema with Zod, plus a Markdown/MDX importer.
- CI: typecheck, build, Lighthouse budget gate, design lint.
- Delete or archive the ~5.5MB of unreferenced committed images.

**Exit criteria:** a design-system reference page rendering every primitive in both themes at 375px
and 200% zoom; one imported post rendering at all three depths; CI green.

### 9.3 Phase 1 — The Reading Spine (Weeks 3–6)

**This phase alone is a shippable, non-generic blog.** If we stop here we have something worth using.

- Article page, three depths, all state on the article rendering correctly server-side
- `post_versions` + inline diff view + `?rev=`
- "Changed since your last visit" (anonymous `anon_id` cookie; explicit "forget my reading history")
- Lifecycle states, per-block layer tags, primer cards
- RSS (full + per-author + per-topic), sitemap, robots, canonical URLs, OG/Twitter cards, JSON-LD
  (`Article`, `Person`, `dateModified` — real value to LLM citation)
- Email capture, reading lists, tags/topics/series navigation
- Edge-cached, `stale-while-revalidate` for public reads

**Exit criteria:** Lighthouse ≥ 95 on the article template; 100KB JS budget met; a 2021 post that has
been revised three times shows an accurate, clickable, in-context diff.

### 9.4 Phase 2 — Marginalia (Weeks 7–10)

Supabase Auth (invite-first) · RLS policies · annotation schema with **re-anchoring** and
**version pinning** · selection UI · six kinds · threading · accepted-correction → amendment flow ·
author-only notes · deep-linkable note permalinks · Supabase Realtime presence + live highlights ·
moderation (report, hide, author mute) · notifications (mention, accepted correction, reply).

**Exit criteria:** annotate a sentence, edit that sentence in a new version, publish — the note
correctly reports "on an older revision" and links to that revision. Anchor survives 50 edits. This is
the acceptance test that separates a real annotation system from a toy.

### 9.5 Phase 3 — Ask This Article (Weeks 11–13)

Block-scoped retrieval (embeddings per block, not per post) · grounded answering with mandatory
citations · explicit "not covered in this article" · per-author cost caps + global budget circuit
breaker · abuse limits (rate limit, no public generation, no cross-post leakage in responses) ·
writer-facing confusion dashboard fed by asks.

**Exit criteria:** 50 adversarial questions, zero ungrounded answers, every citation resolving to a
real block.

### 9.6 Phase 4 — Writer Studio (Weeks 14–18)

Block editor with drag ordering and per-block depth tags · capture inbox (share target, shortcut,
OCR, voice) · weekly synthesis job · revision publishing with required change summary · staleness
dashboard · empathy analytics v1 · voice fingerprint · citation lint · MDX component authoring.

**Exit criteria:** capture a thought in under 5 seconds from a phone, and have it become a draft
without a human retyping it.

### 9.7 Phase 5 — Garden & Constellations (Weeks 19–22)

Author pages · topic/series pages · `post_links` authoring UI (cites/extends/contradicts) · arc-diagram
view · back-catalog linking tool ("this post's ancestor is…") · fork UI with lineage traversal ·
reader constellation (inferred interests, explicit follows) · the weekly digest.

### 9.8 Risk register

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| **Too many half-features.** Every pillar is genuinely hard; doing five at 60% ships nothing. | High | The cut in §8 is binding. The wedge is depth-dial + diffs + marginalia. Sequence is enforced, not aspirational. |
| **Empty platform.** The classic open-platform death. | High | Single-writer-first. Curated publication, invites only, until demand is proven. See §10. |
| **Annotation anchors break on edit.** | High | Re-anchoring + version pinning from day one; explicit acceptance test in §9.4. |
| **Writers never revise.** The thesis depends on it. | Medium | Zero-friction revision, required change summary, staleness nudges, and a visible revision count as *social proof* rather than a badge. |
| **Ask costs spiral.** | Medium | Per-author daily caps, block-scoped retrieval to keep context small, circuit breaker, cache by (post_version, question). |
| **Design quality regresses under deadline.** | Medium | CI lint gate is not optional and not reviewable-by-eye. Automated bans, not taste arguments. |
| **Feature discoverability.** A depth slider nobody finds is a null feature. | Medium | Zero-modal first-visit prompt; every seed post uses every feature; a `?tour=` walkthrough; the share card itself demonstrates a diff. |
| **AI slop perception.** Being an "AI product" in a craft medium is a real reputational risk. | Medium | Positioning: AI is *grounded in your writing and only reachable from it*. "Proof of human craft" is the brand. Ask is scoped to one post by construction — it cannot write your blog for you. |

---

## 10. Launch

### 10.1 Positioning

- **For writers:** "The only blog platform where your best argument keeps earning — and where you can
  finally see where readers got lost."
- **For readers:** "Long-form that admits it's out of date, lets you set the depth, and lets you argue
  in the margin."
- **Deliberately not:** a Medium alternative, a Substack clone, a "creator monetization platform." Those
  are market positions, not theses.

### 10.2 Cold start: single-writer-first

Open multi-writer platforms die of emptiness. This launches as a **curated publication** — one
house voice, 2–3 invited writers — with the platform's features fully demonstrated by its own content,
and writers admitted by invite as demand proves out. Multi-tenant support is built in (RLS from day one)
but not marketed until it isn't empty.

### 10.3 Seed content: the canon (do not skip this)

**8–10 posts, each genuinely worth reading on its own merits, and each demonstrating a feature in
production.** A post that exists only to demo a feature reads as a demo and kills trust. So each post
must carry its feature invisibly: a post *about* database indexes should have a real interactive
explainer, three years of real revisions, and a genuinely interesting marginalia thread — none of it
announced as a feature.

Required coverage: one essay with a heavy revision history · one seedling that visibly grew into
evergreen · one piece with an interactive artifact · one with an author margin note that admits a
mistake · one fork lineage · one with a deep technical appendix behind the master depth layer.

**Pick the beat deliberately.** The format's advantage — depth, argument, maintained accuracy, real
technical artifacts — has to *beat* short-form social in a specific niche. Recommendation: **AI/ML and
systems engineering.** That audience is technical, high-signal, allergic to slop, already lives in
Markdown and git, and will adopt a depth dial, a diff view, and an interactive benchmark because the
features map onto tools they already trust. It is also a niche where "ask the article with citations" is
a feature, not a novelty.

### 10.4 Reader onboarding

The reader arrives on a **post** (from a share, a search, a link), not on a homepage. Optimize that
landing.

1. **First 30 seconds, non-modal:** one line — *"Set your depth →"* and *"Select any sentence to leave a
   note."* Never a modal, never a tour gate.
2. **After the first read:** three posts chosen to fit the reader's just-demonstrated state — one short,
   one long, one that shows a living diff. Depth and interest are learned from behavior, not a form.
3. **Depth dial is set once and honored forever**, on every post, in both themes.
4. **The return hook is the constellation digest,** not a feed. Weekly, opt-in, three posts with a
   human-written reason for each. No push notifications, no infinite scroll, no "you have 47 new posts."
5. **"Forget my reading history"** is a first-class link in the footer. Privacy you can exercise is
   privacy, and it is on-brand.

### 10.5 Writer onboarding

Switching cost is the archive, so import is step one and must be excellent: **Substack, Medium, Dev.to,
Hashnode, Ghost export, WordPress XML, Google Docs, plain Markdown folder.** Preserve original
publication dates and inbound links, then run an automatic first pass that adds layer tags, lifecycle
state, and a suggested changelog.

Guided "first loom" flow: take one existing post → make one revision → publish it → see the reader-facing
diff. The writer must *feel* the loop before we ask them to write a new post. Then: show them empathy
analytics on a real seed post, so the value is concrete rather than promised.

Recruit the first 10 writers from long-form technical Twitter/X and from projects with public changelogs
— people with a demonstrated maintenance habit, which is precisely the behavior we need to model.

### 10.6 Growth loops

- **The diff share card.** The share image for a post is *a real diff* with "changed 14 times since you
  read it." It is honest, novel, and far more click-worthy than a title card. This is the primary viral
  asset and it is a by-product of the thesis, not a bolt-on.
- **Margin notes are the share unit.** Deep-link a single note. Arguing with a specific sentence is a
  stronger social object than sharing a URL.
- **Fork lineage is a distribution channel.** A fork credits its ancestor permanently, and every fork is
  a new reader of the original.
- **Ask answers as citation cards** — they look like research, and they spread the article with them.
- **Weekly constellation digest** — email + RSS, opt-in only.
- **Zero paid acquisition.** If the thesis is right, the loop is retention and post half-life. Buying
  growth would test the wrong thing.

### 10.7 Channels

Hacker News (the living-diff post is the hook, not the launch), Lobsters, r/programming and
r/MachineLearning, specific technical Discords, and writers' own audiences. No Product Hunt — the
audience is wrong and it optimizes for the wrong metric.

### 10.8 Metrics

**North star: returning readers per post per month.** A post is a durable surface, not a unit of
consumption. Everything else is a diagnostic.

- **Post half-life** — share of a post's reads arriving ≥ 12 months after publication. *This is the
  thesis test.* Conventional blogs: near zero. If we are not beating that by a wide margin, the thesis
  failed.
- Annotations created per 100 reads (marginalia flywheel)
- Percentage of posts with ≥ 1 revision after publish (the maintenance flywheel)
- Ask rate and grounded-answer rate
- Reader return rate at 7/30 days
- Writer retention: authors active in month 3

**Explicit kill criteria, set now, before the data is flattering:**
1. Post half-life does not materially exceed a conventional baseline.
2. Fewer than 30% of published posts receive a post-publish revision within 60 days.
3. Marginalia annotation rate below 1 per 200 reads — the discourse loop is not forming.
4. Reader 30-day return below 20% — the memory is not compounding.

If (1) or (2) holds at month 6, the correct response is to stop and rebuild around the other pillar, not
to add features. Written down in advance so the decision is not made by sunk cost.

---

## 11. First two weeks, concretely

Week 1 — make the existing scaffold honest: remove CDN Tailwind and Flowbite, add `global.css`, build
`Layout.astro`, define the token layer for both themes, self-host Plex, fix every broken link, add a 404,
delete the unreferenced 5.5MB of images, install the Node adapter, wire CI. **No feature work until the
foundation is not embarrassing.**

Week 2 — the design system reference page (every primitive, both themes, 375px, 200% zoom) plus the
`lint:design` CI gate, the content collection and typed-block Zod schema, and the first imported post
rendering correctly at all three depths.

If both weeks go well, the project has a spine. Everything after that is compounding.

---

## Appendix — competitive frame

| | Substack / Medium | Ghost | Are.na / Obsidian | **Strata** |
| --- | --- | --- | --- | --- |
| Core unit | post | post | block | **layered versioned post** |
| After publishing | frozen | frozen | editable forever, no structure | **revision diffs, forks, staleness** |
| Reader state | none | none | local, private | **private memory + constellation** |
| Discourse | bottom comments, rots | comments | none | **typed, versioned marginalia** |
| Discovery | algorithmic feed | tags/search | manual | **human curation + arcs** |
| Writer feedback | email + views | views | none | **comprehension, not surveillance** |
| Craft signal | subscriber count | — | — | **visible revision history** |

**The wedge:** nothing else treats a post as something that should keep changing while keeping the
reader's understanding of it intact. Everyone else is choosing between "immutable and reliable" and
"editable and chaotic." The revision-pinned annotation anchor is the technical trick that makes both
true at once — and it is the thing that will be genuinely hard to copy well.
