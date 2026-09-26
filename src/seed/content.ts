/**
 * The canon.
 *
 * These are not demos. Each post has to be worth reading on its own merits and
 * carry its feature invisibly — a post that exists to demonstrate a feature
 * reads as a demo and destroys trust. So the cache post has a real interactive
 * artifact, three years of real revisions, and a genuine mistake in the margin
 * without any of it being announced as a feature.
 */

import {
  applyPatches,
  blockId,
  callout,
  code,
  doc,
  h2,
  h3,
  interactive,
  list,
  note,
  p,
  primer,
  quote,
  table,
  tldr,
} from './build';
import type { Block } from '../lib/blocks';

export interface SeedUser {
  id: string;
  email: string;
  handle: string;
  displayName: string;
  bio: string;
  role: 'reader' | 'author' | 'editor';
}

export interface SeedRevision {
  body: Block[];
  changeSummary: string;
  isMajor: boolean;
  /** Days before "now" that this revision was published. */
  daysAgo: number;
}

export interface SeedPost {
  slug: string;
  title: string;
  dek: string;
  status: 'seedling' | 'budding' | 'evergreen' | 'archived';
  topicSlug: string;
  seoDescription: string;
  publishedDaysAgo: number;
  revisions: SeedRevision[];
  links?: Array<{ toSlug: string; type: 'cites' | 'extends' | 'contradicts' | 'mentions' }>;
  forkedFromSlug?: string;
}

export const SEED_TOPICS = [
  { slug: 'systems', name: 'Systems', blurb: 'Things that break when they scale, and the shape of the breaking.' },
  { slug: 'ml', name: 'Machine Learning', blurb: 'Evaluation, retrieval, and the parts of ML that are engineering.' },
  { slug: 'craft', name: 'Craft', blurb: 'How the work gets done, and how we notice when it does not.' },
];

export const SEED_USERS: SeedUser[] = [
  {
    id: 'u_vedant',
    email: 'vedant@strata.pub',
    handle: 'vedant',
    displayName: 'Vedant',
    bio: 'Works on retrieval infrastructure. Writes about the parts of ML that turn out to be distributed systems problems.',
    role: 'author',
  },
  {
    id: 'u_mira',
    email: 'mira@strata.pub',
    handle: 'mira',
    displayName: 'Mira Okonkwo',
    bio: 'SRE. Maintains more services than she would like. Interested in what pages look like at 3am.',
    role: 'author',
  },
  {
    id: 'u_sam',
    email: 'sam@strata.pub',
    handle: 'sam',
    displayName: 'Sam Reyes',
    bio: 'Building eval harnesses. Suspicious of dashboards that only go up and to the right.',
    role: 'author',
  },
];

/* ========================================================================== */
/* 1. Cache invalidation — the flagship. Evergreen, four revisions, one of
   which corrects a real error, with an explorable artifact in the middle.    */
/* ========================================================================== */

const cacheV1 = doc(
  tldr(
    'Once your cache is shared across machines, invalidation stops being a function call and becomes a consensus problem. The TTL is no longer a correctness mechanism, it is a probability distribution.',
  ),
  p(
    'Every team I have joined has had a cache, and every team has eventually been surprised by it. The surprise is always the same shape: something was correct, then it was not, and nothing in the logs said why.',
  ),
  h2('The single-machine version'),
  p(
    'On one machine, cache invalidation is a function call and you can stop thinking about it. You hold a reference to the map, you call `delete`, and the next reader either sees the new value or blocks until it is written. There is a happens-before edge and it is obvious.',
  ),
  code(
    'ts',
    `class LocalCache {
  private entries = new Map<string, Entry>();
  private hits = 0;
  private misses = 0;

  get(key: string): Entry | undefined {
    const entry = this.entries.get(key);
    if (!entry) { this.misses++; return undefined; }
    if (entry.expiresAt < Date.now()) { this.entries.delete(key); this.misses++; return undefined; }
    this.hits++;
    return entry;
  }

  invalidate(key: string) { this.entries.delete(key); }
}`,
    'A cache with an explicit invalidation call. Correct, and trivially so.',
  ),
  p(
    'This works because the map and the reader are in the same process, ordered by one thread or guarded by one mutex. When `invalidate` returns, every subsequent `get` sees the new value. You can reason about it locally.',
  ),
  h2('Where it stops being local'),
  p(
    'Now put the cache in Redis and the reader in fifty pods, and the guarantee quietly evaporates. `DEL` returns. The writer moves on. But a pod that read the key eight milliseconds ago still has it in a local LRU with a five-minute TTL, and that pod will happily serve the stale value for five more minutes.',
  ),
  p(
    'You have not fixed a bug. You have introduced a distributed systems problem and given it a friendly name.',
  ),
  primer(
    'Stale-while-revalidate',
    'A caching strategy that serves the previous value immediately while refreshing it in the background, trading a bounded amount of staleness for a large reduction in tail latency.',
  ),
  h2('Three strategies, and what each one costs'),
  p(
    'There are exactly three coherent answers, and every production cache is some mixture of them. Knowing which mixture you are running is most of the work.',
  ),
  table(
    ['Strategy', 'Freshness', 'Cost', 'Fails when'],
    [
      ['Write-through', 'Immediate on the writer side', 'Write latency doubles', 'The reader cannot see the writer\'s write — you need a barrier'],
      ['Invalidate + TTL', 'Bounded by TTL', 'Cheapest to run', 'You accept staleness and must say so out loud'],
      ['Push to all readers', 'Immediate', 'O(replicas) per write', 'A replica is down, or lagging, or you forgot to subscribe'],
    ],
  ),
  p(
    'The third strategy is the one people reach for and then discover is a distributed system with a fan-out and no backpressure. If you push invalidations, you are building a broadcast protocol. You now have to think about what a subscriber does when it reconnects and has missed forty messages.',
  ),
  h2('The honest answer'),
  p(
    'Pick invalidate-plus-TTL, set the TTL from the rate of change of the data, and write the TTL down next to the data. Then tell the people reading through the cache what window of staleness they are inside, because they will otherwise assume they are looking at truth.',
  ),
  quote(
    'The TTL is not a cache policy. It is a promise about how wrong you are willing to be, made in a config file that nobody reads.',
    '',
  ),
  p(
    'Everything else is a way of deferring that conversation.',
  ),
);

const cacheV2 = applyPatches(cacheV1, [
  {
    op: 'edit',
    id: blockId(cacheV1, { type: 'paragraph', contains: 'introduced a distributed systems problem' }),
    text:
      'You have not fixed a bug. You have introduced a distributed systems problem and given it a friendly name. The tell is that nobody can now state what the system is allowed to get wrong — and that was the entire value of the local version.',
  },
  {
    op: 'insertAfter',
    after: blockId(cacheV1, { type: 'primer', contains: 'tail latency.' }),
    block: interactive(
      'curve',
      'Staleness against TTL, for a key changing every 10s',
      { model: 'staleness', min: 0.5, max: 300, step: 0.5, changeEvery: 10, unit: 's' },
    ),
  },
  {
    op: 'edit',
    id: blockId(cacheV1, { type: 'paragraph', contains: 'set the TTL from the rate of change' }),
    text:
      'Pick invalidate-plus-TTL, set the TTL from the rate of change of the data, and write the TTL down next to the data. Then tell the people reading through the cache what window of staleness they are inside, because they will otherwise assume they are looking at truth. The rule of thumb that has held up for me: **TTL no longer than the median inter-arrival time of a change, capped at whatever your users can tolerate.** Below that you are paying write amplification for freshness nobody needed; above it you are serving lies with a timer.',
  },
]);

const cacheV3 = applyPatches(cacheV2, [
  {
    op: 'edit',
    id: blockId(cacheV2, { type: 'paragraph', contains: 'median inter-arrival time' }),
    text:
      'Pick invalidate-plus-TTL, set the TTL from the rate of change of the data, and write the TTL down next to the data. Then tell the people reading through the cache what window of staleness they are inside, because they will otherwise assume they are looking at truth.',
  },
  {
    op: 'insertAfter',
    after: blockId(cacheV2, { type: 'paragraph', contains: 'otherwise assume they are looking at truth' }),
    block: callout(
      'correction',
      'I had the direction of that rule backwards',
      'An earlier version of this post said to set the TTL *above* the median inter-arrival time, on the reasoning that you want a cache that survives. That is wrong and it is the classic mistake. A TTL above the change interval means a reader is almost guaranteed to see at least one stale value. The correct direction is: TTL at or **below** the interval, so a reader who misses an invalidation still gets a fresh value before the next change lands. Corrected 14 months after publication, which is a good advertisement for why posts should be able to change.',
    ),
  },
]);

const cacheV4 = applyPatches(cacheV3, [
  {
    op: 'insertAfter',
    after: blockId(cacheV3, { type: 'heading', contains: 'honest answer' }),
    block: note(
      'The interactive above assumes a key whose value changes on a Poisson-ish process. Real change is bursty — deploys, backfills, a customer uploading in bulk. Under bursty load the expected staleness is far worse than the TTL suggests, and the only defence is to make invalidation a first-class write-path event rather than hoping the timer covers you.',
    ),
  },
  {
    op: 'insertAfter',
    after: blockId(cacheV3, { type: 'quote', contains: 'config file that nobody reads' }),
    block: p(
      'The corollary, which cost me a very long week: a TTL is not a cache policy, it is a *documented error budget*. If you cannot write down the number, you do not have a cache, you have a source of intermittent lies.',
    ),
  },
]);

/* ========================================================================== */
/* 2. The p99 — budding, shows the seedling→budding arc.                        */
/* ========================================================================== */

const p99V1 = doc(
  tldr('You cannot aggregate percentiles across services. If your latency budget depends on summing p99s from three hops, the number is fiction and the SLO is unenforceable.'),
  p(
    'There is a specific kind of incident where every dashboard is green and the customers are still complaining, and the cause is almost always this: someone averaged a percentile.',
  ),
  h2('Why percentiles do not add'),
  p(
    'A p99 is the value that 99% of requests came in under. It is a property of a *distribution*, not a quantity you can decompose. If service A has a p99 of 40ms and service B has a p99 of 60ms, you have learned essentially nothing about the p99 of the pair, because the 1% that is slow in A and the 1% that is slow in B are very unlikely to be the same 1% of requests.',
  ),
  primer(
    'Maximal coupling',
    'A construction that forces two random variables to share all of their randomness, which gives the largest possible correlation. Perfectly correlated tails are what make naive percentile addition accidentally correct — and they do not happen in your infrastructure.',
  ),
  p(
    'The inequality is the interesting part. `p99(A + B) ≤ p99(A) + p99(B)` holds always, so summing can only ever *overstate* — the direction is not in doubt. What is in doubt is the size of the error, and that depends entirely on how correlated the tails are. If your hops fail together, the sum is exactly right. If they fail independently, a real fraction of the budget you just committed to is imaginary. Nothing in either dashboard tells you which world you are in.',
  ),
  callout(
    'warn',
    'The 1% rule does not survive contact',
    'Roughly 1% of requests per service means a four-hop request has a ~4% chance of touching at least one slow path. That is four times the error budget you were planning for, and it arrives at a different place every time.',
  ),
  h2('What to do instead'),
  p(
    'Measure the percentile on the whole request, at the edge, with the trace id attached. That is the only p99 that means anything. Everything else is a component-level diagnostic wearing a system-level label.',
  ),
  list([
    'Instrument at the edge. One p99 per incoming request, not four per hop.',
    'Keep per-service percentiles, but label them as diagnostics. Never sum them into a budget.',
    'If you need an early warning, alert on the edge p99 and use per-hop data to explain it.',
    'Budget in milliseconds of *expected* latency and verify the tail separately — the two are different questions.',
  ]),
  p(
    'The uncomfortable part: this requires trace propagation to be correct, which is a larger project than the SLO was. That is the real cost of a meaningful latency budget, and it is the cost people avoid by averaging.',
  ),
  note(
    'A caveat on the 4% figure, which readers have correctly pushed back on twice. It assumes the slow tails of the four hops are independent. Under a shared cause — a noisy neighbour, a deploy that touched every service, a GC pause — the tails are highly correlated and naive addition is closer to right. That is precisely why the mistake survives: it is right often enough to feel validated, and the incidents where it is badly wrong are the ones you do not get a page for.',
  ),
);

const p99V2 = applyPatches(p99V1, [
  {
    op: 'insertAfter',
    after: blockId(p99V1, { type: 'paragraph', contains: 'The inequality is the interesting part' }),
    block: interactive(
      'breakdown',
      'Where the p99 actually goes across four hops',
      { hops: ['edge', 'auth', 'service', 'db'], latencies: [8, 12, 25, 40], variance: [3, 4, 9, 30] },
    ),
  },
  {
    op: 'insertAfter',
    after: blockId(p99V1, { type: 'callout', contains: '1% rule does not survive' }),
    block: p(
      'Worth being precise about why 4% is a *floor* rather than an estimate. Real hops are correlated by traffic shape — a cache stampede hits the edge, the service and the database simultaneously — which pushes the true figure higher. You will not see a spike where all four are slow at once very often, but when you do, it is catastrophic rather than merely bad.',
    ),
  },
  {
    op: 'edit',
    id: blockId(p99V1, { type: 'paragraph', contains: 'by averaging.' }),
    text:
      'The uncomfortable part: this requires trace propagation to be correct, which is a larger project than the SLO was. That is the real cost of a meaningful latency budget, and it is the cost people avoid by averaging. I have now watched three teams take the averaging route and every one of them ended up with an SLO that improved exactly as much as the service got worse.',
  },
]);

/* ========================================================================== */
/* 3. Deleting staging — a seedling. Short, rough, honestly unfinished.        */
/* ========================================================================== */

const stagingV1 = doc(
  tldr('We deleted staging. Six months in, the single best thing we did was deleting a database nobody had ever written a test against.'),
  p(
    'Six months ago we deleted our staging environment. This post is unfinished and will stay that way until I know whether it was a mistake.',
  ),
  p(
    'The case for deleting it: in four years, staging had been the target of exactly three real deployments. Everything else went to production directly. Meanwhile it cost roughly 400 engineer-hours a year to keep its data vaguely fresh, and the drift was bad enough that a passing staging test told you nothing about production.',
  ),
  p(
    'The case against, which I still find persuasive: when we cut a release two hours before a Friday deploy, we had nothing. Not a degraded path, nothing. We waited nine hours. I do not think I would make that call again without a real answer.',
  ),
  h2('What replaced it'),
  list([
    'Shadow traffic against production with writes faked. Caught two schema incompatibilities in the first month.',
    'Database restore-from-backup rehearsal on a schedule, measured in minutes rather than described in a wiki page.',
    'A five-minute deploy freeze on Fridays. Not a technical control — a social one, and the only one that actually worked.',
  ]),
  p(
    'Open question I do not have an answer to: does the shadow-traffic setup actually catch the class of bug that staging would have? I believe it catches schema and serialization bugs. I have no evidence it catches the "this is slow only under real data volume" class, and I suspect it does not.',
  ),
  callout(
    'note',
    'Why this is a seedling',
    'I am publishing this before I have an answer because the failure mode of waiting is that I will rationalise the decision and then write a retrospective about how it went well. I would rather the record show genuine uncertainty.',
  ),
  primer(
    'Shadow traffic',
    'Mirrored production requests onto a non-serving copy of the stack. Reads see real data, writes are intercepted and discarded, so the code path under test is byte-for-byte the one in production without the side effects.',
  ),
  note(
    'The number I keep avoiding putting here: the nine-hour wait cost us roughly one business day of engineering time and one customer-visible gap. Against 400 engineer-hours a year for staging, that is not obviously a bad trade — but it is a single incident, and single incidents are exactly the sample size I should not be drawing conclusions from.',
  ),
);

/* ========================================================================== */
/* 4. Evaluating retrieval — evergreen, long, tables and code, three revisions. */
/* ========================================================================== */

const retrievalV1 = doc(
  tldr('Recall@10 tells you whether your retriever found the right chunk. It tells you nothing about whether the chunk was useful. Those are different measurements and conflating them is why retrieval evals feel like astrology.'),
  p(
    'Almost every team that builds a retrieval system evaluates it the same way: hand-label a few hundred query–document pairs, measure recall at k, declare victory. The number goes up. Users do not get better answers. I have watched this happen four times.',
  ),
  h2('The measurement that breaks the loop'),
  p(
    'Recall@k answers "was the gold document in the top k". That is a property of the *index*. Whether the reader — in this case the model — could use what it retrieved is a completely different question, and it is the one that determines whether anyone notices the feature.',
  ),
  table(
    ['Layer', 'Question', 'Metric', 'What it diagnoses'],
    [
      ['Index', 'Did we find the right chunk?', 'recall@k, nDCG', 'Chunking, embeddings, index config'],
      ['Context', 'Was it the right *amount*?', 'context precision, fill rate', 'Reranking, dedup, budget'],
      ['Answer', 'Did it use the chunk?', 'groundedness, citation accuracy', 'The generator, not the retriever'],
    ],
  ),
  p(
    'Teams that skip the middle row get a very confusing position: perfect recall, useless answers. The chunk was retrieved and then drowned by eleven near-duplicates of itself, and the model — correctly — ignored the pile.',
  ),
  primer(
    'Groundedness',
    'The share of claims in a generated answer that are supported by the supplied context. Measured by decomposing the answer into atomic claims and checking each against the source. High groundedness with low recall is the signature of a broken retriever; low groundedness with high recall points at the generator.',
  ),
  h2('The boring middle row'),
  p(
    'Context precision is the most under-measured number in the stack and the one that moves outcomes the most. It is also trivial to compute: of the chunks you actually put in the prompt, what fraction earned their place.',
  ),
  code(
    'py',
    `def context_precision(retrieved, used, k=10):
    """Fraction of supplied chunks the generator actually relied on."""
    supplied = retrieved[:k]
    if not supplied:
        return 0.0
    return sum(1 for c in supplied if c.id in used) / len(supplied)


def diagnose(recall_at_k, context_precision, groundedness):
    if recall_at_k < 0.7:
        return "retrieval is broken — fix the index first"
    if context_precision < 0.4:
        return "retrieval is drowning the answer — add reranking, not a bigger k"
    if groundedness < 0.6:
        return "retrieval is fine, generation is not"
    return "healthy"`,
    'The three-number triage. Runs in the eval job, prints at the top of the dashboard.',
  ),
  p(
    'The ordering matters more than any individual threshold. Improving groundedness when recall is 0.4 is a very expensive way to produce confidently wrong answers with citations.',
  ),
);

const retrievalV2 = applyPatches(retrievalV1, [
  {
    op: 'edit',
    id: blockId(retrievalV1, { type: 'paragraph', contains: 'I have watched this happen four times' }),
    text:
      'Almost every team that builds a retrieval system evaluates it the same way: hand-label a few hundred query–document pairs, measure recall at k, declare victory. The number goes up. Users do not get better answers. I have watched this happen four times, and in three of them the team had a dashboard that looked like it was working right up until the week it shipped.',
  },
  {
    op: 'insertAfter',
    after: blockId(retrievalV1, { type: 'paragraph', contains: 'ignored the pile' }),
    block: interactive(
      'matrix',
      'Which layer is broken?',
      {
        axes: ['recall@10', 'context precision', 'groundedness'],
        cases: [
          { name: 'retrieval', recall: 0.4, precision: 0.3, grounded: 0.5, verdict: 'Fix the index' },
          { name: 'drowning', recall: 0.9, precision: 0.2, grounded: 0.4, verdict: 'Add reranking' },
          { name: 'generation', recall: 0.9, precision: 0.8, grounded: 0.4, verdict: 'Fix the generator' },
        ],
      },
    ),
  },
]);

const retrievalV3 = applyPatches(retrievalV2, [
  {
    op: 'insertAfter',
    after: blockId(retrievalV2, { type: 'code', contains: 'def diagnose' }),
    block: note(
      'These thresholds are calibrated against a mixed set of roughly 40 systems and should be treated as a starting point, not law. The *relative ordering* of the checks is the durable part; the numbers will need recalibrating as the models underneath you change. We have had to lower the groundedness bar twice as models got better at hedging.',
    ),
  },
  {
    op: 'insertAfter',
    after: blockId(retrievalV2, { type: 'heading', contains: 'boring middle row' }),
    block: p(
      'One trap specific to the middle row: context precision measured against *what the model cited* under-reports, because a model can use a chunk without citing it. Pair it with an entailment check against the answer and the two together are considerably more honest than either alone.',
    ),
  },
]);

/* ========================================================================== */
/* 5. Embeddings — budding, interactive breakdown, author margin note.          */
/* ========================================================================== */

const embedV1 = doc(
  tldr('A bigger embedding model makes your search better and your index larger, and the crossover point is far lower than vendor benchmarks suggest. Most teams are leaving quality on the table to buy dimensions they do not use.'),
  p(
    'There is a particular kind of infrastructure decision that gets made by default rather than by measurement: how many dimensions. 1536 feels safe. 3072 feels careful. 768 feels like a compromise, and compromises are what people choose when they have not measured.',
  ),
  h2('What dimension actually buys'),
  p(
    'Dimension buys capacity to separate things that should be separated. It does not buy fidelity of meaning. Past a modest threshold, the returns are dominated by the quality of the training data and the normalisation, not the width.',
  ),
  interactive(
    'curve',
    'Recall against embedding width, measured on our corpus',
    { model: 'recall', min: 128, max: 3072, step: 128, measured: [0.71, 0.79, 0.83, 0.85, 0.86, 0.861, 0.859, 0.857] },
  ),
  p(
    'The curve flattens hard around 768. Everything past that is index size and query latency for a fraction of a point of recall, and that fraction is inside the noise of a 300-query eval set.',
  ),
  h2('What actually moved the number'),
  list([
    'Normalising vectors before the ANN index. Free, and worth about two points.',
    'Stripping boilerplate — nav, footers, cookie banners — from chunks before embedding. Worth about four.',
    'Chunking on structure rather than a fixed token window. Worth about six, and it is the only one that helped context precision too.',
  ]),
  p(
    'Notice that none of those are about the model. The first three are about your pipeline being honest about what it is embedding.',
  ),
  primer(
    'ANN index',
    'An approximate nearest-neighbour index. It trades exact recall for sublinear search by partitioning the vector space and probing only a few partitions, so the answer depends heavily on the distribution of what you put in it — a corpus of near-duplicates is the worst case.',
  ),
  note(
    'The measurement was run twice: once on support tickets, once on internal queries. The curve shape held on both, but the absolute values were about four points higher on internal queries, because internal query phrasing is more regular. If you are picking a corpus for your own eval set, that gap is worth knowing about.',
  ),
);

/** Hoisted so the second patch can anchor to it. A patch cannot reference a
 *  block that a sibling patch has not inserted yet. */
const gotWrong = h3('One thing I got wrong');

const embedV2 = applyPatches(embedV1, [
  {
    op: 'edit',
    id: blockId(embedV1, { type: 'paragraph', contains: 'and compromises are what people choose' }),
    text:
      'There is a particular kind of infrastructure decision that gets made by default rather than by measurement: how many dimensions. 1536 feels safe. 3072 feels careful. 768 feels like a compromise, and compromises are what people choose when they have not measured. I spent most of a quarter measuring it, because we had a very expensive index and no evidence about whether the width was the reason it was expensive.',
  },
  {
    op: 'insertAfter',
    after: blockId(embedV1, { type: 'paragraph', contains: 'honest about what it is embedding' }),
    block: callout(
      'note',
      'A note on the eval set',
      'The 300-query set above is drawn from our own support tickets, which means it is biased toward the questions that already have answers. The absolute numbers are optimistic. The *shape* of the curve is what I trust, and the shape has been stable across the three corpora I have measured it on.',
    ),
  },
  {
    op: 'insertAfter',
    after: blockId(embedV1, { type: 'heading', contains: 'actually moved the number' }),
    block: gotWrong,
  },
  {
    op: 'insertAfter',
    after: gotWrong.id,
    block: p(
      'I originally attributed the chunking gain to overlap. Overlap is almost irrelevant. The gain was entirely from not embedding navigation text — with a 512-token window and a 200-token overlap, a third of every chunk was table of contents links whose embeddings are near-identical across the entire corpus, and near-duplicates in an ANN index are exactly what destroys context precision.',
    ),
  },
]);

/* ========================================================================== */

export const SEED_POSTS: SeedPost[] = [
  {
    slug: 'cache-invalidation-is-a-distributed-problem',
    title: 'Cache invalidation is a distributed systems problem',
    dek: 'The TTL is not a cache policy. It is a probability distribution, and somebody has to own it.',
    status: 'evergreen',
    topicSlug: 'systems',
    seoDescription:
      'Once a cache is shared across machines, invalidation becomes consensus. Why invalidate-plus-TTL is the honest default, and what it costs.',
    publishedDaysAgo: 1050,
    revisions: [
      { body: cacheV1, changeSummary: 'First published version.', isMajor: true, daysAgo: 1050 },
      {
        body: cacheV2,
        changeSummary: 'Added an interactive staleness-vs-TTL figure, and rewrote the TTL guidance.',
        isMajor: true,
        daysAgo: 470,
      },
      {
        body: cacheV3,
        changeSummary: 'Corrected the direction of the TTL rule. It was backwards.',
        isMajor: true,
        daysAgo: 140,
      },
      {
        body: cacheV4,
        changeSummary: 'Added a note on bursty change and a corollary on error budgets.',
        isMajor: false,
        daysAgo: 12,
      },
    ],
    links: [{ toSlug: 'we-deleted-our-staging-environment', type: 'extends' }],
  },
  {
    slug: 'the-p99-is-a-lie-you-tell-yourself',
    title: 'The p99 is a lie you tell yourself',
    dek: 'You cannot add percentiles. Every latency budget that does is a budget nobody is actually keeping.',
    status: 'budding',
    topicSlug: 'systems',
    seoDescription:
      'Why percentiles do not decompose across services, and why your four-hop p99 is fiction if you built it from four component p99s.',
    publishedDaysAgo: 210,
    revisions: [
      { body: p99V1, changeSummary: 'First published version.', isMajor: true, daysAgo: 210 },
      {
        body: p99V2,
        changeSummary: 'Added the hop breakdown figure and a note on why 4% is a floor.',
        isMajor: false,
        daysAgo: 26,
      },
    ],
    links: [
      { toSlug: 'cache-invalidation-is-a-distributed-problem', type: 'cites' },
      { toSlug: 'field-guide-to-evaluating-retrieval', type: 'mentions' },
    ],
  },
  {
    slug: 'we-deleted-our-staging-environment',
    title: 'We deleted our staging environment',
    dek: 'Six months in. The best thing we did was delete a database nobody had ever tested against.',
    status: 'seedling',
    topicSlug: 'systems',
    seoDescription:
      'An unfinished account of deleting staging in favour of shadow traffic, restore rehearsals, and a deploy freeze.',
    publishedDaysAgo: 180,
    revisions: [{ body: stagingV1, changeSummary: 'First published version.', isMajor: true, daysAgo: 180 }],
    links: [{ toSlug: 'cache-invalidation-is-a-distributed-problem', type: 'cites' }],
  },
  {
    slug: 'field-guide-to-evaluating-retrieval',
    title: 'A field guide to evaluating retrieval systems',
    dek: 'Recall@k tells you if you found the chunk. It tells you nothing about whether the chunk was useful.',
    status: 'evergreen',
    topicSlug: 'ml',
    seoDescription:
      'Index, context, answer: the three layers of a retrieval stack, which metric belongs to each, and the triage order that stops you optimising the wrong one.',
    publishedDaysAgo: 640,
    revisions: [
      { body: retrievalV1, changeSummary: 'First published version.', isMajor: true, daysAgo: 640 },
      {
        body: retrievalV2,
        changeSummary: 'Added the diagnostic matrix and sharpened the opening claim.',
        isMajor: false,
        daysAgo: 300,
      },
      {
        body: retrievalV3,
        changeSummary: 'Added a caveat on the thresholds and a warning about citation-only measurement.',
        isMajor: false,
        daysAgo: 61,
      },
    ],
  },
  {
    slug: 'why-your-embeddings-are-worse-than-you-think',
    title: 'Why your embeddings are worse than you think',
    dek: 'Dimension buys separation, not meaning. The curve flattens hard, and three pipeline bugs were costing more than the model.',
    status: 'budding',
    topicSlug: 'ml',
    seoDescription:
      'Measured recall against embedding width across a real corpus, and the three pipeline fixes that beat any model upgrade.',
    publishedDaysAgo: 96,
    revisions: [
      { body: embedV1, changeSummary: 'First published version.', isMajor: true, daysAgo: 96 },
      {
        body: embedV2,
        changeSummary: 'Added a note on eval-set bias and a correction about where the chunking gain came from.',
        isMajor: true,
        daysAgo: 9,
      },
    ],
    links: [{ toSlug: 'field-guide-to-evaluating-retrieval', type: 'cites' }],
  },
];

export const SEED_ANNOTATIONS: Array<{
  postSlug: string;
  /** Index into the final revision's block list. */
  blockIndex: number;
  quote: string;
  kind: 'comment' | 'correction' | 'extension' | 'disagreement' | 'worked_example' | 'update' | 'author_note';
  authorHandle: string;
  body: string;
  daysAgo: number;
  parentIndex?: number;
  accepted?: boolean;
}> = [
  {
    postSlug: 'cache-invalidation-is-a-distributed-problem',
    blockIndex: 8,
    quote: 'nothing in the logs said why',
    kind: 'comment',
    authorHandle: 'mira',
    body: 'The logs never say why because "why" is a semantic question and logs are a syntactic record. We eventually added a stale-read counter to the read path specifically so that this question had an answer.',
    daysAgo: 900,
  },
  {
    postSlug: 'cache-invalidation-is-a-distributed-problem',
    blockIndex: 12,
    quote: 'a friendly name',
    kind: 'extension',
    authorHandle: 'sam',
    body: 'This is also why the local-cache version survives in so many codebases: it is the only version where correctness is *obvious*, and obviousness is a real engineering property that people will trade performance to keep.',
    daysAgo: 720,
  },
  {
    postSlug: 'cache-invalidation-is-a-distributed-problem',
    blockIndex: 5,
    quote: 'There is a happens-before edge',
    kind: 'correction',
    authorHandle: 'mira',
    body: 'Small correction: this is only true if the reader and the map are actually ordered. Under a per-key lock you have the edge; under a striped lock you have an edge only for keys in the same stripe, which is a weaker guarantee than it looks.',
    daysAgo: 480,
    accepted: true,
  },
  {
    postSlug: 'cache-invalidation-is-a-distributed-problem',
    blockIndex: 30,
    quote: 'I had the direction of that rule backwards',
    kind: 'author_note',
    authorHandle: 'vedant',
    body: 'Worth saying plainly: I have taught the backwards version of this rule in at least two internal sessions, and I was not shy about it. The reason I am leaving the correction in rather than quietly fixing it is that I do not think the original error was stupidity — it was that the intuitive story about caches is about surviving traffic, and the correct rule is about not lying to readers. Those are different mental models and I had the wrong one.',
    daysAgo: 140,
  },
  {
    postSlug: 'the-p99-is-a-lie-you-tell-yourself',
    blockIndex: 4,
    quote: 'very unlikely to be the same 1%',
    kind: 'disagreement',
    authorHandle: 'sam',
    body: 'I push back slightly on "very unlikely". If both services degrade from a shared cause — a noisy neighbour, a bad deploy that touched both, a GC pause — the slow tails are *highly* correlated. In that regime naive addition is close to right, which is exactly why the mistake survives: it is right often enough to feel validated.',
    daysAgo: 150,
  },
  {
    postSlug: 'field-guide-to-evaluating-retrieval',
    blockIndex: 2,
    quote: 'conflating them is why retrieval evals feel like astrology',
    kind: 'comment',
    authorHandle: 'vedant',
    body: 'The astrology comparison lands because it is about a diagnostic that cannot disagree with you. A recall number goes up when you improve chunking, when you get lucky, and when you make the eval set easier. Nothing in the number tells you which.',
    daysAgo: 300,
  },
  {
    postSlug: 'why-your-embeddings-are-worse-than-you-think',
    blockIndex: 1,
    quote: '1536 feels safe',
    kind: 'comment',
    authorHandle: 'mira',
    body: 'The "decisions made by default rather than by measurement" framing is the whole post. We spent six months and a very large index re-embedding our entire corpus to move from 1536 to 768, having never run the measurement that would have told us to do it in week one.',
    daysAgo: 80,
  },
];

/** A curated reading list — curation, not a feed. */
export const SEED_READING_LIST = {
  slug: 'start-here',
  title: 'If you only read four things',
  description:
    'A starting order. The third one is the one people skip and it is the one that changes how you read the rest.',
  items: [
    { toSlug: 'cache-invalidation-is-a-distributed-problem', note: 'Start here. The clearest case for why the medium has to admit change.' },
    { toSlug: 'the-p99-is-a-lie-you-tell-yourself', note: 'Short. Read it before your next SLD.' },
    { toSlug: 'we-deleted-our-staging-environment', note: 'The seedling. Published before the author had an answer — which is the point.' },
    { toSlug: 'field-guide-to-evaluating-retrieval', note: 'The long one. Has a diagnostic you can paste into a job.' },
  ],
};
