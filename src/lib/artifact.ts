/**
 * Artifact math, extracted from the components so it runs once on the server.
 *
 * These are the computations behind the explorable figures (PLAN.md §4.4).
 * Keeping them here — plain functions, no framework — means the SVG is drawn
 * once, server-side, and the page ships no chart runtime at all. Only the two
 * genuinely interactive figures (a slider and a click) carry any client JS,
 * and they carry only the arithmetic to move a line, not a re-render.
 */

export type Depth = 'skim' | 'understand' | 'master';

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
export { num, arr, str };

/* -- Curve ---------------------------------------------------------------- */

export interface Point {
  x: number;
  raw: number;
  y: number;
}

export interface CurveData {
  ok: boolean;
  isRecall: boolean;
  min: number;
  max: number;
  unit: string;
  series: Point[];
  firstX: number;
  note: string;
  seriesForClient: number[]; // [x, raw, y] triples, for the slider script
}

export function curveData(props: Record<string, unknown>): CurveData {
  const model = str(props.model, 'staleness');
  const min = num(props.min, 0);
  const max = num(props.max, 100);
  const changeEvery = num(props.changeEvery, 10);
  const unit = str(props.unit, 's');
  const measured = arr(props.measured);
  const isRecall = model === 'recall';

  let series: Point[];
  if (isRecall) {
    if (measured.length === 0) {
      return {
        ok: false,
        isRecall,
        min,
        max,
        unit,
        series: [],
        firstX: min,
        note: '',
        seriesForClient: [],
      };
    }
    const lo = Math.min(...measured);
    const hi = Math.max(...measured);
    series = measured.map((v, i) => {
      const px = min + ((max - min) * i) / Math.max(1, measured.length - 1);
      return { x: px, raw: v, y: hi === lo ? 0.5 : (v - lo) / (hi - lo) };
    });
  } else {
    series = [];
    const steps = 120;
    for (let i = 0; i <= steps; i++) {
      const px = min + ((max - min) * i) / steps;
      if (px <= 0) {
        series.push({ x: px, raw: 0, y: 0 });
        continue;
      }
      const y = 1 - Math.exp(-changeEvery / px);
      series.push({ x: px, raw: y, y });
    }
  }

  return {
    ok: series.length >= 2,
    isRecall,
    min,
    max,
    unit,
    series,
    firstX: isRecall ? min : Math.min(max, Math.max(min, changeEvery * 2)),
    note: isRecall
      ? 'Measured, not modelled. Move the slider to see where the curve actually flattens.'
      : 'Assumes independent (Poisson) changes and exponential decay on read. Real change is burstier, so expect worse than this.',
    seriesForClient: series.flatMap((p) => [p.x, p.raw, p.y]),
  };
}

/* -- Breakdown ------------------------------------------------------------ */

export interface Scenario {
  key: string;
  label: string;
  note: string;
  p99: number;
}
export interface BreakdownData {
  ok: boolean;
  naive: number;
  perHop: Array<{ name: string; p50: number; p99: number }>;
  scenarios: Scenario[];
}

const SCENARIOS = [
  { key: 'independent', label: 'Independent hops', note: 'each hop draws its own shock' },
  { key: 'correlated', label: 'Shared factor', note: 'one shock hits most hops at once' },
  { key: 'locked', label: 'Perfectly locked', note: 'one shock scales every hop' },
] as const;

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function breakdownData(props: Record<string, unknown>): BreakdownData {
  const hops = Array.isArray(props.hops) ? (props.hops as unknown[]).map((h) => str(h)) : [];
  const latencies = arr(props.latencies);
  const variance = arr(props.variance);
  const N = 20000;

  if (hops.length === 0 || latencies.length === 0) {
    return { ok: false, naive: 0, perHop: [], scenarios: [] };
  }

  const rand = mulberry(0x5721a);
  const per: number[][][] = Array.from({ length: SCENARIOS.length }, () => hops.map(() => [] as number[]));
  const totals: number[][] = Array.from({ length: SCENARIOS.length }, () => [] as number[]);

  for (let i = 0; i < N; i++) {
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
      const a = Math.max(0.1, mean + own * sd);
      const b = Math.max(0.1, mean + (0.75 * shared + 0.66 * own) * sd);
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
    ok: true,
    naive: per[0]!.reduce((sum, samples) => sum + p99(samples), 0),
    perHop: hops.map((name, h) => ({ name, p50: p50(per[0]![h]!), p99: p99(per[0]![h]!) })),
    scenarios: SCENARIOS.map((s, i) => ({ ...s, p99: p99(totals[i]!) })),
  };
}

/* -- Matrix --------------------------------------------------------------- */

export interface Case {
  name: string;
  recall: number;
  precision: number;
  grounded: number;
  verdict: string;
}

export function matrixCases(props: Record<string, unknown>): Case[] {
  const raw = Array.isArray(props.cases) ? (props.cases as Record<string, unknown>[]) : [];
  return raw.map((c) => ({
    name: str(c.name, 'unnamed'),
    recall: num(c.recall, 0),
    precision: num(c.precision, 0),
    grounded: num(c.grounded, 0),
    verdict: str(c.verdict, ''),
  }));
}

/* -- Timeline ------------------------------------------------------------- */

export interface TimelineEvent {
  at: string;
  label: string;
  note: string;
}

export function timelineEvents(props: Record<string, unknown>): TimelineEvent[] {
  const raw = Array.isArray(props.events) ? (props.events as Record<string, unknown>[]) : [];
  return raw.map((e) => ({ at: str(e.at, ''), label: str(e.label, ''), note: str(e.note, '') }));
}
