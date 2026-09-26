import { useId, useMemo, useState } from 'react';

/**
 * Author-authored explorable artifacts.
 *
 * These are the read side of "explorable explanations" (PLAN.md §4.4): a
 * parameter the reader can move to stress-test the author's claim. Deliberately
 * hand-drawn SVG rather than a charting library — no gradients, no tooltips on
 * hover-only affordances, and every series labelled in type rather than colour.
 *
 * The breakdown simulation is seeded so the server-rendered and hydrated output
 * are identical. An artifact that reshuffles on hydration is a bug the reader
 * notices immediately.
 */

type Props =
  | { component: 'curve'; title?: string; props: Record<string, unknown> }
  | { component: 'breakdown'; title?: string; props: Record<string, unknown> }
  | { component: 'matrix'; title?: string; props: Record<string, unknown> }
  | { component: 'timeline'; title?: string; props: Record<string, unknown> };

/* -------------------------------------------------------------------------- */
/* Primitives                                                                  */
/* -------------------------------------------------------------------------- */

function Frame({
  title,
  caption,
  children,
  note,
}: {
  title?: string;
  caption?: string;
  children: React.ReactNode;
  note?: string;
}) {
  return (
    <figure className="my-8 border border-rule bg-surface">
      {title && (
        <figcaption className="meta border-b border-rule px-4 py-2.5">{title}</figcaption>
      )}
      <div className="p-4">{children}</div>
      {(caption || note) && (
        <p className="meta border-t border-rule px-4 py-2.5 leading-relaxed">
          {caption}
          {note ? ` ${note}` : ''}
        </p>
      )}
    </figure>
  );
}

function Empty({ what }: { what: string }) {
  return (
    <p className="border border-dashed border-rule-strong p-6 text-center text-[0.9375rem] text-ink-3">
          This figure has no data yet — {what} is empty.
    </p>
  );
}

function Loading({ what }: { what: string }) {
  return (
    <p className="p-6 text-center text-[0.9375rem] text-ink-3" role="status">
      Loading {what}…
    </p>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <p className="border border-danger p-4 text-[0.9375rem] text-danger" role="alert">
      This figure could not be drawn: {message}
    </p>
  );
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function arr(v: unknown): number[] {
  return Array.isArray(v) ? v.map((x) => num(x, 0)) : [];
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

/* -------------------------------------------------------------------------- */
/* Curve — a parameter the reader moves to see the claim under stress.          */
/* -------------------------------------------------------------------------- */

/**
 * Curve — a parameter the reader moves to see the claim under stress.
 *
 * Two models, because the two claims need different evidence:
 *   staleness — P(stale read) against TTL. The cache argument.
 *   recall    — measured recall against embedding width. The capacity argument,
 *               which the author makes by showing where the curve *flattens*.
 */
function Curve({ title, props }: { title?: string; props: Record<string, unknown> }) {
  const model = str(props.model, 'staleness');
  const min = num(props.min, 0);
  const max = num(props.max, 100);
  const changeEvery = num(props.changeEvery, 10);
  const unit = str(props.unit, 's');
  const measured = arr(props.measured);
  const isRecall = model === 'recall';

  const firstX = isRecall ? min : Math.min(max, Math.max(min, changeEvery * 2));
  const [x, setX] = useState(firstX);

  const series = useMemo(() => {
    if (isRecall) {
      if (measured.length === 0) return [];
      const lo = Math.min(...measured);
      const hi = Math.max(...measured);
      // Normalise into the plot box; the axis keeps the real percentages.
      return measured.map((v, i) => {
        const px = min + ((max - min) * i) / Math.max(1, measured.length - 1);
        return { x: px, raw: v, y: hi === lo ? 0.5 : (v - lo) / (hi - lo) };
      });
    }
    const points: Array<{ x: number; raw: number; y: number }> = [];
    const steps = 120;
    for (let i = 0; i <= steps; i++) {
      const px = min + ((max - min) * i) / steps;
      if (px <= 0) {
        points.push({ x: px, raw: 0, y: 0 });
        continue;
      }
      points.push({ x: px, raw: 1 - Math.exp(-changeEvery / px), y: 1 - Math.exp(-changeEvery / px) });
    }
    return points;
  }, [isRecall, measured.join(','), min, max, changeEvery]);

  if (series.length < 2) return <Empty what="the measured series" />;

  // Value under the cursor, interpolated.
  const valueAt = (target: number) => {
    if (series.length === 1) return series[0]!;
    let lo = series[0]!;
    let hi = series[series.length - 1]!;
    for (let i = 0; i < series.length - 1; i++) {
      if (series[i]!.x <= target && series[i + 1]!.x >= target) {
        lo = series[i]!;
        hi = series[i + 1]!;
        break;
      }
    }
    const span = hi.x - lo.x || 1;
    const t = (target - lo.x) / span;
    return { x: target, raw: lo.raw + (hi.raw - lo.raw) * t, y: lo.y + (hi.y - lo.y) * t };
  };

  const cursor = valueAt(x);
  const baseline = series[0]!.raw;
  const W = 560;
  const H = 220;
  const PAD = { l: 52, r: 14, t: 12, b: 28 };
  const px = (v: number) => PAD.l + ((v - min) / (max - min || 1)) * (W - PAD.l - PAD.r);
  const py = (y: number) => H - PAD.b - y * (H - PAD.t - PAD.b);
  const path = series.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`).join(' ');

  const gain = cursor.raw - baseline;
  const yTicks = isRecall
    ? [
        { y: 0, label: `${(Math.min(...measured) * 100).toFixed(0)}%` },
        { y: 0.5, label: `${(((Math.min(...measured) + Math.max(...measured)) / 2) * 100).toFixed(0)}%` },
        { y: 1, label: `${(Math.max(...measured) * 100).toFixed(0)}%` },
      ]
    : [
        { y: 0, label: '0%' },
        { y: 0.25, label: '25%' },
        { y: 0.5, label: '50%' },
        { y: 0.75, label: '75%' },
        { y: 1, label: '100%' },
      ];

  const summary = isRecall
    ? `${(cursor.raw * 100).toFixed(1)}% recall at ${Math.round(cursor.x)} dimensions — ${gain >= 0 ? '+' : ''}${(gain * 100).toFixed(1)} points over the ${Math.round(min)}-dimension baseline.`
    : `${(cursor.raw * 100).toFixed(0)}% of reads can be served stale at a ${cursor.x.toFixed(cursor.x < 10 ? 1 : 0)}${unit} TTL.`;

  return (
    <Frame
      title={title}
      note={
        isRecall
          ? 'Measured, not modelled. Move the slider to see where the curve actually flattens.'
          : 'Assumes independent (Poisson) changes and exponential decay on read. Real change is burstier, so expect worse than this.'
      }
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={summary}
      >
        {yTicks.map((t) => (
          <g key={t.label}>
            <line x1={PAD.l} x2={W - PAD.r} y1={py(t.y)} y2={py(t.y)} stroke="var(--rule)" strokeWidth="1" />
            <text x={PAD.l - 8} y={py(t.y) + 4} textAnchor="end" fontSize="10" fill="var(--ink-3)" fontFamily="var(--font-mono)">
              {t.label}
            </text>
          </g>
        ))}
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth="1.75" />
        <line x1={px(cursor.x)} x2={px(cursor.x)} y1={PAD.t} y2={H - PAD.b} stroke="var(--rule-strong)" strokeWidth="1" />
        <circle cx={px(cursor.x)} cy={py(cursor.y)} r="3.5" fill="var(--accent)" />
        <text x={PAD.l} y={H - 8} fontSize="10" fill="var(--ink-3)" fontFamily="var(--font-mono)">
          {Math.round(min)}
        </text>
        <text x={W - PAD.r} y={H - 8} textAnchor="end" fontSize="10" fill="var(--ink-3)" fontFamily="var(--font-mono)">
          {Math.round(max)}
          {isRecall ? '' : unit}
        </text>
      </svg>

      <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-rule pt-4">
        <label className="flex flex-1 items-center gap-3">
          <span className="meta shrink-0">{isRecall ? 'Width' : 'TTL'}</span>
          <input
            type="range"
            min={min}
            max={max}
            step={(max - min) / 200}
            value={x}
            onChange={(e) => setX(Number(e.target.value))}
            className="w-full accent-[var(--accent)]"
            aria-label={isRecall ? 'Embedding width' : 'Cache TTL'}
          />
          <span className="meta w-16 shrink-0 text-right tabular-nums">
            {Math.round(x)}
            {isRecall ? 'd' : unit}
          </span>
        </label>
        <p className="max-w-sm text-[0.9375rem] text-ink-2">{summary}</p>
      </div>
    </Frame>
  );
}

/* -------------------------------------------------------------------------- */
/* Breakdown — seeded so SSR and hydration agree.                               */
/* -------------------------------------------------------------------------- */

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SCENARIOS = [
  { key: 'independent', label: 'Independent hops', note: 'each hop draws its own shock' },
  { key: 'correlated', label: 'Shared factor', note: 'one shock hits most hops at once' },
  { key: 'locked', label: 'Perfectly locked', note: 'one shock scales every hop' },
] as const;

function Breakdown({ title, props }: { title?: string; props: Record<string, unknown> }) {
  const hops = Array.isArray(props.hops) ? (props.hops as unknown[]).map((h) => str(h)) : [];
  const latencies = arr(props.latencies);
  const variance = arr(props.variance);
  const N = 20000;

  const result = useMemo(() => {
    if (hops.length === 0 || latencies.length === 0) {
      return { naive: 0, perHop: [] as Array<{ name: string; p50: number; p99: number }>, scenarios: [] as Array<{ key: string; label: string; note: string; p99: number }> };
    }
    const rand = mulberry(0x5721a);
    // per[scenario][hop] = that hop's samples, across requests
    const per: number[][][] = Array.from({ length: SCENARIOS.length }, () =>
      hops.map(() => [] as number[]),
    );
    // totals[scenario] = ONE entry per request: the whole-request latency.
    const totals: number[][] = Array.from({ length: SCENARIOS.length }, () => [] as number[]);

    for (let i = 0; i < N; i++) {
      // A single shared shock per request, drawn once — this is the thing that
      // correlates the hops, and it is why the three scenarios differ at all.
      const u = Math.max(rand(), 1e-9);
      const v = rand();
      const shared = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);

      let t0 = 0;
      let t1 = 0;
      let t2 = 0;

      for (let h = 0; h < hops.length; h++) {
        const mean = latencies[h] ?? latencies[0]!;
        const sd = variance[h] ?? variance[0]!;
        const uu = Math.max(rand(), 1e-9);
        const vv = rand();
        const own = Math.sqrt(-2 * Math.log(uu)) * Math.cos(2 * Math.PI * vv);

        // Scenario 0: each hop draws its own shock.
        const a = Math.max(0.1, mean + own * sd);
        // Scenario 1: three quarters of the shared shock leaks into every hop.
        const b = Math.max(0.1, mean + (0.75 * shared + 0.66 * own) * sd);
        // Scenario 2: one shock, scaled by each hop's own standard deviation.
        const c = Math.max(0.1, mean + shared * sd);

        per[0]![h]!.push(a);
        per[1]![h]!.push(b);
        per[2]![h]!.push(c);
        t0 += a;
        t1 += b;
        t2 += c;
      }

      totals[0]!.push(t0);
      totals[1]!.push(t1);
      totals[2]!.push(t2);
    }

    const p99 = (xs: number[]) => {
      xs.sort((x, y) => x - y);
      return xs[Math.floor(xs.length * 0.99)]!;
    };
    const p50 = (xs: number[]) => {
      const s = [...xs].sort((x, y) => x - y);
      return s[Math.floor(s.length * 0.5)]!;
    };

    return {
      // The number a team would report: the sum of the component p99s.
      naive: per[0]!.reduce((sum, samples) => sum + p99(samples), 0),
      perHop: hops.map((name, h) => ({ name, p50: p50(per[0]![h]!), p99: p99(per[0]![h]!) })),
      scenarios: SCENARIOS.map((s, i) => ({ ...s, p99: p99(totals[i]!) })),
    };
  }, [hops.join('|'), latencies.join('|'), variance.join('|')]);

  if (result.perHop.length === 0 || hops.length === 0) return <Empty what="the hop data" />;

  const W = 560;
  const maxV = Math.max(result.naive, ...result.scenarios.map((s) => s.p99));
  const PAD = 44;
  const barW = (v: number) => (v / (maxV || 1)) * (W - PAD - 12);

  return (
    <Frame
      title={title}
      note={`20,000 simulated requests, lognormal per hop. The honest answer depends entirely on how correlated the hops are — which you cannot see from the component numbers.`}
    >
      <svg viewBox={`0 0 ${W} ${result.perHop.length * 30 + result.scenarios.length * 34 + 46}`} className="w-full" role="img" aria-label={`Naive sum of per-hop p99s is ${result.naive.toFixed(0)} milliseconds. The measured p99 of the whole request ranges from ${Math.min(...result.scenarios.map((s) => s.p99)).toFixed(0)} to ${Math.max(...result.scenarios.map((s) => s.p99)).toFixed(0)} milliseconds depending on correlation.`}>
        {result.perHop.map((s, i) => {
          const y = i * 30;
          return (
            <g key={s.name}>
              <text x="0" y={y + 14} fontSize="11" fill="var(--ink-2)" fontFamily="var(--font-mono)">
                {s.name}
              </text>
              <rect x={PAD} y={y + 4} width={barW(s.p99)} height="10" fill="var(--rule-strong)" />
              <text x={PAD + barW(s.p99) + 6} y={y + 13} fontSize="10" fill="var(--ink-3)" fontFamily="var(--font-mono)">
                p99 {s.p99.toFixed(0)} · p50 {s.p50.toFixed(0)}
              </text>
            </g>
          );
        })}

        <line
          x1={PAD}
          x2={PAD + barW(result.naive)}
          y1={result.perHop.length * 30 - 4}
          y2={result.perHop.length * 30 - 4}
          stroke="var(--danger)"
          strokeWidth="2"
        />
        <text x={PAD} y={result.perHop.length * 30 + 10} fontSize="10" fill="var(--danger)" fontFamily="var(--font-mono)">
          sum of per-hop p99s — the number you would report: {result.naive.toFixed(0)}ms
        </text>

        {result.scenarios.map((s, i) => {
          const y = result.perHop.length * 30 + 26 + i * 34;
          const over = s.p99 - result.naive;
          return (
            <g key={s.key}>
              <text x="0" y={y + 12} fontSize="10" fill="var(--ink-2)" fontFamily="var(--font-mono)">
                {s.label}
              </text>
              <rect x={PAD} y={y + 3} width={barW(s.p99)} height="9" fill="var(--accent)" />
              <text x={PAD + barW(s.p99) + 6} y={y + 12} fontSize="10" fill="var(--ink-2)" fontFamily="var(--font-mono)">
                {s.p99.toFixed(0)}ms ({over >= 0 ? '+' : ''}
                {over.toFixed(0)})
              </text>
            </g>
          );
        })}
      </svg>

      <p className="mt-3 border-t border-rule pt-3 text-[0.9375rem] text-ink-2">
        The naive sum is <strong className="font-medium text-ink">{result.naive.toFixed(0)}ms</strong>. The real
        number is somewhere between{' '}
        <strong className="font-medium text-ink">
          {Math.min(...result.scenarios.map((s) => s.p99)).toFixed(0)}ms
        </strong>{' '}
        and{' '}
        <strong className="font-medium text-ink">
          {Math.max(...result.scenarios.map((s) => s.p99)).toFixed(0)}ms
        </strong>
        , and which end you get depends on whether your hops fail together. You cannot read that off the
        component dashboards.
      </p>
    </Frame>
  );
}

/* -------------------------------------------------------------------------- */
/* Matrix — where is your system broken?                                        */
/* -------------------------------------------------------------------------- */

interface Case {
  name: string;
  recall: number;
  precision: number;
  grounded: number;
  verdict: string;
}

function Matrix({ title, props }: { title?: string; props: Record<string, unknown> }) {
  const raw = Array.isArray(props.cases) ? (props.cases as Record<string, unknown>[]) : [];
  const cases: Case[] = raw.map((c) => ({
    name: str(c.name, 'unnamed'),
    recall: num(c.recall, 0),
    precision: num(c.precision, 0),
    grounded: num(c.grounded, 0),
    verdict: str(c.verdict, ''),
  }));
  const [i, setI] = useState(0);

  if (cases.length === 0) return <Empty what="the case list" />;
  const active = cases[Math.min(i, cases.length - 1)]!;
  const W = 560;
  const H = 300;
  const PAD = { l: 52, r: 16, t: 16, b: 40 };
  const px = (v: number) => PAD.l + v * (W - PAD.l - PAD.r);
  const py = (v: number) => H - PAD.b - v * (H - PAD.t - PAD.b);

  return (
    <Frame title={title} note="Recall on the horizontal axis, context precision on the vertical. Click a marker.">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Diagnostic matrix. Selected: ${active.name}, ${active.verdict}`}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line x1={px(t)} x2={px(t)} y1={PAD.t} y2={H - PAD.b} stroke="var(--rule)" strokeWidth="1" />
            <line x1={PAD.l} x2={W - PAD.r} y1={py(t)} y2={py(t)} stroke="var(--rule)" strokeWidth="1" />
          </g>
        ))}
        {cases.map((c, idx) => (
          <g
            key={c.name}
            onClick={() => setI(idx)}
            style={{ cursor: 'pointer' }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') setI(idx);
            }}
          >
            <circle
              cx={px(c.recall)}
              cy={py(c.precision)}
              r={idx === i ? 7 : 5}
              fill={idx === i ? 'var(--accent)' : 'none'}
              stroke="var(--accent)"
              strokeWidth="1.5"
            />
            <text x={px(c.recall) + 11} y={py(c.precision) + 4} fontSize="10" fill="var(--ink-2)" fontFamily="var(--font-mono)">
              {c.name}
            </text>
          </g>
        ))}
        <text x={W / 2} y={H - 10} textAnchor="middle" fontSize="10" fill="var(--ink-3)" fontFamily="var(--font-mono)">
          recall@10 →
        </text>
        <text x="14" y={H / 2} textAnchor="middle" fontSize="10" fill="var(--ink-3)" fontFamily="var(--font-mono)" transform={`rotate(-90 14 ${H / 2})`}>
          context precision →
        </text>
      </svg>

      <div className="mt-3 border-t border-rule pt-3">
        <p className="meta mb-1">{active.name}</p>
        <p className="text-[0.9375rem] text-ink">
          <strong className="font-medium">{active.verdict}</strong>
        </p>
        <p className="meta mt-1 tabular-nums">
          recall {active.recall.toFixed(2)} · precision {active.precision.toFixed(2)} · groundedness{' '}
          {active.grounded.toFixed(2)}
        </p>
      </div>
    </Frame>
  );
}

/* -------------------------------------------------------------------------- */
/* Timeline                                                                    */
/* -------------------------------------------------------------------------- */

function Timeline({ title, props }: { title?: string; props: Record<string, unknown> }) {
  const events = Array.isArray(props.events)
    ? (props.events as Record<string, unknown>[]).map((e) => ({
        at: str(e.at, ''),
        label: str(e.label, ''),
        note: str(e.note, ''),
      }))
    : [];
  if (events.length === 0) return <Empty what="the timeline" />;

  return (
    <Frame title={title}>
      <ol className="relative space-y-4 border-l border-rule pl-5">
        {events.map((e) => (
          <li key={e.at + e.label} className="relative">
            <span className="absolute -left-[1.4375rem] top-1.5 h-1.5 w-1.5 bg-accent" aria-hidden="true" />
            <p className="meta">{e.at}</p>
            <p className="text-[0.9375rem] text-ink">{e.label}</p>
            {e.note && <p className="text-[0.9375rem] text-ink-2">{e.note}</p>}
          </li>
        ))}
      </ol>
    </Frame>
  );
}

/* -------------------------------------------------------------------------- */

export default function Artifact(props: Props) {
  const id = useId();
  try {
    const component = (props as { component: string }).component;
    if (component === 'curve') return <Curve title={props.title} props={props.props} />;
    if (component === 'breakdown') return <Breakdown title={props.title} props={props.props} />;
    if (component === 'matrix') return <Matrix title={props.title} props={props.props} />;
    if (component === 'timeline') return <Timeline title={props.title} props={props.props} />;
    return <ErrorBox message={`unknown artifact "${String(component)}" (${id})`} />;
  } catch (err) {
    return <ErrorBox message={err instanceof Error ? err.message : 'unexpected failure'} />;
  }
}

export { Loading };
