/**
 * Strata data model.
 *
 * Two load-bearing decisions:
 *  1. A post body is a *typed block document* (JSON), not Markdown. This is what
 *     makes stable annotation anchors, per-block depth layers, semantic diffs
 *     and per-block comprehension telemetry possible.
 *  2. Annotation anchors store quote + surrounding context, not a bare character
 *     offset, and every annotation is pinned to the version it was written
 *     against. A bare offset breaks on the first edit.
 *
 * SQLite via libsql so the app runs with zero external configuration. Dialect is
 * kept deliberately plain so the port to Postgres is mechanical.
 */

import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const now = sql`(unixepoch() * 1000)`;

/* -------------------------------------------------------------------------- */
/* Identity                                                                    */
/* -------------------------------------------------------------------------- */

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    handle: text('handle').notNull(),
    displayName: text('display_name').notNull(),
    bio: text('bio').notNull().default(''),
    avatarUrl: text('avatar_url'),
    role: text('role', { enum: ['reader', 'author', 'editor'] })
      .notNull()
      .default('reader'),
    toneVector: text('tone_vector'),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [uniqueIndex('users_email_uq').on(t.email), uniqueIndex('users_handle_uq').on(t.handle)],
);

export const sessions = sqliteTable(
  'sessions',
  {
    token: text('token').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull().default(now),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const readerProfiles = sqliteTable('reader_profiles', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  depthPreference: text('depth_preference', { enum: ['skim', 'understand', 'master'] })
    .notNull()
    .default('understand'),
  explanationLevel: text('explanation_level', { enum: ['off', 'inline', 'full'] })
    .notNull()
    .default('inline'),
  density: text('density', { enum: ['comfortable', 'compact', 'roomy'] })
    .notNull()
    .default('comfortable'),
  createdAt: integer('created_at').notNull().default(now),
});

/**
 * Handle claims. Anonymous-first means a reader can write notes before having
 * an identity, so claiming a handle is a deferred, out-of-band step: the reader
 * asks for a handle, gets a single-use token, and the token is redeemed later
 * to create the account and backfill every note written from that browser.
 *
 * There is no password anywhere in this table or in `users`. A handle is
 * something you claim and can lose; it is not a credential.
 */
export const handleClaims = sqliteTable(
  'handle_claims',
  {
    id: text('id').primaryKey(),
    handle: text('handle').notNull(),
    email: text('email').notNull(),
    /** The browser that asked, so notes can be attached on redemption. */
    anonId: text('anon_id').notNull(),
    token: text('token').notNull(),
    expiresAt: integer('expires_at').notNull(),
    redeemedAt: integer('redeemed_at'),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [
    uniqueIndex('handle_claims_token_uq').on(t.token),
    index('handle_claims_anon_idx').on(t.anonId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Posts                                                                       */
/* -------------------------------------------------------------------------- */

export const posts = sqliteTable(
  'posts',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    dek: text('dek').notNull().default(''),
    authorId: text('author_id')
      .notNull()
      .references(() => users.id),
    status: text('status', { enum: ['seedling', 'budding', 'evergreen', 'archived'] })
      .notNull()
      .default('seedling'),
    visibility: text('visibility', { enum: ['public', 'unlisted', 'private'] })
      .notNull()
      .default('public'),
    currentVersionId: text('current_version_id'),
    publishedAt: integer('published_at'),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
    lastReviewedAt: integer('last_reviewed_at'),
    topicId: text('topic_id'),
    seriesId: text('series_id'),
    coverImage: text('cover_image'),
    seoDescription: text('seo_description').notNull().default(''),
    forkedFromId: text('forked_from_id'),
    /** Denormalised: number of annotated spans currently attached. */
    annotationCount: integer('annotation_count').notNull().default(0),
    viewCount: integer('view_count').notNull().default(0),
    /** Work-in-progress {title, dek, blocks} JSON. Written on save, cleared on
     *  publish, never rendered to readers. */
    draftBody: text('draft_body'),
  },
  (t) => [
    uniqueIndex('posts_slug_uq').on(t.slug),
    index('posts_author_idx').on(t.authorId),
    index('posts_status_published_idx').on(t.status, t.publishedAt),
    index('posts_topic_idx').on(t.topicId),
  ],
);

export const postVersions = sqliteTable(
  'post_versions',
  {
    id: text('id').primaryKey(),
    postId: text('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    /** Typed block document, JSON. Never Markdown. */
    body: text('body').notNull(),
    changeSummary: text('change_summary').notNull().default(''),
    authorId: text('author_id')
      .notNull()
      .references(() => users.id),
    createdAt: integer('created_at').notNull().default(now),
    isMajor: integer('is_major', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [
    uniqueIndex('post_versions_n_uq').on(t.postId, t.versionNumber),
    index('post_versions_post_idx').on(t.postId),
  ],
);

/** Materialised per-version blocks. `blockId` is stable across revisions, which
 *  is what makes annotations survive an edit. */
export const blocks = sqliteTable(
  'blocks',
  {
    id: text('id').primaryKey(),
    postId: text('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    versionId: text('version_id')
      .notNull()
      .references(() => postVersions.id, { onDelete: 'cascade' }),
    blockId: text('block_id').notNull(),
    ordinal: integer('ordinal').notNull(),
    type: text('type').notNull(),
    layer: text('layer', { enum: ['core', 'understand', 'master'] })
      .notNull()
      .default('core'),
    /** Plain text projection, for search, diffs and retrieval. */
    text: text('text').notNull().default(''),
    headingPath: text('heading_path').notNull().default(''),
    wordCount: integer('word_count').notNull().default(0),
  },
  (t) => [
    index('blocks_version_ordinal_idx').on(t.versionId, t.ordinal),
    index('blocks_block_idx').on(t.postId, t.blockId),
  ],
);

export const postLinks = sqliteTable(
  'post_links',
  {
    fromPostId: text('from_post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    toPostId: text('to_post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    type: text('type', {
      enum: ['cites', 'extends', 'contradicts', 'fork_of', 'mentions'],
    }).notNull(),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [
    primaryKey({ columns: [t.fromPostId, t.toPostId, t.type] }),
    index('post_links_to_idx').on(t.toPostId),
  ],
);

export const topics = sqliteTable('topics', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  blurb: text('blurb').notNull().default(''),
});

export const series = sqliteTable('series', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  blurb: text('blurb').notNull().default(''),
});

/* -------------------------------------------------------------------------- */
/* Marginalia                                                                  */
/* -------------------------------------------------------------------------- */

export const ANNOTATION_KINDS = [
  'comment',
  'correction',
  'extension',
  'disagreement',
  'worked_example',
  'update',
  'author_note',
] as const;
export type AnnotationKind = (typeof ANNOTATION_KINDS)[number];

/** Kinds only the post's author may write. These render in a distinct channel. */
export const AUTHOR_ONLY_KINDS: readonly AnnotationKind[] = ['author_note'];

export const annotations = sqliteTable(
  'annotations',
  {
    id: text('id').primaryKey(),
    postId: text('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    /** Version this note was written against. Notes never silently re-attach. */
    versionId: text('version_id')
      .notNull()
      .references(() => postVersions.id, { onDelete: 'cascade' }),
    blockId: text('block_id').notNull(),
    /**
     * Hypothes.is-style selector. `quote` plus `prefix`/`suffix` context so the
     * anchor can be re-found after later edits. Storing only start/end offsets
     * is the naive approach and breaks on the first revision.
     */
    anchor: text('anchor').notNull(),
    body: text('body').notNull(),
    kind: text('kind', { enum: ANNOTATION_KINDS }).notNull().default('comment'),
    parentId: text('parent_id'),
    /**
     * Anonymous-first. A note exists before anyone has an account — that is the
     * whole point of the reading loop — so both of these are nullable and at
     * least one is always set. A claimed note keeps its anonId so that claiming
     * can backfill rather than orphan.
     */
    authorId: text('author_id').references(() => users.id, { onDelete: 'set null' }),
    anonId: text('anon_id'),
    /** Pseudonym a reader typed for themselves. Used until they claim a handle. */
    guestName: text('guest_name'),
    status: text('status', { enum: ['visible', 'hidden', 'deleted'] })
      .notNull()
      .default('visible'),
    /** Author accepted this note and folded it into the post's history. */
    isAccepted: integer('is_accepted', { mode: 'boolean' }).notNull().default(false),
    isResolved: integer('is_resolved', { mode: 'boolean' }).notNull().default(false),
    isPrivate: integer('is_private', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull().default(now),
    editedAt: integer('edited_at'),
  },
  (t) => [
    index('annotations_post_idx').on(t.postId, t.status),
    index('annotations_block_idx').on(t.postId, t.blockId),
    index('annotations_version_idx').on(t.versionId),
    index('annotations_parent_idx').on(t.parentId),
    index('annotations_anon_idx').on(t.anonId),
  ],
);

export const annotationReactions = sqliteTable(
  'annotation_reactions',
  {
    annotationId: text('annotation_id')
      .notNull()
      .references(() => annotations.id, { onDelete: 'cascade' }),
    /** Who reacted: a claimed user id, or an anonymous browser id.
     *
     *  Deliberately *not* a foreign key. The reaction keys used to point at
     *  `users.id`, which meant a reader who had never claimed a handle could not
     *  react at all — a hard contradiction of the one rule this product has:
     *  arguing in the margin never asks for an account. */
    voterKey: text('voter_key').notNull(),
    kind: text('kind', { enum: ['useful', 'insightful', 'source'] }).notNull(),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.annotationId, t.voterKey, t.kind] })],
);

export const annotationReports = sqliteTable(
  'annotation_reports',
  {
    id: text('id').primaryKey(),
    annotationId: text('annotation_id')
      .notNull()
      .references(() => annotations.id, { onDelete: 'cascade' }),
    reporterKey: text('reporter_key').notNull(),
    reason: text('reason').notNull(),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [index('annotation_reports_note_idx').on(t.annotationId)],
);

/* -------------------------------------------------------------------------- */
/* Reader memory                                                               */
/* -------------------------------------------------------------------------- */

export const highlights = sqliteTable(
  'highlights',
  {
    id: text('id').primaryKey(),
    postId: text('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    blockId: text('block_id').notNull(),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    anonId: text('anon_id'),
    text: text('text').notNull(),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [index('highlights_post_idx').on(t.postId)],
);

/** First-party, aggregate-only telemetry. No third-party analytics anywhere.
 *  No individual reader is ever surfaced to a writer. */
export const readEvents = sqliteTable(
  'read_events',
  {
    id: text('id').primaryKey(),
    postId: text('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    blockId: text('block_id'),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    anonId: text('anon_id'),
    event: text('event', {
      enum: ['impression', 'dwell', 'reached', 'highlight', 'ask', 'rewind'],
    }).notNull(),
    dwellMs: integer('dwell_ms'),
    positionRatio: integer('position_ratio'),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [
    index('read_events_post_idx').on(t.postId, t.event),
    index('read_events_post_created_idx').on(t.postId, t.createdAt),
    index('read_events_block_idx').on(t.postId, t.blockId),
  ],
);

/** The last version a reader actually saw. Powers "changed since you were here". */
export const readReceipts = sqliteTable(
  'read_receipts',
  {
    id: text('id').primaryKey(),
    postId: text('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    anonId: text('anon_id'),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    versionId: text('version_id')
      .notNull()
      .references(() => postVersions.id),
    readAt: integer('read_at').notNull().default(now),
  },
  (t) => [index('read_receipts_lookup_idx').on(t.postId, t.anonId)],
);

/* -------------------------------------------------------------------------- */
/* Ask this article — grounded Q&A with in-article citations                   */
/* -------------------------------------------------------------------------- */

export const asks = sqliteTable(
  'asks',
  {
    id: text('id').primaryKey(),
    postId: text('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    versionId: text('version_id')
      .notNull()
      .references(() => postVersions.id, { onDelete: 'cascade' }),
    /** Optional paragraph scope. Null = whole post. */
    blockId: text('block_id'),
    question: text('question').notNull(),
    answer: text('answer').notNull(),
    /** Array of { blockId, quote } — always resolves to this post's blocks. */
    citations: text('citations').notNull().default('[]'),
    /** 'extractive' = offline lexical answer; 'model' = LLM answer. Both grounded. */
    mode: text('mode', { enum: ['extractive', 'model'] }).notNull().default('extractive'),
    latencyMs: integer('latency_ms'),
    askedById: text('asked_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [index('asks_post_idx').on(t.postId), index('asks_block_idx').on(t.postId, t.blockId)],
);

/**
 * Per-author model budget and circuit breaker, §4.5's cost boundary.
 *
 * A public reader-facing feature that calls a paid model is a money risk
 * dressed as a feature, so the boundary is enforced in the database, not in
 * process memory: a restart cannot reset it, and two instances cannot each
 * decide they are the first to spend. `windowStart` is a day bucket;
 * `consecutiveFailures` trips the breaker so one bad upstream stops costing
 * money on every request.
 */
export const askModelBudgets = sqliteTable(
  'ask_model_budgets',
  {
    postId: text('post_id')
      .primaryKey()
      .references(() => posts.id, { onDelete: 'cascade' }),
    /** Day bucket, ms since epoch — caps are per day, per author. */
    windowStart: integer('window_start').notNull(),
    calls: integer('calls').notNull().default(0),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    /** Epoch ms until which the breaker is open. Null = closed. */
    openUntil: integer('open_until'),
    updatedAt: integer('updated_at').notNull().default(now),
  },
  (t) => [index('ask_budget_window_idx').on(t.windowStart)],
);

/* -------------------------------------------------------------------------- */
/* Curation — the primary discovery unit                                        */
/* -------------------------------------------------------------------------- */

export const readingLists = sqliteTable('reading_lists', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  isPublic: integer('is_public', { mode: 'boolean' }).notNull().default(true),
  /** Unguessable `?key=` access for private lists. Null = no link issued. */
  shareToken: text('share_token'),
  createdAt: integer('created_at').notNull().default(now),
});

export const readingListItems = sqliteTable(
  'reading_list_items',
  {
    id: text('id').primaryKey(),
    listId: text('list_id')
      .notNull()
      .references(() => readingLists.id, { onDelete: 'cascade' }),
    postId: text('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    /** "Read this before the third one" — why it's in the list. */
    note: text('note').notNull().default(''),
  },
  (t) => [index('reading_list_items_idx').on(t.listId, t.ordinal)],
);

/* -------------------------------------------------------------------------- */
/* Writer tooling                                                              */
/* -------------------------------------------------------------------------- */

export const captureItems = sqliteTable(
  'capture_items',
  {
    id: text('id').primaryKey(),
    authorId: text('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    source: text('source', {
      enum: ['share', 'voice', 'screenshot', 'scratchpad', 'clip'],
    })
      .notNull()
      .default('scratchpad'),
    state: text('state', { enum: ['inbox', 'seed', 'draft', 'discarded'] })
      .notNull()
      .default('inbox'),
    promotedPostId: text('promoted_post_id'),
    capturedAt: integer('captured_at').notNull().default(now),
  },
  (t) => [index('capture_items_author_idx').on(t.authorId, t.state)],
);

/** Revision subscription: get an email only when a major revision lands. */
export const revisionSubscriptions = sqliteTable(
  'revision_subscriptions',
  {
    id: text('id').primaryKey(),
    postId: text('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [uniqueIndex('revision_subscriptions_uq').on(t.postId, t.email)],
);

export const newsletterSubscribers = sqliteTable('newsletter_subscribers', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  createdAt: integer('created_at').notNull().default(now),
});

export const presenceHeartbeats = sqliteTable(
  'presence_heartbeats',
  {
    anonKey: text('anon_key').notNull(),
    postId: text('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    lastSeen: integer('last_seen').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.anonKey, t.postId] }),
    index('presence_post_idx').on(t.postId, t.lastSeen),
  ],
);

export const follows = sqliteTable(
  'follows',
  {
    /** `u:<userId>` or `a:<anonId>` — following never asks for an account. */
    followerKey: text('follower_key').notNull(),
    authorId: text('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.followerKey, t.authorId] })],
);

export const savedPosts = sqliteTable(
  'saved_posts',
  {
    /** `u:<userId>` or `a:<anonId>` — saving never asks for an account. */
    saverKey: text('saver_key').notNull(),
    postId: text('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [
    primaryKey({ columns: [t.saverKey, t.postId] }),
    index('saved_posts_post_idx').on(t.postId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export type User = typeof users.$inferSelect;
export type Post = typeof posts.$inferSelect;
export type PostVersion = typeof postVersions.$inferSelect;
export type Block = typeof blocks.$inferSelect;
export type Annotation = typeof annotations.$inferSelect;
export type Ask = typeof asks.$inferSelect;
export type ReadingList = typeof readingLists.$inferSelect;
export type ReadingListItem = typeof readingListItems.$inferSelect;
export type PostStatus = Post['status'];
